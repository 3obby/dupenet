/**
 * Event signature — sign and verify protocol events.
 * DocRef: MVP_PLAN:§Longevity L4 (signed events)
 *
 * Every mutation in the event log is signed by the actor:
 *   sig = Ed25519_sign(private_key, canonical(payload))
 *
 * Verification:
 *   Ed25519_verify(pubkey, sig, canonical(payload)) → bool
 *
 * The signature covers the canonical-encoded payload, not the
 * JSON wire format. This ensures signature stability across
 * serialization formats.
 */

import { canonicalEncode } from "./canonical.js";
import { fromHex } from "./cid.js";
import { ed25519Sign, ed25519Verify } from "./ed25519.js";

// ── Base64 helpers ─────────────────────────────────────────────────

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += B64[(a >> 2)]!;
    result += B64[((a & 3) << 4) | (b >> 4)]!;
    if (i + 1 < bytes.length) result += B64[((b & 15) << 2) | (c >> 6)]!;
    else result += "=";
    if (i + 2 < bytes.length) result += B64[(c & 63)]!;
    else result += "=";
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
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

// ── Sign ───────────────────────────────────────────────────────────

/**
 * Sign an event payload.
 *
 * @param privateKey - 32-byte Ed25519 seed
 * @param payload - The event payload object (will be canonical-encoded)
 * @returns Base64-encoded Ed25519 signature
 */
export async function signEventPayload(
  privateKey: Uint8Array,
  payload: unknown,
): Promise<string> {
  const message = canonicalEncode(payload);
  const sig = await ed25519Sign(privateKey, message);
  return bytesToBase64(sig);
}

// ── Verify ─────────────────────────────────────────────────────────

/**
 * Verify an event signature against a pubkey and payload.
 *
 * @param pubkeyHex - 64-char hex Ed25519 public key
 * @param sigBase64 - Base64-encoded Ed25519 signature
 * @param payload - The event payload object (will be canonical-encoded)
 * @returns true if signature is valid
 */
export async function verifyEventSignature(
  pubkeyHex: string,
  sigBase64: string,
  payload: unknown,
): Promise<boolean> {
  if (!pubkeyHex || !sigBase64) return false;
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) return false;

  try {
    const pubkeyBytes = fromHex(pubkeyHex);
    const sigBytes = base64ToBytes(sigBase64);
    if (sigBytes.length !== 64) return false;

    const message = canonicalEncode(payload);
    return await ed25519Verify(pubkeyBytes, sigBytes, message);
  } catch {
    return false;
  }
}
