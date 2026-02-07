/**
 * Mirror agent — watches bounty feed, mirrors profitable content.
 * DocRef: MVP_PLAN:§Node Kit, §What Hosts
 *
 * Poll coordinator for bounty pools above threshold.
 * Fetch content from other gateways, store locally.
 */

import { config } from "./config.js";

export interface MirrorTarget {
  cid: string;
  bounty: number;
  /** Bounty / active hosts — higher means more profitable to mirror. */
  profitability: number;
  /** Existing gateway endpoints serving this CID (source for mirroring). */
  endpoints: string[];
}

export interface BountyFeedResponse {
  feed: Array<{
    cid: string;
    balance: number;
    host_count: number;
    profitability: number;
    endpoints: string[];
  }>;
  timestamp: number;
}

/**
 * Fetch profitable CIDs from coordinator bounty feed.
 * Returns CIDs above the agent's minimum bounty threshold,
 * sorted by profitability (highest first).
 */
export async function findProfitableTargets(
  fetchFn: typeof fetch = fetch,
): Promise<MirrorTarget[]> {
  try {
    const url = `${config.coordinatorUrl}/bounty/feed?min_balance=${config.minBountyForMirror}&limit=50`;
    const res = await fetchFn(url);
    if (!res.ok) {
      console.error(`[mirror] bounty feed error: HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as BountyFeedResponse;

    return data.feed
      .filter((item) => item.endpoints.length > 0) // need at least one source to mirror from
      .map((item) => ({
        cid: item.cid,
        bounty: item.balance,
        profitability: item.profitability,
        endpoints: item.endpoints,
      }));
  } catch (err) {
    console.error("[mirror] bounty feed fetch failed:", err);
    return [];
  }
}

/**
 * Mirror a specific block CID from a source gateway to our local gateway.
 * Fetches the block bytes from source, pushes to local.
 */
export async function mirrorCid(
  cid: string,
  sourceGatewayUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    // Fetch block from source
    const res = await fetchFn(`${sourceGatewayUrl}/block/${cid}`);
    if (!res.ok) return false;

    const bytes = new Uint8Array(await res.arrayBuffer());

    // Push to our local gateway
    const putRes = await fetchFn(`${config.gatewayUrl}/block/${cid}`, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
    });

    return putRes.ok;
  } catch {
    return false;
  }
}
