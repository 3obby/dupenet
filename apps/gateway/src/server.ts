/**
 * Gateway server — HTTP origin for content-addressed blobs.
 * DocRef: MVP_PLAN:§Phase 1 Step 1
 *
 * Routes:
 *   GET/PUT /block/{cid}   — raw block storage
 *   GET/PUT /file/{root}   — file manifests
 *   GET/PUT/HEAD /asset/{root} — asset roots
 *   GET /pricing           — host pricing info
 *   GET /health            — health check
 */

import Fastify from "fastify";
import { BlockStore } from "./storage/block-store.js";
import { blockRoutes } from "./routes/block.js";
import { fileRoutes } from "./routes/file.js";
import { assetRoutes } from "./routes/asset.js";
import { pricingRoutes } from "./routes/pricing.js";
import { healthRoutes } from "./routes/health.js";
import { config } from "./config.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 512 * 1024, // 512KB max body (> 256KiB chunk + overhead)
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

  // Register routes
  blockRoutes(app, store);
  fileRoutes(app, store);
  assetRoutes(app);
  pricingRoutes(app);
  healthRoutes(app);

  return app;
}

// Run if executed directly
const app = await buildApp();
app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
