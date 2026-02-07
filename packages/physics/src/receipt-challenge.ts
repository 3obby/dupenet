/**
 * Receipt challenge and PoW computation.
 * DocRef: MVP_PLAN:§Receipt Rules, §Difficulty Schedule
 *
 * challenge = H("RECEIPT_V2" || asset_root? || file_root || block_cid ||
 *               host || payment_hash || response_hash || epoch || client_pubkey)
 * valid if: pow_hash = H(challenge || nonce) < TARGET
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fromHex, type CID } from "./cid.js";
import { RECEIPT_CHALLENGE_PREFIX } from "./schemas/receipt.js";
import { POW_TARGET_BASE } from "./constants.js";

export interface ChallengeInput {
  asset_root?: CID;
  file_root: CID;
  block_cid: CID;
  host_pubkey: CID;
  payment_hash: CID;
  response_hash: CID;
  epoch: number;
  client_pubkey: CID;
}

/**
 * Build the receipt challenge bytes.
 */
export function buildChallenge(input: ChallengeInput): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode(RECEIPT_CHALLENGE_PREFIX),
  ];

  if (input.asset_root) {
    parts.push(fromHex(input.asset_root));
  }
  parts.push(fromHex(input.file_root));
  parts.push(fromHex(input.block_cid));
  parts.push(fromHex(input.host_pubkey));
  parts.push(fromHex(input.payment_hash));
  parts.push(fromHex(input.response_hash));

  // Epoch as 4-byte big-endian
  const epochBuf = new Uint8Array(4);
  new DataView(epochBuf.buffer).setUint32(0, input.epoch, false);
  parts.push(epochBuf);

  parts.push(fromHex(input.client_pubkey));

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return sha256(result);
}

/**
 * Compute PoW hash for a given challenge and nonce.
 */
export function computePowHash(
  challenge: Uint8Array,
  nonce: bigint,
): string {
  // nonce as 8-byte big-endian
  const nonceBuf = new Uint8Array(8);
  const view = new DataView(nonceBuf.buffer);
  view.setBigUint64(0, nonce, false);

  const combined = new Uint8Array(challenge.length + 8);
  combined.set(challenge, 0);
  combined.set(nonceBuf, challenge.length);

  return bytesToHex(sha256(combined));
}

/**
 * Get the PoW target for a given receipt count.
 * Difficulty escalates: TARGET_BASE >> floor(log2(receipt_count + 1))
 */
export function getTarget(receiptCount: number): bigint {
  const shift = Math.floor(Math.log2(receiptCount + 1));
  return POW_TARGET_BASE >> BigInt(shift);
}

/**
 * Check if a PoW hash meets the target.
 */
export function powMeetsTarget(powHashHex: string, target: bigint): boolean {
  const hashValue = BigInt("0x" + powHashHex);
  return hashValue < target;
}
