/**
 * Coordinator server — protocol state management (Postgres-backed).
 * DocRef: MVP_PLAN:§Implementation Order, §Event Layer
 *
 * Owns: event log, bounty pools, host registry, directory,
 *       epoch aggregation, pin contracts, audits.
 *
 * Routes:
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

export interface CoordinatorDeps {
  prisma?: PrismaClient;
  spotCheckFetcher?: SpotCheckFetcher;
}

export async function buildApp(deps?: CoordinatorDeps) {
  // Set protocol genesis (before any epoch computation)
  if (config.genesisTimestampMs > 0) {
    setGenesisTimestamp(config.genesisTimestampMs);
  }

  const prisma = deps?.prisma ?? new PrismaClient();
  const app = Fastify({ logger: true });

  // Disconnect Prisma on shutdown
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
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

    // ── Compute event_id ────────────────────────────────────────
    const eventId = computeEventId(event);

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
