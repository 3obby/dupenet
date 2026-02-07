/**
 * Announce agent — push HostServeV1 to coordinator directory.
 * DocRef: MVP_PLAN:§Node Kit, §Directory Format
 */

import { config } from "./config.js";

/**
 * Register this host with the coordinator.
 */
export async function announceHost(
  endpoint: string,
  pricing: { min_request_sats: number; sats_per_gb: number },
): Promise<boolean> {
  try {
    const res = await fetch(`${config.coordinatorUrl}/host/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: config.hostPubkey,
        endpoint,
        pricing,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Announce that this host serves a specific CID.
 */
export async function announceServe(_cid: string): Promise<boolean> {
  // TODO: implement HostServeV1 submission to coordinator
  return false;
}
