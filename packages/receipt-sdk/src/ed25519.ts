/**
 * Pure Ed25519 verification using Web Crypto API.
 * ZERO external dependencies. Works in browser, Node 20+, Deno, Bun.
 *
 * This module ONLY verifies signatures — it does not sign.
 * The mint signs; the SDK verifies. Separation is deliberate.
 */

/**
 * Verify an Ed25519 signature.
 * Uses SubtleCrypto (available in all modern runtimes since 2023).
 *
 * @param publicKey - 32-byte Ed25519 public key
 * @param signature - 64-byte Ed25519 signature
 * @param message - The signed message bytes
 * @returns true if signature is valid
 */
// Web Crypto accepts Uint8Array at runtime, but @types/node >= 22 is overly
// strict about ArrayBufferLike vs ArrayBuffer. Bridge without copying when possible.
function wcBuf(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }
  return data.slice().buffer as ArrayBuffer;
}

export async function ed25519Verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      wcBuf(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify("Ed25519", key, wcBuf(signature), wcBuf(message));
  } catch {
    return false;
  }
}
