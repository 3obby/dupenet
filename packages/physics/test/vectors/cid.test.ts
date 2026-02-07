/**
 * Golden test vectors — CID computation.
 * These vectors are FROZEN.
 */

import { describe, it, expect } from "vitest";
import { cidFromBytes, cidFromObject, verifyCid } from "../../src/cid.js";

describe("CID computation", () => {
  it("SHA256 of empty bytes matches known hash", () => {
    const empty = new Uint8Array(0);
    // SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(cidFromBytes(empty)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("SHA256 of 'hello' matches known hash", () => {
    const hello = new TextEncoder().encode("hello");
    // SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(cidFromBytes(hello)).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("verifyCid returns true for matching content", () => {
    const data = new TextEncoder().encode("test content");
    const cid = cidFromBytes(data);
    expect(verifyCid(cid, data)).toBe(true);
  });

  it("verifyCid returns false for tampered content", () => {
    const data = new TextEncoder().encode("test content");
    const cid = cidFromBytes(data);
    const tampered = new TextEncoder().encode("test conten!");
    expect(verifyCid(cid, tampered)).toBe(false);
  });

  it("cidFromObject produces deterministic hash for same object", () => {
    const obj = { version: 1, name: "test", value: 42 };
    const cid1 = cidFromObject(obj);
    const cid2 = cidFromObject(obj);
    expect(cid1).toBe(cid2);
    expect(cid1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cidFromObject differs for different key order (canonicalized)", () => {
    // Both should produce the SAME CID because canonical encoding sorts keys
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(cidFromObject(obj1)).toBe(cidFromObject(obj2));
  });
});
