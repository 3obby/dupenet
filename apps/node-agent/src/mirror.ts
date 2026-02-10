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
 * Mirror a single block from source to local gateway.
 */
async function mirrorBlock(
  blockCid: string,
  sourceGatewayUrl: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${sourceGatewayUrl}/block/${blockCid}`);
    if (!res.ok) return false;

    const bytes = new Uint8Array(await res.arrayBuffer());

    const putRes = await fetchFn(`${config.gatewayUrl}/block/${blockCid}`, {
      method: "PUT",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
    });

    return putRes.ok;
  } catch {
    return false;
  }
}

/**
 * Mirror a CID from a source gateway to our local gateway.
 * Resolves AssetRoot → FileManifest → blocks for multi-block assets.
 * Falls back to single-block mirror if no asset/manifest found.
 */
export async function mirrorCid(
  cid: string,
  sourceGatewayUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    // Try as asset first (multi-block)
    const assetRes = await fetchFn(`${sourceGatewayUrl}/asset/${cid}`);
    if (assetRes.ok) {
      const assetBody = await assetRes.text();
      const asset = JSON.parse(assetBody) as {
        original: { file_root: string };
        variants?: Array<{ file_root: string }>;
      };

      // Mirror original file (manifest + blocks)
      const origOk = await mirrorFile(asset.original.file_root, sourceGatewayUrl, fetchFn);
      if (!origOk) return false;

      // Mirror variant files (if any)
      for (const variant of asset.variants ?? []) {
        await mirrorFile(variant.file_root, sourceGatewayUrl, fetchFn);
      }

      // Push asset root to local gateway
      const putAsset = await fetchFn(`${config.gatewayUrl}/asset/${cid}`, {
        method: "PUT",
        body: assetBody,
        headers: { "content-type": "application/json" },
      });

      return putAsset.ok;
    }

    // Fallback: try as single block
    return await mirrorBlock(cid, sourceGatewayUrl, fetchFn);
  } catch {
    return false;
  }
}

/**
 * Mirror a file (manifest + all blocks) from source to local.
 */
async function mirrorFile(
  fileRoot: string,
  sourceGatewayUrl: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  try {
    const manifestRes = await fetchFn(`${sourceGatewayUrl}/file/${fileRoot}`);
    if (!manifestRes.ok) return false;

    const manifestBody = await manifestRes.text();
    const manifest = JSON.parse(manifestBody) as { blocks: string[] };

    // Mirror all blocks
    let allOk = true;
    for (const blockCid of manifest.blocks) {
      const ok = await mirrorBlock(blockCid, sourceGatewayUrl, fetchFn);
      if (!ok) allOk = false;
    }

    // Push manifest to local gateway
    const putManifest = await fetchFn(`${config.gatewayUrl}/file/${fileRoot}`, {
      method: "PUT",
      body: manifestBody,
      headers: { "content-type": "application/json" },
    });

    return putManifest.ok && allOk;
  } catch {
    return false;
  }
}
