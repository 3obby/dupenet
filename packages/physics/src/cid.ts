/**
 * Content Identifier (CID) computation.
 * DocRef: MVP_PLAN:§Entity Schemas, SPEC:§Freeze Layers (Frozen)
 *
 * CID = SHA256(content_bytes) for raw blocks
 * file_root = SHA256(canonical(FileManifestV1))
 * asset_root = SHA256(canonical(AssetRootV1))
 *
 * All CIDs are 32-byte SHA256 hashes represented as hex strings.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { canonicalEncode } from "./canonical.js";

/** 32-byte hex-encoded SHA256 hash. */
export type CID = string;

/** SHA256 of raw bytes → hex CID. */
export function cidFromBytes(bytes: Uint8Array): CID {
  return bytesToHex(sha256(bytes));
}

/** SHA256 of canonically-encoded object → hex CID. */
export function cidFromObject(obj: unknown): CID {
  const encoded = canonicalEncode(obj);
  return bytesToHex(sha256(encoded));
}

/** Raw SHA256 hash of bytes → Uint8Array (32 bytes). */
export function hashBytes(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

/** Convert hex string to bytes. */
export function fromHex(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/** Convert bytes to hex string. */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/** Verify that a CID matches the SHA256 of given bytes. */
export function verifyCid(cid: CID, bytes: Uint8Array): boolean {
  return cidFromBytes(bytes) === cid;
}
