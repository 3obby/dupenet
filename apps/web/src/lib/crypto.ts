/**
 * Browser-compatible cryptographic utilities for EventV1.
 * Uses @noble/ed25519 + @noble/hashes (cross-browser, including Firefox).
 * Includes minimal deterministic CBOR encoder matching physics canonicalEncode.
 *
 * Zero dependency on @dupenet/physics — avoids bundling cbor-x in the browser.
 */

import { sign, getPublicKey, etc } from "@noble/ed25519";
import { sha512, sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// Configure @noble/ed25519 with SHA-512 (required by the library)
etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const h = sha512.create();
  for (const m of msgs) h.update(m);
  return h.digest();
};

// ── Hex + Base64 utilities ────────────────────────────────────────

export const toHex = bytesToHex;
export const fromHex = hexToBytes;

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    result += B64[a >> 2]!;
    result += B64[((a & 3) << 4) | (b >> 4)]!;
    if (i + 1 < bytes.length) result += B64[((b & 15) << 2) | (c >> 6)]!;
    else result += "=";
    if (i + 2 < bytes.length) result += B64[c & 63]!;
    else result += "=";
  }
  return result;
}

// ── Minimal Deterministic CBOR Encoder ────────────────────────────
// RFC 8949 canonical: shortest length encoding, sorted map keys.
// Handles: unsigned int, text string, byte string, map, array, null.
// Produces byte-identical output to physics canonicalEncode (cbor-x).

function encodeHead(majorType: number, value: number): number[] {
  const mt = majorType << 5;
  if (value < 24) return [mt | value];
  if (value < 0x100) return [mt | 24, value];
  if (value < 0x10000)
    return [mt | 25, (value >> 8) & 0xff, value & 0xff];
  if (value < 0x100000000)
    return [
      mt | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
  // > 32-bit (timestamps, large sats values)
  const hi = Math.floor(value / 0x100000000);
  const lo = value >>> 0;
  return [
    mt | 27,
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  ];
}

function cborEncode(value: unknown): number[] {
  if (value === null || value === undefined) return [0xf6];
  if (typeof value === "boolean") return [value ? 0xf5 : 0xf4];
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0)
      throw new Error("only non-negative integers supported");
    return encodeHead(0, value);
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return [...encodeHead(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) {
    return [...encodeHead(2, value.length), ...value];
  }
  if (Array.isArray(value)) {
    const out: number[] = encodeHead(4, value.length);
    for (const item of value) out.push(...cborEncode(item));
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: number[] = encodeHead(5, keys.length);
    for (const key of keys) {
      out.push(...cborEncode(key));
      out.push(...cborEncode(obj[key]));
    }
    return out;
  }
  throw new Error(`unsupported CBOR type: ${typeof value}`);
}

/** Canonical CBOR encode (sorted keys, shortest length). */
export function canonicalEncode(obj: unknown): Uint8Array {
  return new Uint8Array(cborEncode(obj));
}

// ── SHA-256 ───────────────────────────────────────────────────────

export function computeSha256(data: Uint8Array): Uint8Array {
  return sha256(data);
}

// ── Ed25519 ───────────────────────────────────────────────────────

/** Generate Ed25519 keypair. Returns raw 32-byte seed + 32-byte pubkey. */
export async function generateKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = await getPublicKey(privateKey);
  return { privateKey, publicKey };
}

// ── EventV1 signing ───────────────────────────────────────────────

interface UnsignedEvent {
  v: number;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
}

function signingPayload(event: UnsignedEvent): Record<string, unknown> {
  return {
    v: event.v,
    kind: event.kind,
    from: event.from,
    ref: event.ref,
    body: event.body,
    sats: event.sats,
    ts: event.ts,
  };
}

/** Compute event_id = SHA256(canonical(EventV1 minus sig)). */
export function computeEventId(event: UnsignedEvent): string {
  const encoded = canonicalEncode(signingPayload(event));
  return toHex(computeSha256(encoded));
}

/** Sign an unsigned event → EventV1 with sig. */
export async function signEvent(
  privateKey: Uint8Array,
  event: UnsignedEvent,
): Promise<UnsignedEvent & { sig: string }> {
  const encoded = canonicalEncode(signingPayload(event));
  const sigBytes = await sign(encoded, privateKey);
  return { ...event, sig: bytesToBase64(sigBytes) };
}

/** Encode a body payload into hex string (canonical CBOR). */
export function encodeEventBody(payload: unknown): string {
  const bytes = canonicalEncode(payload);
  return toHex(bytes);
}
