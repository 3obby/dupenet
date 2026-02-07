/**
 * dupenet info <cid>
 *
 * GET /bounty/:cid + GET /asset/:root → print summary.
 * DocRef: MVP_PLAN:§Interface: Client → Protocol (query_bounty)
 */

import type { AssetRootV1 } from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { httpGet } from "../lib/http.js";

interface BountyResponse {
  cid: string;
  balance: number;
}

export async function infoCommand(
  cid: string,
  config: CliConfig,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(cid)) {
    throw new Error(`Invalid CID: must be 64-char hex. Got: ${cid}`);
  }

  console.log(`Info for ${cid}\n`);

  // Try to get asset info
  try {
    const asset = await httpGet<AssetRootV1>(`${config.gateway}/asset/${cid}`);
    console.log(`  Asset:`);
    console.log(`    kind: ${asset.kind}`);
    console.log(`    size: ${formatSize(asset.original.size)}`);
    if (asset.original.mime) console.log(`    mime: ${asset.original.mime}`);
    console.log(`    file_root: ${asset.original.file_root}`);
    if (asset.variants.length > 0) {
      console.log(`    variants: ${asset.variants.length}`);
    }
    console.log();
  } catch {
    console.log(`  (not an asset — may be a raw block or file_root)\n`);
  }

  // Try to get bounty info
  try {
    const bounty = await httpGet<BountyResponse>(
      `${config.coordinator}/bounty/${cid}`,
    );
    console.log(`  Bounty pool:`);
    console.log(`    balance: ${bounty.balance} sats`);
  } catch {
    console.log(`  Bounty pool: (none)`);
  }

  // Get pricing
  try {
    const pricing = await httpGet<{
      min_request_sats: number;
      sats_per_gb: number;
    }>(`${config.gateway}/pricing`);
    console.log(`\n  Gateway pricing:`);
    console.log(`    min_request: ${pricing.min_request_sats} sats`);
    console.log(`    per_gb:      ${pricing.sats_per_gb} sats`);
  } catch {
    // Gateway might be down
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
