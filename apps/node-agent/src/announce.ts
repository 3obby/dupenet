/**
 * Announce agent — push host registration + serve announcements to coordinator.
 * DocRef: MVP_PLAN:§Node Kit, §Directory Format
 */

import { config } from "./config.js";
import { signEventPayload, fromHex } from "@dupenet/physics";

/**
 * Get the host's private key bytes from config.
 * Returns null if not configured.
 */
function getPrivateKey(): Uint8Array | null {
  if (!config.hostPrivateKeyHex || config.hostPrivateKeyHex.length !== 64) {
    return null;
  }
  return fromHex(config.hostPrivateKeyHex);
}

/**
 * Register this host with the coordinator (signed).
 */
export async function announceHost(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const sk = getPrivateKey();
  if (!sk) {
    console.error("[announce] no private key configured — cannot sign registration");
    return false;
  }

  const payload = {
    pubkey: config.hostPubkey,
    endpoint: config.hostEndpoint || null,
    pricing: {
      min_request_sats: config.minRequestSats,
      sats_per_gb: config.satsPerGb,
      min_bounty_sats: config.minBountySats,
      open_min_pool_sats: config.openMinPoolSats,
    },
  };

  const sig = await signEventPayload(sk, payload);

  try {
    const res = await fetchFn(`${config.coordinatorUrl}/host/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, sig }),
    });
    return res.ok || res.status === 201;
  } catch (err) {
    console.error("[announce] host registration failed:", err);
    return false;
  }
}

/**
 * Announce that this host serves a specific CID (signed).
 */
export async function announceServe(
  cid: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const sk = getPrivateKey();
  if (!sk) {
    console.error("[announce] no private key configured — cannot sign serve announcement");
    return false;
  }

  const payload = { pubkey: config.hostPubkey, cid };
  const sig = await signEventPayload(sk, payload);

  try {
    const res = await fetchFn(`${config.coordinatorUrl}/host/serve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, sig }),
    });
    return res.ok || res.status === 201;
  } catch (err) {
    console.error("[announce] serve announcement failed:", err);
    return false;
  }
}
