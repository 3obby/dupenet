/**
 * Coordinator server — protocol state management (Postgres-backed).
 * DocRef: MVP_PLAN:§Implementation Order
 *
 * Owns: event log, bounty pools, host registry, directory,
 *       epoch aggregation, pin contracts, audits.
 *
 * Routes:
 *   POST /tip            — tip a CID
 *   GET  /bounty/:cid    — query bounty pool
 *   POST /host/register  — register a host
 *   GET  /directory       — get host directory
 *   POST /receipt/submit  — submit receipts for epoch (stub)
 *   POST /pin            — create pin contract (stub)
 *   GET  /pin/:id        — pin status (stub)
 *   GET  /health         — health check (verifies DB connectivity)
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { creditTip, getPool } from "./views/bounty-pool.js";
import { registerHost, getAllHosts } from "./views/host-registry.js";
import { appendEvent, getEventCount } from "./event-log/writer.js";
import {
  TIP_EVENT,
  HOST_REGISTER_EVENT,
  RECEIPT_SUBMIT_EVENT,
} from "./event-log/schemas.js";
import { currentEpoch } from "@dupenet/physics";
import { verifyReceiptV2, type ReceiptV2Input } from "@dupenet/receipt-sdk";

export interface CoordinatorDeps {
  prisma?: PrismaClient;
}

export async function buildApp(deps?: CoordinatorDeps) {
  const prisma = deps?.prisma ?? new PrismaClient();
  const app = Fastify({ logger: true });

  // Disconnect Prisma on shutdown
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  // ── Tip ────────────────────────────────────────────────────────
  app.post("/tip", async (req, reply) => {
    const { cid, amount, payment_proof, from } = req.body as {
      cid: string;
      amount: number;
      payment_proof: string;
      from: string;
    };

    const { poolCredit, protocolFee } = await creditTip(prisma, cid, amount);

    await appendEvent(prisma, {
      type: TIP_EVENT,
      timestamp: Date.now(),
      signer: from,
      sig: "", // TODO: verify signature
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

  // ── Host registration ──────────────────────────────────────────
  app.post("/host/register", async (req, reply) => {
    const { pubkey, endpoint, pricing } = req.body as {
      pubkey: string;
      endpoint: string | null;
      pricing: { min_request_sats: number; sats_per_gb: number };
    };

    // TODO: verify stake payment via LND
    const epoch = currentEpoch();
    const host = await registerHost(prisma, pubkey, endpoint, pricing, epoch);

    await appendEvent(prisma, {
      type: HOST_REGISTER_EVENT,
      timestamp: Date.now(),
      signer: pubkey,
      sig: "",
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

  // ── Pin (stub) ─────────────────────────────────────────────────
  app.post("/pin", async (_req, reply) => {
    // TODO: Sprint 5 — pin contract lifecycle
    return reply.send({ ok: true, message: "pin contract stub" });
  });

  app.get<{ Params: { id: string } }>(
    "/pin/:id",
    async (_req, reply) => {
      return reply.status(404).send({ error: "not_implemented" });
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
  const app = await buildApp();
  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
