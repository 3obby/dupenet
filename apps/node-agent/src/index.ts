/**
 * Node agent — operator kit entry point.
 * DocRef: MVP_PLAN:§Node Kit
 *
 * Runs as a long-lived process alongside the gateway.
 * Periodically mirrors profitable content and announces to directory.
 *
 * Loop: discover profitable CIDs → mirror from source gateways → announce to coordinator
 */

import { config } from "./config.js";
import { findProfitableTargets, mirrorCid } from "./mirror.js";
import { announceHost, announceServe } from "./announce.js";

/** Set of CIDs we've already mirrored (avoid re-mirroring within session). */
const mirroredCids = new Set<string>();

/**
 * Single poll cycle: discover → mirror → announce.
 */
export async function pollCycle(fetchFn?: typeof fetch): Promise<{
  discovered: number;
  mirrored: number;
  announced: number;
}> {
  const targets = await findProfitableTargets(fetchFn);
  let mirrored = 0;
  let announced = 0;

  // Filter to targets we haven't already mirrored
  const newTargets = targets
    .filter((t) => !mirroredCids.has(t.cid))
    .slice(0, config.maxMirrorsPerCycle);

  for (const target of newTargets) {
    // Pick a random source endpoint
    const sourceIdx = Math.floor(Math.random() * target.endpoints.length);
    const sourceUrl = target.endpoints[sourceIdx];
    if (!sourceUrl) continue;

    console.log(
      `[agent] mirroring ${target.cid.slice(0, 12)}... (bounty=${target.bounty}, from=${sourceUrl})`,
    );

    const ok = await mirrorCid(target.cid, sourceUrl, fetchFn);
    if (ok) {
      mirrored++;
      mirroredCids.add(target.cid);

      // Announce that we now serve this CID
      const served = await announceServe(target.cid, fetchFn);
      if (served) {
        announced++;
        console.log(`[agent] announced ${target.cid.slice(0, 12)}...`);
      }
    }
  }

  return { discovered: targets.length, mirrored, announced };
}

async function run(): Promise<void> {
  console.log(
    `[agent] starting — gateway=${config.gatewayUrl} coordinator=${config.coordinatorUrl}`,
  );

  if (!config.hostPubkey) {
    console.error("[agent] AGENT_HOST_PUBKEY not set — cannot announce");
    process.exit(1);
  }

  // Register with coordinator
  console.log("[agent] registering with coordinator...");
  const registered = await announceHost();
  if (registered) {
    console.log("[agent] registered successfully");
  } else {
    console.warn("[agent] registration failed — will retry on next cycle");
  }

  // Poll loop
  console.log(`[agent] starting poll loop (interval=${config.pollIntervalMs}ms)`);
  const poll = async () => {
    try {
      const result = await pollCycle();
      if (result.discovered > 0) {
        console.log(
          `[agent] cycle: discovered=${result.discovered} mirrored=${result.mirrored} announced=${result.announced}`,
        );
      }
    } catch (err) {
      console.error("[agent] poll error:", err);
    }
  };

  // Initial poll
  await poll();

  // Recurring poll
  setInterval(poll, config.pollIntervalMs);
}

run().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
