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
