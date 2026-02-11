/**
 * Coordinator server — protocol state management (Postgres-backed).
 * DocRef: MVP_PLAN:§Implementation Order, §Event Layer
 *
 * Owns: event log, bounty pools, host registry, directory,
 *       epoch aggregation, pin contracts, audits.
 *
 * Routes:
 *   POST /payreq          — create Lightning invoice for a funded event (payment-intent binding)
 *   GET  /payreq/:hash    — check payment status (client polling)
 *   POST /event           — unified event ingest (EventV1 envelope)
 *   GET  /events          — generic event query (by ref, kind, from, since)
 *   GET  /feed/funded     — pool keys ranked by balance + ANNOUNCE metadata
 *   GET  /feed/recent     — recent ANNOUNCE events (content discovery)
 *   GET  /thread/:event_id — thread tree (POST events by ref-chain)
 *   POST /tip             — tip a CID (shim → POST /event kind=FUND)
 *   GET  /bounty/:cid     — query bounty pool
 *   GET  /bounty/feed     — profitable CIDs for node agents
 *   POST /host/register   — register a host (shim → POST /event kind=HOST)
 *   POST /host/serve      — announce host serves a CID
 *   GET  /directory        — get host directory
 *   POST /receipt/submit   — submit receipts for epoch
 *   POST /epoch/settle    — settle a completed epoch (aggregation + payouts)
 *   GET  /epoch/summary/:epoch — get settlement results for an epoch
 *   POST /pin             — create pin contract
 *   GET  /pin/:id         — pin status + active hosts + epoch proofs
 *   POST /pin/:id/cancel  — cancel pin, return remaining budget minus fee
 *   POST /hosts/check     — trigger spot-checks for all hosts
 *   GET  /hosts/:pubkey/checks — view check history + availability score
 *   GET  /health          — health check (verifies DB connectivity)
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { creditTip, getPool } from "./views/bounty-pool.js";
import { registerHost, getAllHosts, addServedCid, getHost } from "./views/host-registry.js";
import {
  storeProtocolEvent,
  queryEvents,
  feedFunded,
  feedRecent,
  getThread,
} from "./views/materializer.js";
import {
  extractAndStoreEdges,
  getSignals,
  getOrphans,
  getHostScorecard,
  getAuthorProfile,
  getMarketQuote,
  getHostROI,
} from "./views/graph.js";
import { appendEvent, getEventCount } from "./event-log/writer.js";
import {
  TIP_EVENT,
  HOST_REGISTER_EVENT,
  RECEIPT_SUBMIT_EVENT,
  PROTOCOL_EVENT,
} from "./event-log/schemas.js";
import {
  currentEpoch,
  setGenesisTimestamp,
  verifyEventSignature,
  verifyEvent,
  computeEventId,
  decodeEventBody,
  verifyEventPow,
  EVENT_KIND_HOST,
  EVENT_MAX_BODY,
  type EventV1,
} from "@dupenet/physics";
import { verifyReceiptV2, type ReceiptV2Input } from "@dupenet/receipt-sdk";
import { settleEpoch } from "./views/epoch-settlement.js";
import {
  createPin,
  getPinStatus,
  cancelPin,
  validatePinInput,
  type CreatePinInput,
} from "./views/pin-contracts.js";
import {
  runAllChecks,
  getHostChecks,
  type SpotCheckFetcher,
} from "./views/availability.js";
import { computeAvailabilityScore } from "@dupenet/physics";
import { LndRestClient, type LndClient } from "@dupenet/lnd-client";
import { PaymentStore } from "./views/payment-store.js";

/** Try to create a real LND REST client from config, or return null (dev mode). */
function createLndClient(): LndClient | null {
  if (!config.lndHost || !config.lndMacaroonPath) return null;
  if (!existsSync(config.lndMacaroonPath)) {
    console.warn(
      `[coordinator] LND macaroon not found at ${config.lndMacaroonPath} — dev mode (sats trusted)`,
    );
    return null;
  }
  return new LndRestClient({
    host: config.lndHost,
    macaroonPath: config.lndMacaroonPath,
    tlsCertPath: config.lndTlsCertPath,
  });
}

export interface CoordinatorDeps {
  prisma?: PrismaClient;
  spotCheckFetcher?: SpotCheckFetcher;
  lndClient?: LndClient | null;
}

export async function buildApp(deps?: CoordinatorDeps) {
  // Set protocol genesis (before any epoch computation)
  if (config.genesisTimestampMs > 0) {
    setGenesisTimestamp(config.genesisTimestampMs);
  }

  const prisma = deps?.prisma ?? new PrismaClient();
  const app = Fastify({ logger: true });

  // LND client for payment verification (null = dev mode, sats trusted)
  const lndClient =
    deps?.lndClient !== undefined ? deps.lndClient : createLndClient();
  const paymentStore = new PaymentStore();

  // Periodic cleanup of expired payment requests (every 60s)
  const paymentCleanup = setInterval(() => paymentStore.cleanup(), 60_000);

  // Disconnect Prisma on shutdown
  app.addHook("onClose", async () => {
    clearInterval(paymentCleanup);
    await prisma.$disconnect();
  });

  if (lndClient) {
    app.log.info("LND configured — payment verification enabled for funded events");
  } else {
    app.log.info("LND not configured — dev mode (funded events accepted without payment)");
  }

  // ── Payment Request (Fortify payment flow) ──────────────────────
  // POST /payreq — create a Lightning invoice bound to an event_hash.
  // DocRef: MVP_PLAN:§Client Interaction Model (payment-intent binding)
  app.post("/payreq", async (req, reply) => {
    const { sats, event_hash } = req.body as {
      sats: number;
      event_hash: string;
    };

    // Validate inputs
    if (!Number.isInteger(sats) || sats <= 0) {
      return reply.status(422).send({ error: "invalid_sats" });
    }
    if (!/^[0-9a-f]{64}$/.test(event_hash)) {
      return reply
        .status(422)
        .send({ error: "invalid_event_hash", detail: "must be 64 hex chars" });
    }

    // Dev mode: no LND, sats trusted
    if (!lndClient) {
      return reply.send({ dev_mode: true, event_hash });
    }

    // Check for duplicate (same event_hash already pending)
    const existing = paymentStore.getByEventHash(event_hash);
    if (existing) {
      return reply.send({
        invoice: existing.bolt11,
        payment_hash: existing.paymentHash,
        expires_at: Math.floor(existing.expiresAt / 1000),
      });
    }

    // Create Lightning invoice
    let invoice;
    try {
      invoice = await lndClient.createInvoice({
        valueSats: sats,
        memo: `fortify:${event_hash.slice(0, 16)}`,
        expirySecs: 600,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "lnd_error";
      return reply
        .status(503)
        .send({ error: "lnd_unavailable", detail: msg });
    }

    const record = paymentStore.set(
      event_hash,
      invoice.paymentHash,
      invoice.bolt11,
      sats,
    );

    return reply.send({
      invoice: invoice.bolt11,
      payment_hash: invoice.paymentHash,
      expires_at: Math.floor(record.expiresAt / 1000),
    });
  });

  // GET /payreq/:payment_hash — check payment status (polling).
  app.get("/payreq/:payment_hash", async (req, reply) => {
    const { payment_hash } = req.params as { payment_hash: string };

    if (!/^[0-9a-f]{64}$/.test(payment_hash)) {
      return reply.status(422).send({ error: "invalid_payment_hash" });
    }

    const record = paymentStore.getByPaymentHash(payment_hash);
    if (!record) {
      return reply.status(404).send({ error: "not_found" });
    }

    // If LND is configured, check settlement status
    if (lndClient) {
      try {
        const info = await lndClient.lookupInvoice(payment_hash);
        return reply.send({
          settled: info.settled,
          state: info.state,
          event_hash: record.eventHash,
          sats: record.sats,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lnd_error";
        return reply
          .status(503)
          .send({ error: "lnd_unavailable", detail: msg });
      }
    }

    // Dev mode: report as settled
    return reply.send({
      settled: true,
      state: "SETTLED",
      event_hash: record.eventHash,
      sats: record.sats,
    });
  });

  // ── EventV1 Unified Ingest ────────────────────────────────────
  // POST /event — accepts any EventV1 envelope.
  // Protocol rule: if event.sats > 0, credit pool[event.ref] += sats (minus royalty).
  // Kind-specific side effects (host registration, etc.) handled by materializer.
  // DocRef: MVP_PLAN:§Event Layer, §Protocol vs Materializer Boundary
  app.post("/event", async (req, reply) => {
    const event = req.body as EventV1;

    // ── Basic validation ────────────────────────────────────────
    if (event.v !== 1) {
      return reply.status(422).send({ error: "unsupported_version", detail: `v=${event.v}` });
    }
    if (typeof event.kind !== "number" || event.kind < 0 || event.kind > 255) {
      return reply.status(422).send({ error: "invalid_kind" });
    }
    if (!/^[0-9a-f]{64}$/.test(event.from)) {
      return reply.status(422).send({ error: "invalid_from", detail: "must be 64 hex chars" });
    }
    if (!/^[0-9a-f]{64}$/.test(event.ref)) {
      return reply.status(422).send({ error: "invalid_ref", detail: "must be 64 hex chars" });
    }
    if (typeof event.body !== "string" || event.body.length > EVENT_MAX_BODY * 2) {
      return reply
        .status(422)
        .send({ error: "body_too_large", detail: `max ${EVENT_MAX_BODY} bytes` });
    }
    if (event.body.length > 0 && !/^[0-9a-f]*$/.test(event.body)) {
      return reply.status(422).send({ error: "invalid_body", detail: "must be hex-encoded" });
    }
    if (typeof event.sats !== "number" || event.sats < 0 || !Number.isInteger(event.sats)) {
      return reply.status(422).send({ error: "invalid_sats" });
    }
    if (typeof event.ts !== "number" || event.ts < 0) {
      return reply.status(422).send({ error: "invalid_ts" });
    }

    // ── Verify Ed25519 signature ────────────────────────────────
    const sigValid = await verifyEvent(event);
    if (!sigValid) {
      return reply
        .status(401)
        .send({ error: "invalid_signature", detail: "Ed25519 sig verification failed" });
    }

    // ── Event PoW verification (spam protection for free writes) ──
    // If requireEventPow is enabled, sats=0 events must include valid PoW.
    if (event.sats === 0 && config.requireEventPow) {
      const { pow_nonce, pow_hash } = req.body as {
        pow_nonce?: string;
        pow_hash?: string;
      };
      if (!pow_nonce || !pow_hash) {
        return reply.status(422).send({
          error: "pow_required",
          detail: "sats=0 events require pow_nonce + pow_hash",
        });
      }
      if (!verifyEventPow(event, pow_nonce, pow_hash)) {
        return reply.status(422).send({
          error: "invalid_pow",
          detail: "PoW hash does not meet target",
        });
      }
    }

    // ── Compute event_id ────────────────────────────────────────
    const eventId = computeEventId(event);

    // ── Payment verification (if LND configured) ─────────────────
    // For funded events (sats > 0), verify Lightning payment before crediting pool.
    // Dev mode (no LND): sats trusted without payment — sufficient at founder scale.
    if (event.sats > 0 && lndClient) {
      const payreq = paymentStore.getByEventHash(eventId);
      if (!payreq) {
        return reply.status(402).send({
          error: "payment_required",
          detail: "POST /payreq first, pay the invoice, then POST /event",
        });
      }
      if (payreq.sats !== event.sats) {
        return reply.status(422).send({
          error: "sats_mismatch",
          detail: `payreq.sats=${payreq.sats} != event.sats=${event.sats}`,
        });
      }
      try {
        const info = await lndClient.lookupInvoice(payreq.paymentHash);
        if (!info.settled) {
          return reply.status(402).send({
            error: "payment_not_settled",
            detail: `invoice state: ${info.state}`,
            payment_hash: payreq.paymentHash,
          });
        }
        if (info.amtPaidSats < event.sats) {
          return reply.status(402).send({
            error: "payment_insufficient",
            detail: `paid ${info.amtPaidSats} < required ${event.sats}`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lnd_error";
        return reply
          .status(503)
          .send({ error: "lnd_unavailable", detail: msg });
      }
      // Payment verified — consume the payment request (single-use)
      paymentStore.delete(payreq.paymentHash);
    }

    // ── Pool credit rule ────────────────────────────────────────
    // if event.sats > 0: credit pool[event.ref] += sats (minus royalty)
    let poolCredit = 0;
    let protocolFee = 0;
    if (event.sats > 0) {
      const result = await creditTip(prisma, event.ref, event.sats);
      poolCredit = result.poolCredit;
      protocolFee = result.protocolFee;
    }

    // ── Kind-specific materializer side effects ─────────────────
    if (event.kind === EVENT_KIND_HOST) {
      // Host registration/update — decode body and register
      try {
        const body = decodeEventBody(event.body) as {
          endpoint?: string | null;
          pricing?: { min_request_sats: number; sats_per_gb: number };
        };
        if (body.pricing) {
          const epoch = currentEpoch();
          await registerHost(
            prisma,
            event.from,
            body.endpoint ?? null,
            body.pricing,
            epoch,
          );
        }
      } catch {
        // Body decode failure is non-fatal — event is still stored
      }
    }

    // ── Persist to event log + indexed ProtocolEvent ───────────
    await appendEvent(prisma, {
      type: PROTOCOL_EVENT,
      timestamp: event.ts,
      signer: event.from,
      sig: event.sig,
      payload: {
        event_id: eventId,
        kind: event.kind,
        ref: event.ref,
        body: event.body,
        sats: event.sats,
      },
    });

    // Indexed materializer view (queryable by ref/kind/from/ts)
    await storeProtocolEvent(prisma, {
      eventId,
      kind: event.kind,
      from: event.from,
      ref: event.ref,
      body: event.body,
      sats: event.sats,
      ts: event.ts,
      sig: event.sig,
    });

    // ── Body edge extraction (citation graph) ─────────────────────
    // Parse [ref:bytes32] tokens from body, extract LIST items.
    // DocRef: MVP_PLAN:§Signal Layer, §Reference Graph
    let decodedBody: unknown;
    try {
      if (event.body) decodedBody = decodeEventBody(event.body);
    } catch { /* non-fatal */ }

    await extractAndStoreEdges(prisma, {
      eventId,
      kind: event.kind,
      ref: event.ref,
      body: event.body,
      sats: event.sats,
      decodedBody,
    });

    return reply.send({
      ok: true,
      event_id: eventId,
      ...(event.sats > 0 ? { pool_credit: poolCredit, protocol_fee: protocolFee } : {}),
    });
  });

  // ── Tip (shim → POST /event kind=FUND) ──────────────────────
  // Backward-compatible: accepts old TipV1 format, delegates to pool logic.
  app.post("/tip", async (req, reply) => {
    const { cid, amount, payment_proof, from, sig } = req.body as {
      cid: string;
      amount: number;
      payment_proof: string;
      from: string;
      sig: string;
    };

    // Verify Ed25519 signature over canonical(payload)
    const tipPayload = { cid, amount, payment_proof };
    const sigValid = await verifyEventSignature(from, sig, tipPayload);
    if (!sigValid) {
      return reply
        .status(401)
        .send({ error: "invalid_signature", detail: "Ed25519 sig verification failed" });
    }

    const { poolCredit, protocolFee } = await creditTip(prisma, cid, amount);

    await appendEvent(prisma, {
      type: TIP_EVENT,
      timestamp: Date.now(),
      signer: from,
      sig,
      payload: {
        cid,
        amount,
        payment_proof,
        pool_credit: poolCredit,
        protocol_fee: protocolFee,
      },
    });

    return reply.send({
      ok: true,
      pool_credit: poolCredit,
      protocol_fee: protocolFee,
    });
  });

  // ── Bounty query ───────────────────────────────────────────────
  app.get<{ Params: { cid: string } }>(
    "/bounty/:cid",
    async (req, reply) => {
      const pool = await getPool(prisma, req.params.cid);
      if (!pool) return reply.send({ balance: 0 });
      return reply.send(pool);
    },
  );

  // ── Bounty feed (profitable CIDs for node agents) ──────────────
  app.get("/bounty/feed", async (req, reply) => {
    const minBalance = parseInt(
      (req.query as Record<string, string>).min_balance ?? "100",
      10,
    );
    const limit = Math.min(
      parseInt((req.query as Record<string, string>).limit ?? "50", 10),
      200,
    );

    // Get all bounty pools above threshold
    const pools = await prisma.bountyPool.findMany({
      where: { balance: { gte: BigInt(minBalance) } },
      orderBy: { balance: "desc" },
      take: limit,
    });

    // For each pool key, get host count + endpoints
    const feed = await Promise.all(
      pools.map(async (pool) => {
        const serves = await prisma.hostServe.findMany({
          where: { cid: pool.poolKey },
          select: { hostPubkey: true },
        });

        // Get endpoints for serving hosts
        const endpoints: string[] = [];
        for (const s of serves) {
          const host = await prisma.host.findUnique({
            where: { pubkey: s.hostPubkey },
            select: { endpoint: true, status: true },
          });
          if (host?.endpoint && host.status === "TRUSTED") {
            endpoints.push(host.endpoint);
          }
        }

        const balance = Number(pool.balance);
        const hostCount = serves.length;

        return {
          cid: pool.poolKey,
          balance,
          host_count: hostCount,
          // Profitability: balance per host (higher = more attractive to new hosts)
          profitability: hostCount > 0 ? Math.floor(balance / hostCount) : balance,
          endpoints,
        };
      }),
    );

    // Sort by profitability (highest first — CIDs with few hosts and high bounty)
    feed.sort((a, b) => b.profitability - a.profitability);

    return reply.send({ feed, timestamp: Date.now() });
  });

  // ── Content stats (instrument cluster) ────────────────────────
  // GET /content/:ref/stats — aggregated stats for a single ref.
  // Returns pool balance, funder count, host count, runway, recent activity.
  app.get<{ Params: { ref: string } }>(
    "/content/:ref/stats",
    async (req, reply) => {
      const { ref } = req.params;
      if (!/^[0-9a-f]{64}$/.test(ref)) {
        return reply.status(422).send({ error: "invalid_ref" });
      }

      const EVENT_KIND_FUND = 0x01;

      // Parallel: pool + host count + fund events + recent activity
      const [pool, hostCount, fundEvents, recentEvents] = await Promise.all([
        prisma.bountyPool.findUnique({ where: { poolKey: ref } }),
        prisma.hostServe.count({ where: { cid: ref } }),
        prisma.protocolEvent.findMany({
          where: { ref, kind: EVENT_KIND_FUND },
          select: { from: true, sats: true },
        }),
        prisma.protocolEvent.findMany({
          where: { ref },
          orderBy: { ts: "desc" },
          take: 8,
          select: { from: true, sats: true, ts: true, kind: true },
        }),
      ]);

      const balance = Number(pool?.balance ?? 0n);
      const totalFunded = fundEvents.reduce((sum, e) => sum + e.sats, 0);
      const uniqueFroms = new Set(fundEvents.map((e) => e.from));
      const funderCount = uniqueFroms.size;

      return reply.send({
        balance,
        total_funded: totalFunded,
        funder_count: funderCount,
        host_count: hostCount,
        last_payout_epoch: pool?.lastPayoutEpoch ?? 0,
        recent: recentEvents.map((e) => ({
          from: e.from,
          sats: e.sats,
          ts: Number(e.ts),
          kind: e.kind,
        })),
      });
    },
  );

  // ── Host registration ──────────────────────────────────────────
  app.post("/host/register", async (req, reply) => {
    const { pubkey, endpoint, pricing, sig } = req.body as {
      pubkey: string;
      endpoint: string | null;
      pricing: { min_request_sats: number; sats_per_gb: number };
      sig: string;
    };

    // Verify Ed25519 signature over canonical(payload)
    const regPayload = { pubkey, endpoint, pricing };
    const sigValid = await verifyEventSignature(pubkey, sig, regPayload);
    if (!sigValid) {
      return reply
        .status(401)
        .send({ error: "invalid_signature", detail: "Ed25519 sig verification failed" });
    }

    // TODO: verify stake payment via LND
    const epoch = currentEpoch();
    const host = await registerHost(prisma, pubkey, endpoint, pricing, epoch);

    await appendEvent(prisma, {
      type: HOST_REGISTER_EVENT,
      timestamp: Date.now(),
      signer: pubkey,
      sig,
      payload: { pubkey, endpoint, pricing, epoch },
    });

    return reply.status(201).send({ ok: true, host });
  });

  // ── Directory ──────────────────────────────────────────────────
  app.get("/directory", async (_req, reply) => {
    const hosts = (await getAllHosts(prisma)).map((h) => ({
      pubkey: h.pubkey,
      endpoint: h.endpoint,
      pricing: h.pricing,
      status: h.status,
      availability_score: h.availability_score,
    }));
    return reply.send({ hosts, timestamp: Date.now() });
  });

  // ── Host serve announcement ─────────────────────────────────────
  app.post("/host/serve", async (req, reply) => {
    const { pubkey, cid, sig } = req.body as {
      pubkey: string;
      cid: string;
      sig: string;
    };

    // Verify signature
    const servePayload = { pubkey, cid };
    const sigValid = await verifyEventSignature(pubkey, sig, servePayload);
    if (!sigValid) {
      return reply
        .status(401)
        .send({ error: "invalid_signature" });
    }

    // Verify host exists
    const host = await getHost(prisma, pubkey);
    if (!host) {
      return reply
        .status(404)
        .send({ error: "host_not_found" });
    }

    const epoch = currentEpoch();
    await addServedCid(prisma, pubkey, cid, epoch);

    return reply.status(201).send({ ok: true, pubkey, cid, epoch });
  });

  // ── Receipt submission ──────────────────────────────────────────
  app.post("/receipt/submit", async (req, reply) => {
    const receipt = req.body as ReceiptV2Input & { version: number };

    // 1. Validate with receipt-sdk (checks client_sig, pow, receipt_token)
    if (config.mintPubkeys.length === 0) {
      return reply
        .status(503)
        .send({ error: "no_mint_pubkeys_configured" });
    }

    const result = await verifyReceiptV2(receipt, config.mintPubkeys);
    if (!result.valid) {
      return reply
        .status(422)
        .send({ error: "invalid_receipt", detail: result.error });
    }

    // 2. Check epoch is current or recent (within last 2 epochs)
    const current = currentEpoch();
    if (receipt.epoch > current || receipt.epoch < current - 2) {
      return reply.status(422).send({
        error: "epoch_out_of_range",
        current,
        receipt_epoch: receipt.epoch,
      });
    }

    // 3. Replay prevention: payment_hash must be unique
    const existing = await prisma.receipt.findUnique({
      where: { paymentHash: receipt.payment_hash },
    });
    if (existing) {
      return reply.status(409).send({ error: "duplicate_receipt" });
    }

    // 4. Store valid receipt
    await prisma.receipt.create({
      data: {
        epoch: receipt.epoch,
        hostPubkey: receipt.host_pubkey,
        blockCid: receipt.block_cid,
        fileRoot: receipt.file_root,
        assetRoot: receipt.asset_root ?? null,
        clientPubkey: receipt.client_pubkey,
        paymentHash: receipt.payment_hash,
        responseHash: receipt.response_hash,
        priceSats: receipt.price_sats,
        powHash: receipt.pow_hash,
        nonce: BigInt(receipt.nonce),
        receiptToken: receipt.receipt_token,
        clientSig: receipt.client_sig,
      },
    });

    // 5. Log event
    await appendEvent(prisma, {
      type: RECEIPT_SUBMIT_EVENT,
      timestamp: Date.now(),
      signer: receipt.client_pubkey,
      sig: receipt.client_sig,
      payload: {
        payment_hash: receipt.payment_hash,
        epoch: receipt.epoch,
        host_pubkey: receipt.host_pubkey,
        block_cid: receipt.block_cid,
      },
    });

    return reply.send({ ok: true });
  });

  // ── Epoch settlement ────────────────────────────────────────────
  app.post("/epoch/settle", async (req, reply) => {
    const { epoch } = req.body as { epoch: number };

    if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) {
      return reply.status(400).send({ error: "invalid_epoch" });
    }

    // Cannot settle the current or future epoch (it's still open)
    const current = currentEpoch();
    if (epoch >= current) {
      return reply.status(422).send({
        error: "epoch_not_closed",
        detail: `Epoch ${epoch} is not yet closed (current: ${current})`,
        current,
      });
    }

    const result = await settleEpoch(prisma, epoch);
    return reply.send({ ok: true, ...result });
  });

  app.get<{ Params: { epoch: string } }>(
    "/epoch/summary/:epoch",
    async (req, reply) => {
      const epoch = parseInt(req.params.epoch, 10);
      if (isNaN(epoch) || epoch < 0) {
        return reply.status(400).send({ error: "invalid_epoch" });
      }

      const summaries = await prisma.epochSummaryRecord.findMany({
        where: { epoch },
        orderBy: { id: "asc" },
      });

      if (summaries.length === 0) {
        return reply.send({ epoch, settled: false, summaries: [] });
      }

      return reply.send({
        epoch,
        settled: true,
        summaries: summaries.map((s) => ({
          host: s.hostPubkey,
          cid: s.cid,
          receipt_count: s.receiptCount,
          unique_clients: s.uniqueClients,
          reward_sats: Number(s.rewardSats),
        })),
      });
    },
  );

  // ── Pin contracts ───────────────────────────────────────────────
  app.post("/pin", async (req, reply) => {
    const input = req.body as CreatePinInput;

    const validation = validatePinInput(input);
    if (!validation.valid) {
      return reply.status(422).send({ error: "invalid_pin", detail: validation.error });
    }

    try {
      const pin = await createPin(prisma, input);
      return reply.status(201).send({ ok: true, pin });
    } catch (err: unknown) {
      // Duplicate pin ID (same content hashed to same ID)
      if (err instanceof Error && err.message.includes("Unique constraint")) {
        return reply.status(409).send({ error: "duplicate_pin" });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>(
    "/pin/:id",
    async (req, reply) => {
      const status = await getPinStatus(prisma, req.params.id);
      if (!status) {
        return reply.status(404).send({ error: "pin_not_found" });
      }
      return reply.send(status);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/pin/:id/cancel",
    async (req, reply) => {
      const { sig } = (req.body as { sig?: string }) ?? {};
      const result = await cancelPin(prisma, req.params.id, sig ?? "");
      if ("error" in result) {
        const status = result.error === "pin_not_found" ? 404 : 422;
        return reply.status(status).send(result);
      }
      return reply.send({ ok: true, ...result });
    },
  );

  // ── Availability / Spot-checks ──────────────────────────────────
  app.post("/hosts/check", async (_req, reply) => {
    const summary = await runAllChecks(prisma, deps?.spotCheckFetcher);
    return reply.send({ ok: true, ...summary });
  });

  app.get<{ Params: { pubkey: string } }>(
    "/hosts/:pubkey/checks",
    async (req, reply) => {
      const { pubkey } = req.params;
      const checks = await getHostChecks(prisma, pubkey);
      const epoch = currentEpoch();
      const assessment = computeAvailabilityScore(checks, epoch);

      return reply.send({
        pubkey,
        ...assessment,
        checks: checks.slice(0, 50), // last 50 checks
      });
    },
  );

  // ── Materializer: Event Query ─────────────────────────────────
  // GET /events?ref=&kind=&from=&since=&limit=&offset=
  // Generic event query — all filters optional (AND-combined).
  // DocRef: MVP_PLAN:§Signal Aggregation
  app.get("/events", async (req, reply) => {
    const q = req.query as Record<string, string>;

    const params: {
      ref?: string;
      kind?: number;
      from?: string;
      since?: number;
      limit?: number;
      offset?: number;
    } = {};

    if (q.ref && /^[0-9a-f]{64}$/.test(q.ref)) params.ref = q.ref;
    if (q.kind !== undefined) {
      const k = parseInt(q.kind, 10);
      if (!isNaN(k) && k >= 0 && k <= 255) params.kind = k;
    }
    if (q.from && /^[0-9a-f]{64}$/.test(q.from)) params.from = q.from;
    if (q.since !== undefined) {
      const s = parseInt(q.since, 10);
      if (!isNaN(s) && s >= 0) params.since = s;
    }
    if (q.limit) params.limit = Math.min(parseInt(q.limit, 10) || 50, 200);
    if (q.offset) params.offset = parseInt(q.offset, 10) || 0;

    const events = await queryEvents(prisma, params);
    return reply.send({ events, timestamp: Date.now() });
  });

  // ── Materializer: Funded Feed ────────────────────────────────
  // GET /feed/funded?min_balance=&limit=
  // Pool keys ranked by balance, enriched with ANNOUNCE event metadata.
  app.get("/feed/funded", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const minBalance = parseInt(q.min_balance ?? "0", 10);
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);

    const items = await feedFunded(prisma, { minBalance, limit });
    return reply.send({ items, timestamp: Date.now() });
  });

  // ── Materializer: Recent Feed ────────────────────────────────
  // GET /feed/recent?limit=&offset=&tag=
  // Recent ANNOUNCE events — content discovery feed.
  app.get("/feed/recent", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
    const offset = parseInt(q.offset ?? "0", 10);
    const tag = q.tag || undefined;

    const items = await feedRecent(prisma, { limit, offset, tag });
    return reply.send({ items, timestamp: Date.now() });
  });

  // ── Materializer: Thread View ────────────────────────────────
  // GET /thread/:event_id
  // Resolve ref-chain from POST events into a tree.
  app.get<{ Params: { event_id: string } }>(
    "/thread/:event_id",
    async (req, reply) => {
      const { event_id } = req.params;

      if (!/^[0-9a-f]{64}$/.test(event_id)) {
        return reply.status(400).send({ error: "invalid_event_id" });
      }

      const thread = await getThread(prisma, event_id);
      if (!thread) {
        return reply.status(404).send({ error: "event_not_found" });
      }

      return reply.send(thread);
    },
  );

  // ── Materializer: Content Signals ───────────────────────────────
  // GET /content/:ref/signals — dual score (direct pool + graph importance)
  // DocRef: MVP_PLAN:§Signal Layer
  app.get<{ Params: { ref: string } }>(
    "/content/:ref/signals",
    async (req, reply) => {
      const { ref } = req.params;
      if (!/^[0-9a-f]{64}$/.test(ref)) {
        return reply.status(422).send({ error: "invalid_ref" });
      }
      const signals = await getSignals(prisma, ref);
      return reply.send(signals);
    },
  );

  // ── Materializer: Orphans ──────────────────────────────────────
  // GET /orphans — funded but under-analyzed content
  app.get("/orphans", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? "20", 10), 100);
    const minBalance = parseInt(q.min_balance ?? "100", 10);
    const items = await getOrphans(prisma, { limit, minBalance });
    return reply.send({ items, timestamp: Date.now() });
  });

  // ── Materializer: Host Scorecard ───────────────────────────────
  // GET /host/:pubkey/scorecard — host reputation
  app.get<{ Params: { pubkey: string } }>(
    "/host/:pubkey/scorecard",
    async (req, reply) => {
      const { pubkey } = req.params;
      if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        return reply.status(422).send({ error: "invalid_pubkey" });
      }
      const scorecard = await getHostScorecard(prisma, pubkey);
      if (!scorecard) {
        return reply.status(404).send({ error: "host_not_found" });
      }
      return reply.send(scorecard);
    },
  );

  // ── Materializer: Author Profile ───────────────────────────────
  // GET /author/:pubkey/profile — pseudonymous reputation
  app.get<{ Params: { pubkey: string } }>(
    "/author/:pubkey/profile",
    async (req, reply) => {
      const { pubkey } = req.params;
      if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        return reply.status(422).send({ error: "invalid_pubkey" });
      }
      const profile = await getAuthorProfile(prisma, pubkey);
      return reply.send(profile);
    },
  );

  // ── Materializer: Market Quote ─────────────────────────────────
  // GET /market/quote — supply curve + tier pricing from host directory
  app.get("/market/quote", async (_req, reply) => {
    const quote = await getMarketQuote(prisma);
    return reply.send(quote);
  });

  // ── Materializer: Host ROI ─────────────────────────────────────
  // GET /host/roi — host conversion surface ("how much will I earn?")
  app.get("/host/roi", async (_req, reply) => {
    const roi = await getHostROI(prisma);
    return reply.send(roi);
  });

  // ── Health ─────────────────────────────────────────────────────
  app.get("/health", async (_req, reply) => {
    try {
      const events = await getEventCount(prisma);
      return reply.send({ status: "ok", events, timestamp: Date.now() });
    } catch {
      return reply
        .status(503)
        .send({ status: "degraded", timestamp: Date.now() });
    }
  });

  return app;
}

// Run if executed directly (not when imported in tests)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log("─── coordinator config ───");
  console.log(`  port:              ${config.port}`);
  console.log(`  database_url:      ${config.databaseUrl.replace(/\/\/.*@/, "//***@")}`);
  console.log(`  mint_pubkeys:      ${config.mintPubkeys.length > 0 ? config.mintPubkeys.map(k => k.slice(0, 12) + "…").join(", ") : "(none)"}`);
  console.log(`  epoch_scheduler:   ${config.epochSchedulerIntervalMs > 0 ? `${config.epochSchedulerIntervalMs}ms` : "disabled"}`);
  console.log(`  spot_checks:       ${config.epochSchedulerSpotChecks}`);
  console.log(`  genesis_ts:        ${config.genesisTimestampMs || "(default: 0)"}`);
  console.log("───────────────────────────");

  const app = await buildApp();

  // Start epoch scheduler BEFORE listen (Fastify 5 forbids addHook after listen)
  if (config.epochSchedulerIntervalMs > 0) {
    const { createEpochScheduler } = await import("./scheduler.js");
    const schedulerPrisma = new PrismaClient();
    const scheduler = createEpochScheduler(schedulerPrisma, {
      checkIntervalMs: config.epochSchedulerIntervalMs,
      runSpotChecks: config.epochSchedulerSpotChecks,
      onSettle: (result) => {
        app.log.info(
          { epoch: result.epoch, paid: result.totalPaidSats, groups: result.totalGroups },
          "epoch settled by scheduler",
        );
      },
      onError: (err) => {
        app.log.error({ err }, "scheduler error");
      },
    });

    // Register shutdown hook before listen
    app.addHook("onClose", async () => {
      scheduler.stop();
      await schedulerPrisma.$disconnect();
    });

    scheduler.start();
    app.log.info(
      { intervalMs: config.epochSchedulerIntervalMs },
      "epoch scheduler started",
    );
  }

  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
