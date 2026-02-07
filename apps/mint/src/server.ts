/**
 * Mint server — stateless receipt token signer.
 * DocRef: MVP_PLAN:§Receipt Mint (L402 Gate)
 *
 * POST /sign — accepts token payload, verifies settlement, returns Ed25519 sig.
 * GET /pubkey — returns this mint's public key.
 * GET /health — health check.
 *
 * This is an HSM over HTTP. No DB, no state, no business logic.
 */

import Fastify from "fastify";
import { ReceiptSigner } from "./signer.js";
import { config } from "./config.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  // Initialize signer
  let signer: ReceiptSigner;
  if (config.privateKeyHex) {
    signer = await ReceiptSigner.create(config.privateKeyHex);
    app.log.info(`Mint public key: ${signer.publicKeyHex}`);
  } else {
    app.log.warn("No MINT_PRIVATE_KEY_HEX set — signing disabled");
  }

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

    // TODO: verify settlement against LND before signing
    // For now, sign unconditionally (dev mode)

    const { token, mint_pubkey } = await signer.signToken(body);

    // Return base64-encoded token
    const tokenB64 = Buffer.from(token).toString("base64");
    return reply.send({ token: tokenB64, mint_pubkey });
  });

  app.get("/health", async (_req, reply) => {
    return reply.send({ status: "ok", has_key: !!signer });
  });

  return app;
}

const app = await buildApp();
app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
