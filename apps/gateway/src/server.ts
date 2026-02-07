/**
 * Gateway server — HTTP origin for content-addressed blobs.
 * DocRef: MVP_PLAN:§Phase 1 Step 1
 *
 * Routes:
 *   GET/PUT /block/{cid}   — raw block storage (GET is L402-gated)
 *   GET/PUT /file/{root}   — file manifests
 *   GET/PUT/HEAD /asset/{root} — asset roots
 *   GET /pricing           — host pricing info
 *   GET /health            — health check
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Fastify from "fastify";
import { BlockStore } from "./storage/block-store.js";
import { blockRoutes, type BlockRouteContext } from "./routes/block.js";
import { fileRoutes } from "./routes/file.js";
import { assetRoutes } from "./routes/asset.js";
import { pricingRoutes } from "./routes/pricing.js";
import { healthRoutes } from "./routes/health.js";
import { config } from "./config.js";
import { InvoiceStore } from "./l402/invoice-store.js";
import { HttpMintClient, type MintClient } from "./l402/mint-client.js";
import type { LndClient } from "@dupenet/lnd-client";

export interface GatewayDeps {
  lndClient?: LndClient | null;
  mintClient?: MintClient | null;
}

export async function buildApp(deps?: GatewayDeps) {
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
      : null; // Real LND client created from config when macaroon exists
  const mintClient =
    deps?.mintClient !== undefined
      ? deps.mintClient
      : config.mintUrl
        ? new HttpMintClient(config.mintUrl)
        : null;

  const invoiceStore = new InvoiceStore();

  const blockCtx: BlockRouteContext = {
    store,
    lndClient,
    mintClient,
    invoiceStore,
    hostPubkey: config.hostPubkey,
    minRequestSats: config.minRequestSats,
    satsPerGb: config.satsPerGb,
  };

  // Register routes
  blockRoutes(app, blockCtx);
  fileRoutes(app, store);
  assetRoutes(app);
  pricingRoutes(app);
  healthRoutes(app, store);

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
