/**
 * Gateway server — HTTP origin for content-addressed blobs.
 * DocRef: MVP_PLAN:§Phase 1 Step 1, §Event Layer
 *
 * Routes:
 *   GET/PUT /block/{cid}   — raw block storage (GET is L402-gated, free preview for small blocks)
 *   GET/PUT /file/{root}   — file manifests
 *   GET/PUT/HEAD /asset/{root} — asset roots
 *   GET /cid/{hash}        — unified: resolve to block, file, or asset (nano-blob path)
 *   GET /pricing           — host pricing info
 *   GET /health            — health check
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import { BlockStore } from "./storage/block-store.js";
import { setGenesisTimestamp } from "@dupenet/physics";
import { blockRoutes, type BlockRouteContext } from "./routes/block.js";
import { fileRoutes } from "./routes/file.js";
import { assetRoutes } from "./routes/asset.js";
import { cidRoutes } from "./routes/cid.js";
import { pricingRoutes } from "./routes/pricing.js";
import { healthRoutes } from "./routes/health.js";
import { config } from "./config.js";
import { InvoiceStore } from "./l402/invoice-store.js";
import { HttpMintClient, type MintClient } from "./l402/mint-client.js";
import type { LndClient } from "@dupenet/lnd-client";
import { LndRestClient } from "@dupenet/lnd-client";

export interface GatewayDeps {
  lndClient?: LndClient | null;
  mintClient?: MintClient | null;
}

/** Try to create a real LND REST client from config, or return null (dev mode). */
function createLndClient(): LndClient | null {
  if (!config.lndMacaroonPath) return null;
  if (!existsSync(config.lndMacaroonPath)) {
    console.warn(`[gateway] LND macaroon not found at ${config.lndMacaroonPath} — dev mode`);
    return null;
  }
  return new LndRestClient({
    host: config.lndHost,
    macaroonPath: config.lndMacaroonPath,
    tlsCertPath: config.lndTlsCertPath,
  });
}

export async function buildApp(deps?: GatewayDeps) {
  // Set protocol genesis (before any epoch computation)
  if (config.genesisTimestampMs > 0) {
    setGenesisTimestamp(config.genesisTimestampMs);
  }

  const app = Fastify({
    logger: true,
    bodyLimit: 512 * 1024, // 512KB max body (> 256KiB chunk + overhead)
    exposeHeadRoutes: false, // We define HEAD /asset/:root explicitly
  });

  // Accept raw binary bodies for block uploads
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // Initialize block store
  const store = new BlockStore(config.blockStorePath);
  await store.init();

  // L402 dependencies (null = dev mode, blocks served for free)
  const lndClient =
    deps?.lndClient !== undefined
      ? deps.lndClient
      : createLndClient();
  const mintClient =
    deps?.mintClient !== undefined
      ? deps.mintClient
      : config.mintUrl
        ? new HttpMintClient(config.mintUrl)
        : null;

  const invoiceStore = new InvoiceStore();

  // Periodic cleanup of expired invoices (every 60s)
  const cleanupInterval = setInterval(() => invoiceStore.cleanup(), 60_000);
  app.addHook("onClose", () => clearInterval(cleanupInterval));

  const blockCtx: BlockRouteContext = {
    store,
    lndClient,
    mintClient,
    invoiceStore,
    hostPubkey: config.hostPubkey,
    minRequestSats: config.minRequestSats,
    freePreviewEnabled: config.freePreviewEnabled,
  };

  // Register routes
  blockRoutes(app, blockCtx);
  fileRoutes(app, store);
  assetRoutes(app);
  cidRoutes(app, store);
  pricingRoutes(app);
  healthRoutes(app, store);

  return app;
}

// Run if executed directly (not when imported in tests)
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log("─── gateway config ───");
  console.log(`  port:             ${config.port}`);
  console.log(`  block_store:      ${config.blockStorePath}`);
  console.log(`  lnd_host:         ${config.lndHost}`);
  console.log(`  lnd_macaroon:     ${config.lndMacaroonPath || "(none — dev mode)"}`);
  console.log(`  mint_url:         ${config.mintUrl}`);
  console.log(`  host_pubkey:      ${config.hostPubkey || "(not set)"}`);
  console.log(`  min_request_sats: ${config.minRequestSats}`);
  console.log(`  sats_per_gb:      ${config.satsPerGb}`);
  console.log("──────────────────────");

  const app = await buildApp();
  app.listen({ port: config.port, host: config.host }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}
