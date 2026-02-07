/**
 * Receipt challenge, PoW, and payload construction.
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

// ── Helpers ────────────────────────────────────────────────────────

function concatParts(parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

// ── Challenge construction ─────────────────────────────────────────

/**
 * Build the raw challenge data bytes (before hashing).
 * Needed for client signature payload.
 */
export function buildChallengeRaw(input: ChallengeInput): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(RECEIPT_CHALLENGE_PREFIX)];

  if (input.asset_root) {
    parts.push(fromHex(input.asset_root));
  }
  parts.push(fromHex(input.file_root));
  parts.push(fromHex(input.block_cid));
  parts.push(fromHex(input.host_pubkey));
  parts.push(fromHex(input.payment_hash));
  parts.push(fromHex(input.response_hash));
  parts.push(uint32BE(input.epoch));
  parts.push(fromHex(input.client_pubkey));

  return concatParts(parts);
}

/**
 * Build the receipt challenge hash (SHA256 of raw data).
 * Used for PoW mining: find nonce where H(challenge || nonce) < TARGET.
 */
export function buildChallenge(input: ChallengeInput): Uint8Array {
  return sha256(buildChallengeRaw(input));
}

// ── Token payload (for mint signing / verification) ────────────────

/**
 * Build the receipt token payload that the mint signs.
 * token = Sign_mint_sk("R2" || host || epoch || block_cid || response_hash || price || payment_hash)
 */
export function buildTokenPayload(input: {
  host_pubkey: string;
  epoch: number;
  block_cid: string;
  response_hash: string;
  price_sats: number;
  payment_hash: string;
}): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode("R2"),
    fromHex(input.host_pubkey),
    uint32BE(input.epoch),
    fromHex(input.block_cid),
    fromHex(input.response_hash),
    uint32BE(input.price_sats),
    fromHex(input.payment_hash),
  ];
  return concatParts(parts);
}

// ── Client signature payload ───────────────────────────────────────

/**
 * Build the payload the client signs for a receipt.
 * client_sig = Sign(client_sk, challengeRaw || nonce || pow_hash)
 */
export function buildClientSigPayload(
  challengeRaw: Uint8Array,
  nonce: bigint,
  powHash: string,
): Uint8Array {
  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, nonce, false);
  const powHashBytes = fromHex(powHash);

  const result = new Uint8Array(challengeRaw.length + 8 + 32);
  result.set(challengeRaw, 0);
  result.set(nonceBuf, challengeRaw.length);
  result.set(powHashBytes, challengeRaw.length + 8);
  return result;
}

// ── PoW computation ────────────────────────────────────────────────

/**
 * Compute PoW hash for a given challenge and nonce.
 */
export function computePowHash(
  challenge: Uint8Array,
  nonce: bigint,
): string {
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

/**
 * Mine a valid PoW nonce for a given challenge and target.
 * Returns { nonce, powHash } or throws after maxAttempts.
 */
export function minePoW(
  challenge: Uint8Array,
  target: bigint,
  maxAttempts: number = 10_000_000,
): { nonce: bigint; powHash: string } {
  for (let n = 0n; n < BigInt(maxAttempts); n++) {
    const hash = computePowHash(challenge, n);
    if (powMeetsTarget(hash, target)) {
      return { nonce: n, powHash: hash };
    }
  }
  throw new Error(`PoW: no valid nonce found in ${maxAttempts} attempts`);
}
