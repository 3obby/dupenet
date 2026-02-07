/**
 * dupenet fetch <cid> [-o file]
 *
 * GET /asset → GET /file → GET /block × N → reassemble → write.
 * Supports free mode (dev gateways) and L402 paid fetch.
 * DocRef: MVP_PLAN:§Fetch Flow
 */

import { writeFile } from "node:fs/promises";
import {
  reassembleFile,
  verifyCid,
  cidFromBytes,
  type FileManifestV1,
  type AssetRootV1,
  type CID,
} from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { httpGet, httpGetBytes } from "../lib/http.js";

interface FetchOptions {
  output?: string;
  free?: boolean;
}

interface L402Challenge {
  invoice: string;
  payment_hash: string;
  price_sats: number;
  expires_at: number;
}

export async function fetchCommand(
  cid: string,
  config: CliConfig,
  opts: FetchOptions,
): Promise<void> {
  // Validate CID format
  if (!/^[0-9a-f]{64}$/.test(cid)) {
    throw new Error(`Invalid CID: must be 64-char hex. Got: ${cid}`);
  }

  // Try as asset_root first (multi-block file)
  let asset: AssetRootV1 | null = null;
  try {
    asset = await httpGet<AssetRootV1>(`${config.gateway}/asset/${cid}`);
  } catch {
    // Not an asset — try as raw block
  }

  if (asset) {
    await fetchAsset(cid, asset, config, opts);
  } else {
    await fetchRawBlock(cid, config, opts);
  }
}

async function fetchAsset(
  assetCid: string,
  asset: AssetRootV1,
  config: CliConfig,
  opts: FetchOptions,
): Promise<void> {
  const { file_root, size, mime } = asset.original;
  console.log(`Asset: ${assetCid}`);
  console.log(`  kind: ${asset.kind}, size: ${formatSize(size)}${mime ? `, mime: ${mime}` : ""}`);

  // Get file manifest
  const manifest = await httpGet<FileManifestV1>(`${config.gateway}/file/${file_root}`);
  console.log(`  ${manifest.blocks.length} block(s), file_root: ${file_root}`);

  // Fetch all blocks
  const blockMap = new Map<CID, Uint8Array>();
  let fetched = 0;

  for (const blockCid of manifest.blocks) {
    const bytes = await fetchBlock(blockCid, config, opts.free);
    blockMap.set(blockCid, bytes);
    fetched++;
    const pct = Math.round((fetched / manifest.blocks.length) * 100);
    process.stdout.write(`\r  Blocks: ${fetched}/${manifest.blocks.length} (${pct}%)`);
  }
  console.log(); // newline after progress

  // Reassemble
  const fileBytes = reassembleFile(manifest, blockMap);

  // Verify against original hash
  const actualHash = cidFromBytes(fileBytes);
  if (actualHash !== asset.meta.sha256_original) {
    throw new Error(
      `Integrity check failed: SHA256(reassembled) = ${actualHash}, expected ${asset.meta.sha256_original}`,
    );
  }
  console.log(`  Integrity verified`);

  // Write output
  const outPath = opts.output ?? `${assetCid.slice(0, 12)}${extFromMime(mime)}`;
  await writeFile(outPath, fileBytes);
  console.log(`\nSaved: ${outPath} (${formatSize(fileBytes.length)})`);
}

async function fetchRawBlock(
  cid: string,
  config: CliConfig,
  opts: FetchOptions,
): Promise<void> {
  console.log(`Fetching raw block: ${cid}`);
  const bytes = await fetchBlock(cid, config, opts.free);

  if (!verifyCid(cid, bytes)) {
    throw new Error(`Integrity check failed: block hash does not match CID`);
  }
  console.log(`  Integrity verified (${formatSize(bytes.length)})`);

  const outPath = opts.output ?? `${cid.slice(0, 12)}.bin`;
  await writeFile(outPath, bytes);
  console.log(`Saved: ${outPath}`);
}

/** Fetch a single block, handling L402 if needed. */
async function fetchBlock(
  blockCid: string,
  config: CliConfig,
  free?: boolean,
): Promise<Uint8Array> {
  const url = `${config.gateway}/block/${blockCid}`;

  // First attempt
  const result = await httpGetBytes(url);

  if (result.status === 200) {
    return result.bytes;
  }

  if (result.status === 402) {
    if (free) {
      throw new Error(
        `Block ${blockCid} requires L402 payment, but --free was specified.\n` +
          `This gateway requires Lightning payment.`,
      );
    }

    // Parse L402 challenge
    const challenge = JSON.parse(result.body!) as L402Challenge;
    console.log(
      `\n  L402: ${challenge.price_sats} sats — invoice: ${challenge.invoice.slice(0, 40)}...`,
    );

    // Try to pay via LND
    if (config.lndHost) {
      const preimage = await payInvoice(config, challenge.invoice);
      // Retry with preimage
      const paid = await httpGetBytes(url, {
        Authorization: `L402 ${preimage}`,
      });
      if (paid.status !== 200) {
        throw new Error(`L402 payment accepted but block fetch failed: ${paid.status}`);
      }
      return paid.bytes;
    }

    // No LND configured — prompt user
    console.log(`\n  Pay this invoice with your Lightning wallet:`);
    console.log(`  ${challenge.invoice}`);
    console.log(`\n  Then re-run with the preimage:`);
    console.log(`  dupenet fetch ${blockCid} --preimage <hex>`);
    throw new Error(`L402 payment required — no LND configured for automatic payment`);
  }

  throw new Error(`Unexpected status ${result.status} fetching block ${blockCid}`);
}

/** Pay an L402 invoice via LND REST. */
async function payInvoice(
  config: CliConfig,
  bolt11: string,
): Promise<string> {
  if (!config.lndHost || !config.lndMacaroonPath) {
    throw new Error("LND not configured — cannot auto-pay L402 invoices");
  }

  // Read macaroon
  const { readFile: readFileAsync } = await import("node:fs/promises");
  const macaroonBytes = await readFileAsync(config.lndMacaroonPath);
  const macaroonHex = Buffer.from(macaroonBytes).toString("hex");

  // Build TLS agent if cert provided
  const headers: Record<string, string> = {
    "Grpc-Metadata-macaroon": macaroonHex,
    "Content-Type": "application/json",
  };

  const payUrl = `${config.lndHost}/v2/router/send`;
  const res = await fetch(payUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      payment_request: bolt11,
      timeout_seconds: 30,
      fee_limit_sat: "100",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LND payment failed: ${res.status} ${text}`);
  }

  // Streaming response — read until we get the preimage
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const result = obj["result"] as Record<string, unknown> | undefined;
      if (result?.["status"] === "SUCCEEDED") {
        const preimage = result["payment_preimage"] as string;
        // LND returns base64, convert to hex
        const buf = Buffer.from(preimage, "base64");
        return buf.toString("hex");
      }
      if (result?.["status"] === "FAILED") {
        throw new Error(`Payment failed: ${JSON.stringify(result["failure_reason"])}`);
      }
    } catch {
      // Skip unparseable lines
    }
  }

  throw new Error("LND payment: no success status in response");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function extFromMime(mime?: string): string {
  if (!mime) return ".bin";
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "text/plain": ".txt",
    "text/html": ".html",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "application/zip": ".zip",
  };
  return map[mime] ?? ".bin";
}
