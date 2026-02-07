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
}

/**
 * Fetch profitable CIDs from coordinator.
 * TODO: implement full bounty feed query.
 */
export async function findProfitableTargets(): Promise<MirrorTarget[]> {
  // Stub — will query coordinator /bounty/feed in Sprint 5
  return [];
}

/**
 * Mirror a specific CID from a source gateway to our local gateway.
 */
export async function mirrorCid(
  cid: string,
  sourceGatewayUrl: string,
): Promise<boolean> {
  try {
    // Fetch asset/file/blocks from source
    const res = await fetch(`${sourceGatewayUrl}/block/${cid}`);
    if (!res.ok) return false;

    const bytes = new Uint8Array(await res.arrayBuffer());

    // Push to our local gateway
    const putRes = await fetch(`${config.gatewayUrl}/block/${cid}`, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
    });

    return putRes.ok;
  } catch {
    return false;
  }
}
