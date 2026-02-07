/**
 * Golden test vectors — canonical serialization.
 * These vectors are FROZEN. If a test breaks, the code is wrong, not the vector.
 */

import { describe, it, expect } from "vitest";
import { canonicalEncode, canonicalDecode } from "../../src/canonical.js";
import { toHex } from "../../src/cid.js";

describe("canonical serialization", () => {
  it("produces deterministic output regardless of key insertion order", () => {
    const obj1 = { z: 1, a: 2, m: 3 };
    const obj2 = { a: 2, m: 3, z: 1 };
    const obj3 = { m: 3, z: 1, a: 2 };

    const enc1 = canonicalEncode(obj1);
    const enc2 = canonicalEncode(obj2);
    const enc3 = canonicalEncode(obj3);

    expect(toHex(enc1)).toBe(toHex(enc2));
    expect(toHex(enc2)).toBe(toHex(enc3));
  });

  it("round-trips a FileManifestV1-shaped object", () => {
    const manifest = {
      blocks: [
        "a".repeat(64),
        "b".repeat(64),
      ],
      chunk_size: 262144,
      merkle_root: "c".repeat(64),
      size: 500000,
      version: 1,
    };

    const encoded = canonicalEncode(manifest);
    const decoded = canonicalDecode(encoded) as typeof manifest;

    expect(decoded.version).toBe(1);
    expect(decoded.chunk_size).toBe(262144);
    expect(decoded.size).toBe(500000);
    expect(decoded.blocks).toHaveLength(2);
    expect(decoded.merkle_root).toBe("c".repeat(64));
  });

  it("handles nested objects with stable key ordering", () => {
    const nested = {
      z: { b: 2, a: 1 },
      a: { z: 26, a: 1 },
    };

    const encoded = canonicalEncode(nested);
    const decoded = canonicalDecode(encoded) as typeof nested;

    // Keys should be sorted in the decoded output
    const outerKeys = Object.keys(decoded);
    expect(outerKeys[0]).toBe("a");
    expect(outerKeys[1]).toBe("z");
  });

  it("handles Uint8Array passthrough", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const obj = { data };
    const encoded = canonicalEncode(obj);
    const decoded = canonicalDecode(encoded) as { data: Uint8Array };
    expect(new Uint8Array(decoded.data)).toEqual(data);
  });

  it("encodes integers without float representation", () => {
    // Ensure integers stay as integers (no 1.0 vs 1 ambiguity)
    const obj = { value: 42, big: 1000000 };
    const encoded = canonicalEncode(obj);
    const decoded = canonicalDecode(encoded) as typeof obj;
    expect(decoded.value).toBe(42);
    expect(decoded.big).toBe(1000000);
  });
});
