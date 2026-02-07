/**
 * Node agent — operator kit entry point.
 * DocRef: MVP_PLAN:§Node Kit
 *
 * Runs as a long-lived process alongside the gateway.
 * Periodically mirrors profitable content and announces to directory.
 */

import { config } from "./config.js";
import { findProfitableTargets } from "./mirror.js";

async function run(): Promise<void> {
  console.log(`[agent] starting — gateway=${config.gatewayUrl} coordinator=${config.coordinatorUrl}`);

  if (!config.hostPubkey) {
    console.error("[agent] AGENT_HOST_PUBKEY not set — cannot announce");
    process.exit(1);
  }

  // Initial announcement
  // TODO: get endpoint and pricing from config
  console.log("[agent] announcing to coordinator...");

  // Poll loop
  setInterval(async () => {
    try {
      const targets = await findProfitableTargets();
      for (const target of targets) {
        console.log(`[agent] mirroring ${target.cid} (bounty=${target.bounty})`);
        // TODO: discover source gateways from directory
      }
    } catch (err) {
      console.error("[agent] poll error:", err);
    }
  }, config.pollIntervalMs);
}

run().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
