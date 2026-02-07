/**
 * Canonical serialization — deterministic CBOR encoding.
 * DocRef: MVP_PLAN:§Canonicalization, SPEC:§Freeze Layers (Frozen)
 *
 * Rules:
 *   1. Stable field order (lexicographic by key)
 *   2. No floats (integers only for all numeric values)
 *   3. Deterministic encoding (same object → identical bytes, always)
 *   4. CBOR (RFC 8949) with canonical map key ordering
 */

import { Encoder } from "cbor-x";

const encoder = new Encoder({
  // Canonical CBOR: deterministic length encoding, sorted map keys
  structuredClone: false,
  mapsAsObjects: true, // decode maps as plain JS objects
  useRecords: false,
  pack: false,
});

/**
 * Sort object keys lexicographically (recursive, depth-first).
 * Ensures deterministic field order before CBOR encoding.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Uint8Array) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Canonical encode: sort keys lexicographically, then CBOR encode.
 * This is the ONLY way to serialize objects for hashing in this protocol.
 */
export function canonicalEncode(obj: unknown): Uint8Array {
  const sorted = sortKeys(obj);
  return encoder.encode(sorted);
}

/**
 * Decode canonical CBOR bytes back to an object.
 */
export function canonicalDecode(bytes: Uint8Array): unknown {
  return encoder.decode(bytes);
}
