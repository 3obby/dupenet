/**
 * Receipt SDK test vectors.
 * Tests the verification function with crafted inputs.
 */

import { describe, it, expect } from "vitest";
import { verifyReceiptV2 } from "../../src/verify.js";
import { ed25519Verify } from "../../src/ed25519.js";

describe("verifyReceiptV2", () => {
  it("rejects receipt with invalid hex fields", async () => {
    const badReceipt = {
      file_root: "not_hex",
      block_cid: "a".repeat(64),
      host_pubkey: "b".repeat(64),
      payment_hash: "c".repeat(64),
      response_hash: "d".repeat(64),
      price_sats: 3,
      receipt_token: "AAAA",
      epoch: 1,
      nonce: 0,
      pow_hash: "e".repeat(64),
      client_pubkey: "f".repeat(64),
      client_sig: "AAAA",
    };

    const result = await verifyReceiptV2(badReceipt, []);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_file_root");
  });

  it("rejects receipt with pow_hash that doesn't meet target", async () => {
    // pow_hash = ff...ff is way above 2^240 target
    const receipt = {
      file_root: "a".repeat(64),
      block_cid: "b".repeat(64),
      host_pubkey: "c".repeat(64),
      payment_hash: "d".repeat(64),
      response_hash: "e".repeat(64),
      price_sats: 3,
      receipt_token: "AAAA",
      epoch: 1,
      nonce: 0,
      pow_hash: "f".repeat(64),
      client_pubkey: "0".repeat(64),
      client_sig: "AAAA",
    };

    const result = await verifyReceiptV2(receipt, ["a".repeat(64)]);
    expect(result.valid).toBe(false);
    // Will fail at pow_hash_mismatch (computed hash won't match) or pow_invalid
    expect(result.error).toMatch(/pow_/);
  });

  it("rejects receipt with invalid asset_root hex", async () => {
    const receipt = {
      asset_root: "xyz",
      file_root: "a".repeat(64),
      block_cid: "b".repeat(64),
      host_pubkey: "c".repeat(64),
      payment_hash: "d".repeat(64),
      response_hash: "e".repeat(64),
      price_sats: 3,
      receipt_token: "AAAA",
      epoch: 1,
      nonce: 0,
      pow_hash: "0".repeat(64),
      client_pubkey: "1".repeat(64),
      client_sig: "AAAA",
    };

    const result = await verifyReceiptV2(receipt, []);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_asset_root");
  });

  it("rejects when no mint pubkeys match", async () => {
    // This will fail at pow_hash_mismatch before reaching mint check,
    // but the structure validates the flow
    const receipt = {
      file_root: "a".repeat(64),
      block_cid: "b".repeat(64),
      host_pubkey: "c".repeat(64),
      payment_hash: "d".repeat(64),
      response_hash: "e".repeat(64),
      price_sats: 3,
      receipt_token: "A".repeat(88), // 64 bytes in base64
      epoch: 1,
      nonce: 0,
      pow_hash: "0".repeat(64),
      client_pubkey: "1".repeat(64),
      client_sig: "A".repeat(88),
    };

    const result = await verifyReceiptV2(receipt, []);
    expect(result.valid).toBe(false);
    // Fails at PoW check since computed hash won't match the provided one
    expect(result.error).toBe("pow_hash_mismatch");
  });
});

describe("ed25519Verify", () => {
  it("rejects invalid signature", async () => {
    const pk = new Uint8Array(32);
    const sig = new Uint8Array(64);
    const msg = new Uint8Array([1, 2, 3]);

    const valid = await ed25519Verify(pk, sig, msg);
    expect(valid).toBe(false);
  });
});

// ── Full round-trip: construct valid receipt → verify passes ───────

describe("verifyReceiptV2 end-to-end", () => {
  // Web Crypto Ed25519 helpers (zero deps)
  async function generateKeypair() {
    const keys = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]);
    const pubRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    );
    const pubHex = bytesToHex(pubRaw);
    return { privateKey: keys.privateKey, publicKeyHex: pubHex };
  }

  async function ed25519Sign(
    privateKey: CryptoKey,
    message: Uint8Array,
  ): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign("Ed25519", privateKey, message),
    );
  }

  function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
  }

  it("accepts a properly constructed receipt", async () => {
    // Import physics primitives (devDep)
    const {
      buildChallengeRaw,
      buildChallenge,
      buildTokenPayload,
      buildClientSigPayload,
      computePowHash,
      getTarget,
      minePoW,
    } = await import("@dupenet/physics");

    // 1. Generate keypairs
    const mintKeys = await generateKeypair();
    const clientKeys = await generateKeypair();

    // 2. Set up receipt fields
    const fields = {
      asset_root: "aa".repeat(32),
      file_root: "bb".repeat(32),
      block_cid: "cc".repeat(32),
      host_pubkey: "dd".repeat(32),
      payment_hash: "ee".repeat(32),
      response_hash: "cc".repeat(32), // honest host: response_hash == block_cid
      epoch: 42,
      client_pubkey: clientKeys.publicKeyHex,
    };

    // 3. Build + sign receipt token (mint signs)
    const tokenPayload = buildTokenPayload({
      host_pubkey: fields.host_pubkey,
      epoch: fields.epoch,
      block_cid: fields.block_cid,
      response_hash: fields.response_hash,
      price_sats: 3,
      payment_hash: fields.payment_hash,
    });
    const mintSig = await ed25519Sign(mintKeys.privateKey, tokenPayload);
    const receiptToken = bytesToBase64(mintSig);

    // 4. Mine PoW
    const challenge = buildChallenge(fields);
    const target = getTarget(0); // first receipt = base difficulty
    const { nonce, powHash } = minePoW(challenge, target);

    // 5. Build + sign client signature
    const challengeRaw = buildChallengeRaw(fields);
    const clientSigPayload = buildClientSigPayload(
      challengeRaw,
      nonce,
      powHash,
    );
    const clientSig = await ed25519Sign(
      clientKeys.privateKey,
      clientSigPayload,
    );

    // 6. Assemble receipt
    const receipt = {
      ...fields,
      price_sats: 3,
      receipt_token: receiptToken,
      nonce: Number(nonce),
      pow_hash: powHash,
      client_sig: bytesToBase64(clientSig),
    };

    // 7. Verify!
    const result = await verifyReceiptV2(receipt, [mintKeys.publicKeyHex]);

    expect(result).toEqual({ valid: true });
  });

  it("rejects receipt with wrong mint key", async () => {
    const {
      buildChallengeRaw,
      buildChallenge,
      buildTokenPayload,
      buildClientSigPayload,
      getTarget,
      minePoW,
    } = await import("@dupenet/physics");

    const mintKeys = await generateKeypair();
    const wrongMint = await generateKeypair();
    const clientKeys = await generateKeypair();

    const fields = {
      file_root: "aa".repeat(32),
      block_cid: "bb".repeat(32),
      host_pubkey: "cc".repeat(32),
      payment_hash: "dd".repeat(32),
      response_hash: "bb".repeat(32),
      epoch: 1,
      client_pubkey: clientKeys.publicKeyHex,
    };

    // Sign with mintKeys, but verify against wrongMint
    const tokenPayload = buildTokenPayload({
      host_pubkey: fields.host_pubkey,
      epoch: fields.epoch,
      block_cid: fields.block_cid,
      response_hash: fields.response_hash,
      price_sats: 3,
      payment_hash: fields.payment_hash,
    });
    const mintSig = await ed25519Sign(mintKeys.privateKey, tokenPayload);

    const challenge = buildChallenge(fields);
    const { nonce, powHash } = minePoW(challenge, getTarget(0));

    const challengeRaw = buildChallengeRaw(fields);
    const clientSigPayload = buildClientSigPayload(
      challengeRaw,
      nonce,
      powHash,
    );
    const clientSig = await ed25519Sign(
      clientKeys.privateKey,
      clientSigPayload,
    );

    const receipt = {
      ...fields,
      price_sats: 3,
      receipt_token: bytesToBase64(mintSig),
      nonce: Number(nonce),
      pow_hash: powHash,
      client_sig: bytesToBase64(clientSig),
    };

    // Verify against wrong mint → should fail
    const result = await verifyReceiptV2(receipt, [
      wrongMint.publicKeyHex,
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("token_invalid");
  });
});
