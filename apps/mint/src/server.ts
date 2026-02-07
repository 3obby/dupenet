/**
 * Mint server — stateless receipt token signer.
 * DocRef: MVP_PLAN:§Receipt Mint (L402 Gate)
 *
 * POST /sign — verifies settlement via LND, returns Ed25519 sig.
 * GET /pubkey — returns this mint's public key.
 * GET /health — health check.
 *
 * This is an HSM over HTTP. No DB, no state, no business logic.
 * Gateway creates invoices. Mint independently verifies settlement.
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import { ReceiptSigner } from "./signer.js";
import { config } from "./config.js";
import type { LndClient } from "@dupenet/lnd-client";
import { LndRestClient } from "@dupenet/lnd-client";

export interface MintDeps {
  lndClient?: LndClient | null;
}

/** Try to create a real LND REST client from config, or return null (dev mode). */
function createLndClient(): LndClient | null {
  if (!config.lndMacaroonPath) return null;
  if (!existsSync(config.lndMacaroonPath)) {
    console.warn(`[mint] LND macaroon not found at ${config.lndMacaroonPath} — dev mode`);
    return null;
  }
  return new LndRestClient({
    host: config.lndHost,
    macaroonPath: config.lndMacaroonPath,
    tlsCertPath: config.lndTlsCertPath,
  });
}

export async function buildApp(deps?: MintDeps) {
  const app = Fastify({ logger: true });

  // Initialize signer
  let signer: ReceiptSigner | undefined;
  if (config.privateKeyHex) {
    signer = await ReceiptSigner.create(config.privateKeyHex);
    app.log.info(`Mint public key: ${signer.publicKeyHex}`);
  } else {
    app.log.warn("No MINT_PRIVATE_KEY_HEX set — signing disabled");
  }

  // LND client for settlement verification (null = dev mode, sign unconditionally)
  const lndClient =
    deps?.lndClient !== undefined ? deps.lndClient : createLndClient();

  app.get("/pubkey", async (_req, reply) => {
    if (!signer) return reply.status(503).send({ error: "no_key" });
    return reply.send({ pubkey: signer.publicKeyHex });
  });

  app.post("/sign", async (req, reply) => {
    if (!signer) return reply.status(503).send({ error: "no_key" });

    const body = req.body as {
      host_pubkey: string;
      epoch: number;
      block_cid: string;
      response_hash: string;
      price_sats: number;
      payment_hash: string;
    };

    // Verify settlement against LND (when configured)
    if (lndClient) {
      try {
        const info = await lndClient.lookupInvoice(body.payment_hash);

        if (!info.settled) {
          return reply
            .status(402)
            .send({ error: "not_settled", state: info.state });
        }

        if (info.amtPaidSats < body.price_sats) {
          return reply.status(402).send({
            error: "underpaid",
            expected: body.price_sats,
            paid: info.amtPaidSats,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lnd_error";
        return reply
          .status(502)
          .send({ error: "lnd_unavailable", detail: msg });
      }
    }

    const { token, mint_pubkey } = await signer.signToken(body);

    const tokenB64 = Buffer.from(token).toString("base64");
    return reply.send({ token: tokenB64, mint_pubkey });
  });

  app.get("/health", async (_req, reply) => {
    return reply.send({ status: "ok", has_key: !!signer });
  });

  return app;
}

// Run if executed directly (not when imported in tests)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log("─── mint config ───");
  console.log(`  port:         ${config.port}`);
  console.log(`  lnd_host:     ${config.lndHost}`);
  console.log(`  lnd_macaroon: ${config.lndMacaroonPath || "(none — dev mode)"}`);
  console.log(`  has_key:      ${config.privateKeyHex ? "yes" : "NO (signing disabled)"}`);
  console.log("────────────────────");

  const app = await buildApp();
  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
