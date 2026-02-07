/**
 * Ed25519 sign + verify using Web Crypto API.
 * DocRef: MVP_PLAN:§Longevity L4 (signed events)
 *
 * Used for:
 *   - Event signature verification (tips, host registration, pins)
 *   - Test helpers (generate keypairs, sign payloads)
 *
 * Web Crypto Ed25519 is available in Node 20+, Deno, Bun, and all modern browsers.
 */

// ── Key Generation (test/client helper) ────────────────────────────

/**
 * Generate an Ed25519 keypair.
 * Returns raw bytes: { publicKey: 32 bytes, privateKey: 32 bytes (seed) }.
 */
export async function generateKeypair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pair = kp as any;

  const pubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );

  // PKCS8 wraps the 32-byte seed; extract it
  const privPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  // PKCS8 Ed25519: last 32 bytes are the seed
  const privRaw = privPkcs8.slice(-32);

  return { publicKey: pubRaw, privateKey: privRaw };
}

// ── Signing ────────────────────────────────────────────────────────

/**
 * Sign a message with an Ed25519 private key (32-byte seed).
 * Returns a 64-byte signature.
 */
export async function ed25519Sign(
  privateKey: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  // Import the 32-byte seed as PKCS8
  const pkcs8 = buildPkcs8(privateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("Ed25519", key, message);
  return new Uint8Array(sig);
}

// ── Verification ───────────────────────────────────────────────────

/**
 * Verify an Ed25519 signature.
 *
 * @param publicKey - 32-byte Ed25519 public key
 * @param signature - 64-byte Ed25519 signature
 * @param message - The signed message bytes
 * @returns true if signature is valid
 */
export async function ed25519Verify(
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify("Ed25519", key, signature, message);
  } catch {
    return false;
  }
}

// ── PKCS8 wrapper for Ed25519 seed ─────────────────────────────────

/**
 * Wrap a 32-byte Ed25519 seed in PKCS8 DER encoding.
 * Required because Web Crypto importKey("pkcs8") expects this format.
 */
function buildPkcs8(seed: Uint8Array): Uint8Array {
  // PKCS8 DER prefix for Ed25519 (RFC 8410)
  const prefix = new Uint8Array([
    0x30, 0x2e, // SEQUENCE (46 bytes)
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x05, // SEQUENCE (5 bytes)
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
    0x04, 0x22, // OCTET STRING (34 bytes)
    0x04, 0x20, // OCTET STRING (32 bytes) — the seed
  ]);

  const result = new Uint8Array(prefix.length + 32);
  result.set(prefix, 0);
  result.set(seed, prefix.length);
  return result;
}
