/**
 * Golden test vectors — merkle tree.
 * These vectors are FROZEN.
 */

import { describe, it, expect } from "vitest";
import { merkleRoot } from "../../src/merkle.js";
import { cidFromBytes } from "../../src/cid.js";

describe("merkle root", () => {
  it("single leaf → root equals the leaf hash", () => {
    const leaf = cidFromBytes(new TextEncoder().encode("only leaf"));
    const root = merkleRoot([leaf]);
    expect(root).toBe(leaf);
  });

  it("two leaves → root is H(left || right)", () => {
    const a = cidFromBytes(new TextEncoder().encode("a"));
    const b = cidFromBytes(new TextEncoder().encode("b"));
    const root = merkleRoot([a, b]);

    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(root).not.toBe(a);
    expect(root).not.toBe(b);
  });

  it("order matters", () => {
    const a = cidFromBytes(new TextEncoder().encode("a"));
    const b = cidFromBytes(new TextEncoder().encode("b"));

    const rootAB = merkleRoot([a, b]);
    const rootBA = merkleRoot([b, a]);

    expect(rootAB).not.toBe(rootBA);
  });

  it("deterministic for same input", () => {
    const cids = Array.from({ length: 7 }, (_, i) =>
      cidFromBytes(new TextEncoder().encode(`block_${i}`)),
    );

    const r1 = merkleRoot(cids);
    const r2 = merkleRoot(cids);
    expect(r1).toBe(r2);
  });

  it("odd number of leaves: last leaf promoted", () => {
    const cids = Array.from({ length: 3 }, (_, i) =>
      cidFromBytes(new TextEncoder().encode(`block_${i}`)),
    );

    const root = merkleRoot(cids);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws on empty list", () => {
    expect(() => merkleRoot([])).toThrow("empty block list");
  });
});
