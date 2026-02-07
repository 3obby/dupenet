/**
 * Block selection — anti-special-casing PRF.
 * DocRef: MVP_PLAN:§Block Selection (Anti-Special-Casing)
 *
 * block_index = PRF(epoch_seed || file_root || client_pubkey) mod num_blocks
 *
 * Host can't predict which block a client will request until the client
 * reveals their pubkey for that epoch. Forces hosts to store ALL blocks.
 *
 * Used by:
 *   - Clients: to know which block to fetch for a receipt
 *   - Receipt verifiers: to validate the receipt references the correct block
 *   - Spot-checks: to verify hosts serve the right block
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fromHex, type CID } from "./cid.js";

// ── Helpers ────────────────────────────────────────────────────────

const BLOCK_SELECT_PREFIX = "BLOCK_SELECT";

function uint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

// ── PRF ────────────────────────────────────────────────────────────

/**
 * Compute the deterministic block index for a given (epoch, file, client).
 *
 * PRF = SHA256("BLOCK_SELECT" || epoch_u32be || file_root || client_pubkey)
 * index = PRF_as_uint % numBlocks
 *
 * @returns block index in [0, numBlocks)
 */
export function selectBlockIndex(
  epoch: number,
  fileRoot: CID,
  clientPubkey: CID,
  numBlocks: number,
): number {
  if (numBlocks <= 0) return 0;
  if (numBlocks === 1) return 0;

  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(BLOCK_SELECT_PREFIX),
    uint32BE(epoch),
    fromHex(fileRoot),
    fromHex(clientPubkey),
  ];

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  const hash = sha256(combined);

  // Use first 6 bytes as a number (48 bits — enough for uniform mod up to 2^48)
  // Avoids BigInt for performance; MAX_MANIFEST_BLOCKS = 32768 fits easily
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  const high = view.getUint16(0);
  const low = view.getUint32(2);
  const prfValue = high * 0x100000000 + low; // 48-bit number

  return prfValue % numBlocks;
}

/**
 * Select the block CID from a manifest's block list.
 *
 * @returns { index, blockCid } for the deterministic block selection
 */
export function selectBlock(
  epoch: number,
  fileRoot: CID,
  clientPubkey: CID,
  blocks: readonly CID[],
): { index: number; blockCid: CID } {
  if (blocks.length === 0) {
    throw new Error("selectBlock: empty blocks array");
  }
  const index = selectBlockIndex(epoch, fileRoot, clientPubkey, blocks.length);
  return { index, blockCid: blocks[index]! };
}

/**
 * Verify that a block CID is the correct selection for the given parameters.
 * Used by receipt verifiers and spot-checks.
 *
 * @returns true if blockCid matches the PRF-selected block
 */
export function verifyBlockSelection(
  epoch: number,
  fileRoot: CID,
  clientPubkey: CID,
  blockCid: CID,
  blocks: readonly CID[],
): boolean {
  if (blocks.length === 0) return false;
  const { blockCid: expected } = selectBlock(epoch, fileRoot, clientPubkey, blocks);
  return expected === blockCid;
}

/**
 * Get the raw PRF hash for a given (epoch, file, client).
 * Useful for debugging and test vectors.
 */
export function blockSelectionPrfHash(
  epoch: number,
  fileRoot: CID,
  clientPubkey: CID,
): string {
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(BLOCK_SELECT_PREFIX),
    uint32BE(epoch),
    fromHex(fileRoot),
    fromHex(clientPubkey),
  ];

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return bytesToHex(sha256(combined));
}
