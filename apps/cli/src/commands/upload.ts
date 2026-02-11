/**
 * dupenet upload <path>
 *
 * Single file: chunk → PUT blocks → PUT file → PUT asset → ANNOUNCE → print asset_root.
 * Directory:   recursive traversal → upload each file → LIST event for collection.
 *
 * Resume: 409 Conflict on PUT /block = already uploaded → skip.
 * DocRef: MVP_PLAN:§Upload / Ingestion, §File Layer, §Sprint 7c
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
  chunkFile,
  cidFromBytes,
  cidFromObject,
  signEvent,
  encodeEventBody,
  EVENT_KIND_ANNOUNCE,
  EVENT_KIND_LIST,
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
  /** Author's Ed25519 pubkey (hex). If omitted, uploader's key is the author. */
  authorPubkey?: string;
  /** Revenue share in basis points (0–10000). Third-party payments only. */
  revshare?: number;
}

// ── Known MIME extensions for directory filter ─────────────────────

const KNOWN_EXTENSIONS = new Set([
  ".txt", ".html", ".htm", ".css", ".js", ".json", ".xml", ".csv", ".md",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif", ".avif",
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".opus",
  ".mp4", ".webm", ".mkv", ".avi", ".mov",
  ".pdf", ".zip", ".gz", ".tar", ".7z", ".rar",
]);

function hasKnownExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext);
}

// ── Entry point ───────────────────────────────────────────────────

export async function uploadCommand(
  path: string,
  config: CliConfig,
  opts: UploadOpts = {},
): Promise<void> {
  const info = await stat(path);

  if (info.isFile()) {
    await uploadSingleFile(path, config, opts);
  } else if (info.isDirectory()) {
    await uploadDirectory(path, config, opts);
  } else {
    throw new Error(`Not a file or directory: ${path}`);
  }
}

// ── Single file upload ────────────────────────────────────────────

interface UploadResult {
  assetRootCid: string;
  announceId?: string;
  size: number;
  blocks: number;
}

async function uploadSingleFile(
  filePath: string,
  config: CliConfig,
  opts: UploadOpts = {},
  quiet = false,
): Promise<UploadResult> {
  const fileBytes = new Uint8Array(await readFile(filePath));
  const mime = mimeFromPath(filePath);
  const kind = kindFromMime(mime);
  const fileName = basename(filePath);

  if (!quiet) console.log(`${fileName} (${fmtSize(fileBytes.length)}, ${mime})`);

  // Chunk
  const { blocks, manifest, file_root } = chunkFile(fileBytes, mime);
  if (!quiet) console.log(`  ${blocks.length} block(s)`);

  // PUT /block/:cid — skip 409 (already uploaded)
  let uploaded = 0;
  let skipped = 0;
  for (const block of blocks) {
    const url = `${config.gateway}/block/${block.cid}`;
    const result = await httpPutBytes(url, block.bytes);
    if (result.status === 409) {
      skipped++;
    } else if (!result.ok) {
      throw new Error(`block ${block.cid}: ${result.status} ${result.body}`);
    }
    uploaded++;
    if (!quiet) {
      const pct = Math.round((uploaded / blocks.length) * 100);
      process.stdout.write(`\r  blocks: ${uploaded}/${blocks.length} (${pct}%)${skipped > 0 ? ` ${skipped} cached` : ""}`);
    }
  }
  if (!quiet && blocks.length > 0) console.log();

  // PUT /file/:root
  await httpPutJson(`${config.gateway}/file/${file_root}`, manifest);

  // Build AssetRootV1
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
    meta: { sha256_original: originalHash },
  };
  const assetRootCid = cidFromObject(assetRoot);

  // PUT /asset/:root
  await httpPutJson(`${config.gateway}/asset/${assetRootCid}`, assetRoot);

  // ANNOUNCE event
  let announceId: string | undefined;
  try {
    const keys = await loadKeys(config.keyPath);
    const announceBody = encodeEventBody({
      title: opts.title ?? fileName,
      mime,
      size: fileBytes.length,
      access: opts.access ?? "paid",
      ...(opts.tags ? { tags: opts.tags.split(",").map((t) => t.trim()) } : {}),
      ...(opts.authorPubkey ? { author_pubkey: opts.authorPubkey } : {}),
      ...(opts.revshare !== undefined && opts.revshare > 0 ? { revshare_bps: opts.revshare } : {}),
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

    const result = await httpPost<EventResponse>(`${config.coordinator}/event`, signed);
    announceId = result.event_id;
    if (!quiet) console.log(`  announced ${announceId.slice(0, 12)}..`);
  } catch {
    if (!quiet) console.log(`  (announce skipped)`);
  }

  if (!quiet) {
    console.log(`  asset: ${assetRootCid}`);
  }

  return { assetRootCid, announceId, size: fileBytes.length, blocks: blocks.length };
}

// ── Directory upload ──────────────────────────────────────────────

async function uploadDirectory(
  dirPath: string,
  config: CliConfig,
  opts: UploadOpts = {},
): Promise<void> {
  // Collect files recursively
  const files = await collectFiles(dirPath);
  if (files.length === 0) {
    console.log(`No uploadable files found in ${dirPath}`);
    return;
  }

  const dirName = basename(dirPath);
  const title = opts.title ?? dirName;
  console.log(`${title} — ${files.length} file(s)`);
  console.log();

  // Upload each file
  const results: UploadResult[] = [];
  let totalBlocks = 0;
  let totalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const rel = relative(dirPath, file);
    console.log(`[${i + 1}/${files.length}] ${rel}`);

    try {
      // Per-file: use filename as title, inherit tags/access from opts
      const fileOpts: UploadOpts = {
        title: rel,
        tags: opts.tags,
        access: opts.access,
      };
      const result = await uploadSingleFile(file, config, fileOpts, false);
      results.push(result);
      totalBlocks += result.blocks;
      totalBytes += result.size;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FAILED: ${msg}`);
      // Continue with remaining files
    }
  }

  console.log();
  console.log(`uploaded ${results.length}/${files.length} files (${fmtSize(totalBytes)}, ${totalBlocks} blocks)`);

  if (results.length === 0) return;

  // Emit LIST event for the collection
  try {
    const keys = await loadKeys(config.keyPath);
    const items = results.map((r) => r.assetRootCid);
    const listBody = encodeEventBody({
      title,
      description: opts.tags ? `[${opts.tags}]` : undefined,
      items,
    });

    // ref = zero (top-level collection)
    const zeroRef = "0".repeat(64);
    const signed = await signEvent(keys.privateKey, {
      v: 1,
      kind: EVENT_KIND_LIST,
      from: keys.publicKeyHex,
      ref: zeroRef,
      body: listBody,
      sats: 0,
      ts: Date.now(),
    });

    const result = await httpPost<EventResponse>(`${config.coordinator}/event`, signed);
    console.log(`collection: ${result.event_id}`);
  } catch {
    console.log(`(LIST event skipped — run 'dupenet keygen' or check coordinator)`);
  }
}

// ── Recursive file collection ─────────────────────────────────────

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    // Skip hidden files/dirs
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await collectFiles(fullPath);
      files.push(...sub);
    } else if (entry.isFile() && hasKnownExtension(entry.name)) {
      files.push(fullPath);
    }
  }

  // Sort for deterministic order
  files.sort();
  return files;
}

// ── Helpers ───────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}G`;
}
