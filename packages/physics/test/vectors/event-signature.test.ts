/**
 * Golden test vectors — event signature sign + verify.
 * DocRef: MVP_PLAN:§Longevity L4 (signed events)
 */

import { describe, it, expect } from "vitest";
import {
  generateKeypair,
  signEventPayload,
  verifyEventSignature,
} from "../../src/index.js";
import { toHex } from "../../src/cid.js";

describe("signEventPayload + verifyEventSignature", () => {
  it("round-trip: sign then verify succeeds", async () => {
    const kp = await generateKeypair();
    const pubHex = toHex(kp.publicKey);
    const payload = { cid: "aa".repeat(32), amount: 100, payment_proof: "bb".repeat(32) };

    const sig = await signEventPayload(kp.privateKey, payload);
    expect(sig.length).toBeGreaterThan(0);

    const valid = await verifyEventSignature(pubHex, sig, payload);
    expect(valid).toBe(true);
  });

  it("wrong pubkey → verification fails", async () => {
    const kp1 = await generateKeypair();
    const kp2 = await generateKeypair();
    const payload = { action: "test" };

    const sig = await signEventPayload(kp1.privateKey, payload);
    const valid = await verifyEventSignature(toHex(kp2.publicKey), sig, payload);
    expect(valid).toBe(false);
  });

  it("tampered payload → verification fails", async () => {
    const kp = await generateKeypair();
    const payload = { amount: 100 };

    const sig = await signEventPayload(kp.privateKey, payload);
    const valid = await verifyEventSignature(toHex(kp.publicKey), sig, { amount: 200 });
    expect(valid).toBe(false);
  });

  it("empty sig → verification fails", async () => {
    const kp = await generateKeypair();
    const valid = await verifyEventSignature(toHex(kp.publicKey), "", { test: 1 });
    expect(valid).toBe(false);
  });

  it("invalid pubkey hex → verification fails", async () => {
    const valid = await verifyEventSignature("not-hex", "AAAA", { test: 1 });
    expect(valid).toBe(false);
  });

  it("garbage sig → verification fails", async () => {
    const kp = await generateKeypair();
    // Base64 of 64 random bytes
    const garbageSig = Buffer.from(new Uint8Array(64).fill(42)).toString("base64");
    const valid = await verifyEventSignature(toHex(kp.publicKey), garbageSig, { test: 1 });
    expect(valid).toBe(false);
  });

  it("canonical encoding ensures field order doesn't matter", async () => {
    const kp = await generateKeypair();
    const pubHex = toHex(kp.publicKey);

    // Sign with keys in one order
    const sig = await signEventPayload(kp.privateKey, { b: 2, a: 1 });

    // Verify with keys in different order — canonicalEncode sorts them
    const valid = await verifyEventSignature(pubHex, sig, { a: 1, b: 2 });
    expect(valid).toBe(true);
  });

  it("different payloads produce different signatures", async () => {
    const kp = await generateKeypair();
    const sig1 = await signEventPayload(kp.privateKey, { x: 1 });
    const sig2 = await signEventPayload(kp.privateKey, { x: 2 });
    expect(sig1).not.toBe(sig2);
  });
});
