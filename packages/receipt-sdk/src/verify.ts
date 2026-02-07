/**
 * VerifyReceiptV2 — the single function external adopters import.
 * DocRef: MVP_PLAN:§Receipt Verification SDK
 *
 * Checks:
 *   1. client_sig over receipt fields (Ed25519)
 *   2. pow_hash = H(challenge || nonce) < TARGET
 *   3. receipt_token against any mint in pubkey set (Ed25519)
 *
 * No LN state. No network calls. No protocol context.
 * Pure function. Works offline.
 */

import { ed25519Verify } from "./ed25519.js";

// ── Inline helpers (no imports from physics — this is zero-dep) ────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

function uint64BE(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, n, false);
  return buf;
}

// Web Crypto type bridge (see ed25519.ts for explanation)
function wcBuf(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }
  return data.slice().buffer as ArrayBuffer;
}

/** SHA-256 via SubtleCrypto (available everywhere). */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", wcBuf(data));
  return new Uint8Array(hash);
}

// ── Receipt type (minimal, no TypeBox dependency) ──────────────────

export interface ReceiptV2Input {
  asset_root?: string; // hex, 64 chars
  file_root: string;
  block_cid: string;
  host_pubkey: string;
  payment_hash: string;
  response_hash: string;
  price_sats: number;
  receipt_token: string; // base64 encoded
  epoch: number;
  nonce: number | bigint;
  pow_hash: string;
  client_pubkey: string;
  client_sig: string; // base64 encoded
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

const RECEIPT_CHALLENGE_PREFIX = "RECEIPT_V2";
const POW_TARGET_BASE = 2n ** 240n;

// ── Receipt token payload construction ─────────────────────────────

function buildTokenPayload(
  hostPubkey: string,
  epoch: number,
  blockCid: string,
  responseHash: string,
  priceSats: number,
  paymentHash: string,
): Uint8Array {
  const encoder = new TextEncoder();
  return concatBytes(
    encoder.encode("R2"),
    hexToBytes(hostPubkey),
    uint32BE(epoch),
    hexToBytes(blockCid),
    hexToBytes(responseHash),
    uint32BE(priceSats),
    hexToBytes(paymentHash),
  );
}

// ── Challenge construction ─────────────────────────────────────────

function buildChallengeData(r: ReceiptV2Input): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(RECEIPT_CHALLENGE_PREFIX)];

  if (r.asset_root) parts.push(hexToBytes(r.asset_root));
  parts.push(hexToBytes(r.file_root));
  parts.push(hexToBytes(r.block_cid));
  parts.push(hexToBytes(r.host_pubkey));
  parts.push(hexToBytes(r.payment_hash));
  parts.push(hexToBytes(r.response_hash));
  parts.push(uint32BE(r.epoch));
  parts.push(hexToBytes(r.client_pubkey));

  return concatBytes(...parts);
}

// ── Client signature payload ───────────────────────────────────────

function buildClientSigPayload(r: ReceiptV2Input): Uint8Array {
  // Client signs: challenge_data || nonce || pow_hash
  const challengeData = buildChallengeData(r);
  const nonce = typeof r.nonce === "bigint" ? r.nonce : BigInt(r.nonce);
  return concatBytes(
    challengeData,
    uint64BE(nonce),
    hexToBytes(r.pow_hash),
  );
}

// ── Main verification function ─────────────────────────────────────

/**
 * Verify a ReceiptV2 against a set of known mint public keys.
 *
 * @param receipt - The receipt to verify
 * @param mintPubkeys - Array of hex-encoded Ed25519 public keys of trusted mints
 * @returns Verification result with error message if invalid
 */
export async function verifyReceiptV2(
  receipt: ReceiptV2Input,
  mintPubkeys: readonly string[],
): Promise<VerifyResult> {
  // 1. Validate hex field lengths
  const hex64Fields = [
    "file_root",
    "block_cid",
    "host_pubkey",
    "payment_hash",
    "response_hash",
    "pow_hash",
    "client_pubkey",
  ] as const;

  for (const field of hex64Fields) {
    if (!/^[0-9a-f]{64}$/.test(receipt[field])) {
      return { valid: false, error: `invalid_${field}` };
    }
  }

  if (receipt.asset_root && !/^[0-9a-f]{64}$/.test(receipt.asset_root)) {
    return { valid: false, error: "invalid_asset_root" };
  }

  // 2. Verify PoW: H(challenge || nonce) < TARGET
  const challengeData = buildChallengeData(receipt);
  const challengeHash = await sha256(challengeData);
  const nonce =
    typeof receipt.nonce === "bigint" ? receipt.nonce : BigInt(receipt.nonce);
  const powInput = concatBytes(challengeHash, uint64BE(nonce));
  const computedPow = await sha256(powInput);
  const computedPowHex = bytesToHex(computedPow);

  if (computedPowHex !== receipt.pow_hash) {
    return { valid: false, error: "pow_hash_mismatch" };
  }

  const powValue = BigInt("0x" + receipt.pow_hash);
  if (powValue >= POW_TARGET_BASE) {
    return { valid: false, error: "pow_invalid" };
  }

  // 3. Verify receipt_token against any mint in set
  const tokenPayload = buildTokenPayload(
    receipt.host_pubkey,
    receipt.epoch,
    receipt.block_cid,
    receipt.response_hash,
    receipt.price_sats,
    receipt.payment_hash,
  );

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = base64ToBytes(receipt.receipt_token);
  } catch {
    return { valid: false, error: "token_decode_failed" };
  }

  if (tokenBytes.length !== 64) {
    return { valid: false, error: "token_invalid_length" };
  }

  let tokenValid = false;
  for (const mintPk of mintPubkeys) {
    const mintPkBytes = hexToBytes(mintPk);
    if (await ed25519Verify(mintPkBytes, tokenBytes, tokenPayload)) {
      tokenValid = true;
      break;
    }
  }

  if (!tokenValid) {
    return { valid: false, error: "token_invalid" };
  }

  // 4. Verify client_sig over receipt
  const clientSigPayload = buildClientSigPayload(receipt);
  let clientSigBytes: Uint8Array;
  try {
    clientSigBytes = base64ToBytes(receipt.client_sig);
  } catch {
    return { valid: false, error: "client_sig_decode_failed" };
  }

  const clientPkBytes = hexToBytes(receipt.client_pubkey);
  if (
    !(await ed25519Verify(clientPkBytes, clientSigBytes, clientSigPayload))
  ) {
    return { valid: false, error: "client_sig_invalid" };
  }

  return { valid: true };
}

// ── Base64 helper (no btoa/atob for Uint8Array compat) ─────────────

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(b64: string): Uint8Array {
  // Strip padding
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]!);
    const b = B64.indexOf(clean[i + 1]!);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0;

    bytes.push((a << 2) | (b >> 4));
    if (i + 2 < clean.length) bytes.push(((b & 15) << 4) | (c >> 2));
    if (i + 3 < clean.length) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
}
