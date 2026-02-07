/**
 * File chunker — split files into content-addressed blocks.
 * DocRef: MVP_PLAN:§File Layer (Chunked Content), §Upload / Ingestion
 *
 * 1. Chunk file → CHUNK_SIZE_DEFAULT blocks
 * 2. block_cid = SHA256(block_bytes) per block
 * 3. Build FileManifestV1 → file_root = SHA256(canonical(manifest))
 */

import { CHUNK_SIZE_DEFAULT } from "./constants.js";
import { cidFromBytes, cidFromObject, type CID } from "./cid.js";
import { merkleRoot } from "./merkle.js";
import type { FileManifestV1 } from "./schemas/file-manifest.js";

export interface ChunkResult {
  /** Ordered list of (block_cid, block_bytes) pairs. */
  blocks: { cid: CID; bytes: Uint8Array }[];
  /** The constructed file manifest. */
  manifest: FileManifestV1;
  /** SHA256(canonical(manifest)) */
  file_root: CID;
}

/**
 * Chunk a file into blocks, compute CIDs, build manifest.
 */
export function chunkFile(
  fileBytes: Uint8Array,
  mime?: string,
  chunkSize: number = CHUNK_SIZE_DEFAULT,
): ChunkResult {
  const blocks: { cid: CID; bytes: Uint8Array }[] = [];

  for (let offset = 0; offset < fileBytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, fileBytes.length);
    const block = fileBytes.slice(offset, end);
    blocks.push({ cid: cidFromBytes(block), bytes: block });
  }

  // Handle empty file as single empty block
  if (blocks.length === 0) {
    const empty = new Uint8Array(0);
    blocks.push({ cid: cidFromBytes(empty), bytes: empty });
  }

  const blockCids = blocks.map((b) => b.cid);
  const root = merkleRoot(blockCids);

  const manifest: FileManifestV1 = {
    version: 1,
    chunk_size: chunkSize,
    size: fileBytes.length,
    blocks: blockCids,
    merkle_root: root,
    ...(mime ? { mime } : {}),
  };

  const file_root = cidFromObject(manifest);

  return { blocks, manifest, file_root };
}

/**
 * Reassemble file bytes from ordered blocks.
 * Verifies each block's CID matches expected.
 */
export function reassembleFile(
  manifest: FileManifestV1,
  blocks: ReadonlyMap<CID, Uint8Array>,
): Uint8Array {
  const result = new Uint8Array(manifest.size);
  let offset = 0;

  for (const expectedCid of manifest.blocks) {
    const blockBytes = blocks.get(expectedCid);
    if (!blockBytes) {
      throw new Error(`Missing block: ${expectedCid}`);
    }
    const actualCid = cidFromBytes(blockBytes);
    if (actualCid !== expectedCid) {
      throw new Error(
        `Block CID mismatch: expected ${expectedCid}, got ${actualCid}`,
      );
    }
    result.set(blockBytes, offset);
    offset += blockBytes.length;
  }

  if (offset !== manifest.size) {
    throw new Error(
      `Size mismatch: expected ${manifest.size}, got ${offset}`,
    );
  }

  return result;
}
