/**
 * Block routes — GET/PUT /block/{cid}
 * DocRef: MVP_PLAN:§Interface: Client → Operator (Direct)
 *
 * GET is L402-gated when LND + mint are configured.
 * Without L402 deps, blocks are served for free (dev mode).
 */

import type { FastifyInstance } from "fastify";
import { cidFromBytes, hashBytes, toHex, fromHex, currentEpoch, FREE_PREVIEW_MAX_BYTES, type CID } from "@dupenet/physics";
import type { BlockStore } from "../storage/block-store.js";
import type { LndClient } from "@dupenet/lnd-client";
import type { InvoiceStore } from "../l402/invoice-store.js";
import type { MintClient } from "../l402/mint-client.js";

export interface BlockRouteContext {
  store: BlockStore;
  lndClient: LndClient | null;
  mintClient: MintClient | null;
  invoiceStore: InvoiceStore;
  hostPubkey: string;
  minRequestSats: number;
  /** Enable free preview tier for blocks ≤ FREE_PREVIEW_MAX_BYTES. Default true. */
  freePreviewEnabled?: boolean;
}

export function blockRoutes(app: FastifyInstance, ctx: BlockRouteContext): void {
  /**
   * PUT /block/:cid — store a block (verified on receive).
   */
  app.put<{ Params: { cid: string } }>(
    "/block/:cid",
    async (request, reply) => {
      const { cid } = request.params;

      if (!/^[0-9a-f]{64}$/.test(cid)) {
        return reply.status(400).send({ error: "invalid_cid" });
      }

      const body = request.body;

      let blockBytes: Uint8Array;
      if (body instanceof Buffer || body instanceof Uint8Array) {
        blockBytes = new Uint8Array(body);
      } else {
        return reply.status(400).send({ error: "body_required" });
      }

      try {
        await ctx.store.put(cid as CID, blockBytes);
        return reply.status(201).send({ ok: true, cid });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        return reply.status(422).send({ error: msg });
      }
    },
  );

  /**
   * GET /block/:cid — retrieve a block.
   *
   * L402 flow (when LND + mint configured):
   *   1. No auth header → 402 + invoice + payment_hash
   *   2. Authorization: L402 <preimage> → verify → mint signs → bytes + receipt_token
   *
   * Dev mode (no LND): serves blocks for free.
   */
  app.get<{ Params: { cid: string } }>(
    "/block/:cid",
    async (request, reply) => {
      const { cid } = request.params;

      if (!/^[0-9a-f]{64}$/.test(cid)) {
        return reply.status(400).send({ error: "invalid_cid" });
      }

      // Verify block exists before L402 work
      const exists = await ctx.store.has(cid as CID);
      if (!exists) {
        return reply.status(404).send({ error: "not_found" });
      }

      // ── Free preview tier ────────────────────────────────────
      // Blocks ≤ FREE_PREVIEW_MAX_BYTES are served without L402.
      // DocRef: MVP_PLAN:§Free Preview Tier, §Open Access Tier
      if (ctx.freePreviewEnabled !== false) {
        const previewBytes = await ctx.store.get(cid as CID);
        if (previewBytes && previewBytes.length <= FREE_PREVIEW_MAX_BYTES) {
          return reply
            .header("content-type", "application/octet-stream")
            .header("x-content-cid", cid)
            .header("x-free-preview", "true")
            .send(Buffer.from(previewBytes));
        }
      }

      // ── L402 gating (when configured) ────────────────────────
      if (ctx.lndClient && ctx.mintClient) {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith("L402 ")) {
          // No auth: create invoice, return 402 challenge
          const priceSats = ctx.minRequestSats;

          let invoice;
          try {
            invoice = await ctx.lndClient.createInvoice({
              valueSats: priceSats,
              memo: `block:${cid}`,
              expirySecs: 600,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "lnd_error";
            return reply.status(503).send({ error: "lnd_unavailable", detail: msg });
          }

          const record = ctx.invoiceStore.set(invoice.paymentHash, {
            blockCid: cid,
            priceSats,
            hostPubkey: ctx.hostPubkey,
            epoch: currentEpoch(),
          });

          return reply
            .status(402)
            .header("WWW-Authenticate", "L402")
            .send({
              invoice: invoice.bolt11,
              payment_hash: invoice.paymentHash,
              price_sats: priceSats,
              expires_at: Math.floor(record.expiresAt / 1000),
            });
        }

        // ── Auth present: verify preimage ────────────────────
        const preimage = authHeader.slice(5).trim();
        if (!/^[0-9a-f]{64}$/.test(preimage)) {
          return reply.status(401).send({ error: "invalid_preimage" });
        }

        // payment_hash = SHA256(preimage)
        const paymentHash = toHex(hashBytes(fromHex(preimage)));

        const record = ctx.invoiceStore.get(paymentHash);
        if (!record) {
          return reply.status(401).send({ error: "unknown_payment" });
        }

        if (record.blockCid !== cid) {
          return reply.status(401).send({ error: "cid_mismatch" });
        }

        // Get block bytes
        const bytes = await ctx.store.get(cid as CID);
        if (!bytes) {
          return reply.status(404).send({ error: "not_found" });
        }

        const responseHash = cidFromBytes(bytes);

        // Call mint for receipt token
        let receiptToken: string;
        try {
          receiptToken = await ctx.mintClient.signReceipt({
            host_pubkey: record.hostPubkey,
            epoch: record.epoch,
            block_cid: cid,
            response_hash: responseHash,
            price_sats: record.priceSats,
            payment_hash: paymentHash,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "mint_error";
          return reply
            .status(502)
            .send({ error: "mint_unavailable", detail: msg });
        }

        // Consume the invoice record (single-use)
        ctx.invoiceStore.delete(paymentHash);

        return reply
          .header("content-type", "application/octet-stream")
          .header("x-content-cid", cid)
          .header("x-receipt-token", receiptToken)
          .header("x-payment-hash", paymentHash)
          .header("x-price-sats", String(record.priceSats))
          .header(
            "access-control-expose-headers",
            "X-Receipt-Token, X-Payment-Hash, X-Price-Sats",
          )
          .send(Buffer.from(bytes));
      }

      // ── No L402 (dev mode) ─────────────────────────────────
      const bytes = await ctx.store.get(cid as CID);
      if (!bytes) {
        return reply.status(404).send({ error: "not_found" });
      }

      return reply
        .header("content-type", "application/octet-stream")
        .header("x-content-cid", cid)
        .send(Buffer.from(bytes));
    },
  );
}
