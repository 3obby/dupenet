/**
 * dupenet upload <file>
 *
 * Chunk file → PUT /block × N → PUT /file → PUT /asset → print asset_root URL.
 * DocRef: MVP_PLAN:§Upload / Ingestion, §File Layer
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  chunkFile,
  cidFromBytes,
  cidFromObject,
  signEvent,
  encodeEventBody,
  EVENT_KIND_ANNOUNCE,
  type AssetRootV1,
} from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { loadKeys } from "../lib/keys.js";
import { httpPutBytes, httpPutJson, httpPost } from "../lib/http.js";
import { mimeFromPath, kindFromMime } from "../lib/mime.js";

interface EventResponse {
  ok: boolean;
  event_id: string;
}

export interface UploadOpts {
  title?: string;
  tags?: string;
  access?: string;
}

export async function uploadCommand(
  filePath: string,
  config: CliConfig,
  opts: UploadOpts = {},
): Promise<void> {
  // 1. Read file
  const fileBytes = new Uint8Array(await readFile(filePath));
  const mime = mimeFromPath(filePath);
  const kind = kindFromMime(mime);
  const fileName = basename(filePath);

  console.log(`Uploading ${fileName} (${formatSize(fileBytes.length)}, ${mime})`);

  // 2. Chunk
  const { blocks, manifest, file_root } = chunkFile(fileBytes, mime);
  console.log(`  ${blocks.length} block(s), file_root: ${file_root}`);

  // 3. PUT /block/:cid for each block
  let uploaded = 0;
  for (const block of blocks) {
    const url = `${config.gateway}/block/${block.cid}`;
    const result = await httpPutBytes(url, block.bytes);
    if (!result.ok && result.status !== 409) {
      throw new Error(`Failed to upload block ${block.cid}: ${result.status} ${result.body}`);
    }
    uploaded++;
    const pct = Math.round((uploaded / blocks.length) * 100);
    process.stdout.write(`\r  Blocks: ${uploaded}/${blocks.length} (${pct}%)`);
  }
  console.log(); // newline after progress

  // 4. PUT /file/:root
  const fileUrl = `${config.gateway}/file/${file_root}`;
  await httpPutJson(fileUrl, manifest);
  console.log(`  File manifest registered`);

  // 5. Build AssetRootV1
  const originalHash = cidFromBytes(fileBytes);
  const assetRoot: AssetRootV1 = {
    version: 1,
    kind,
    original: {
      file_root,
      size: fileBytes.length,
      ...(mime ? { mime } : {}),
    },
    variants: [],
    meta: {
      sha256_original: originalHash,
    },
  };
  const assetRootCid = cidFromObject(assetRoot);

  // 6. PUT /asset/:root
  const assetUrl = `${config.gateway}/asset/${assetRootCid}`;
  await httpPutJson(assetUrl, assetRoot);
  console.log(`  Asset registered`);

  // 7. Emit ANNOUNCE event (if keys available)
  let announceId: string | undefined;
  try {
    const keys = await loadKeys(config.keyPath);
    const announceBody = encodeEventBody({
      title: opts.title ?? fileName,
      mime,
      size: fileBytes.length,
      access: opts.access ?? "paid",
      ...(opts.tags ? { tags: opts.tags.split(",").map((t) => t.trim()) } : {}),
    });

    const signed = await signEvent(keys.privateKey, {
      v: 1,
      kind: EVENT_KIND_ANNOUNCE,
      from: keys.publicKeyHex,
      ref: assetRootCid,
      body: announceBody,
      sats: 0,
      ts: Date.now(),
    });

    const result = await httpPost<EventResponse>(
      `${config.coordinator}/event`,
      signed,
    );
    announceId = result.event_id;
    console.log(`  Announced (event_id: ${announceId.slice(0, 12)}..)`);
  } catch {
    // No keys or coordinator unavailable — skip announce (upload still succeeded)
    console.log(`  (announce skipped — run 'dupenet keygen' or check coordinator)`);
  }

  // 8. Print result
  console.log();
  console.log(`asset_root: ${assetRootCid}`);
  console.log(`url:        ${config.gateway}/asset/${assetRootCid}`);
  if (announceId) {
    console.log(`event_id:   ${announceId}`);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
