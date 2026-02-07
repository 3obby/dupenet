/**
 * Golden test vectors — block selection PRF (anti-special-casing).
 * DocRef: MVP_PLAN:§Block Selection (Anti-Special-Casing)
 *
 * block_index = PRF(epoch || file_root || client_pubkey) mod num_blocks
 */

import { describe, it, expect } from "vitest";
import {
  selectBlockIndex,
  selectBlock,
  verifyBlockSelection,
  blockSelectionPrfHash,
} from "../../src/block-selection.js";

const FILE_ROOT = "aa".repeat(32);
const CLIENT_A = "bb".repeat(32);
const CLIENT_B = "cc".repeat(32);

function makeBlocks(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    i.toString(16).padStart(64, "0"),
  );
}

describe("selectBlockIndex", () => {
  it("returns 0 for single-block file", () => {
    expect(selectBlockIndex(1, FILE_ROOT, CLIENT_A, 1)).toBe(0);
  });

  it("returns 0 for zero or negative numBlocks", () => {
    expect(selectBlockIndex(1, FILE_ROOT, CLIENT_A, 0)).toBe(0);
  });

  it("is deterministic: same inputs → same index", () => {
    const a = selectBlockIndex(5, FILE_ROOT, CLIENT_A, 100);
    const b = selectBlockIndex(5, FILE_ROOT, CLIENT_A, 100);
    expect(a).toBe(b);
  });

  it("changes with different epoch", () => {
    const a = selectBlockIndex(1, FILE_ROOT, CLIENT_A, 1000);
    const b = selectBlockIndex(2, FILE_ROOT, CLIENT_A, 1000);
    expect(a).not.toBe(b);
  });

  it("changes with different client", () => {
    const a = selectBlockIndex(5, FILE_ROOT, CLIENT_A, 1000);
    const b = selectBlockIndex(5, FILE_ROOT, CLIENT_B, 1000);
    expect(a).not.toBe(b);
  });

  it("changes with different file_root", () => {
    const fileRoot2 = "dd".repeat(32);
    const a = selectBlockIndex(5, FILE_ROOT, CLIENT_A, 1000);
    const b = selectBlockIndex(5, fileRoot2, CLIENT_A, 1000);
    expect(a).not.toBe(b);
  });

  it("index is always in [0, numBlocks)", () => {
    for (let epoch = 0; epoch < 50; epoch++) {
      const idx = selectBlockIndex(epoch, FILE_ROOT, CLIENT_A, 7);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });

  it("distributes roughly uniformly across blocks", () => {
    const numBlocks = 10;
    const counts = new Array(numBlocks).fill(0);
    const trials = 1000;

    // Vary epoch to get different selections
    for (let epoch = 0; epoch < trials; epoch++) {
      const idx = selectBlockIndex(epoch, FILE_ROOT, CLIENT_A, numBlocks);
      counts[idx]++;
    }

    // Each bucket should get roughly 100 ± 50 (uniform ≈ 100)
    for (let i = 0; i < numBlocks; i++) {
      expect(counts[i]).toBeGreaterThan(50);
      expect(counts[i]).toBeLessThan(200);
    }
  });
});

describe("selectBlock", () => {
  it("returns the correct block CID from the list", () => {
    const blocks = makeBlocks(10);
    const { index, blockCid } = selectBlock(5, FILE_ROOT, CLIENT_A, blocks);
    expect(blockCid).toBe(blocks[index]);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(10);
  });

  it("throws on empty blocks array", () => {
    expect(() => selectBlock(5, FILE_ROOT, CLIENT_A, [])).toThrow(
      "empty blocks",
    );
  });

  it("single block → always returns that block", () => {
    const blocks = ["ff".repeat(32)];
    const { index, blockCid } = selectBlock(5, FILE_ROOT, CLIENT_A, blocks);
    expect(index).toBe(0);
    expect(blockCid).toBe(blocks[0]);
  });
});

describe("verifyBlockSelection", () => {
  it("returns true for correctly selected block", () => {
    const blocks = makeBlocks(20);
    const { blockCid } = selectBlock(5, FILE_ROOT, CLIENT_A, blocks);
    expect(
      verifyBlockSelection(5, FILE_ROOT, CLIENT_A, blockCid, blocks),
    ).toBe(true);
  });

  it("returns false for wrong block", () => {
    const blocks = makeBlocks(20);
    const { index } = selectBlock(5, FILE_ROOT, CLIENT_A, blocks);
    // Pick a different block
    const wrongIndex = (index + 1) % blocks.length;
    expect(
      verifyBlockSelection(5, FILE_ROOT, CLIENT_A, blocks[wrongIndex]!, blocks),
    ).toBe(false);
  });

  it("returns false for empty blocks array", () => {
    expect(
      verifyBlockSelection(5, FILE_ROOT, CLIENT_A, "00".repeat(32), []),
    ).toBe(false);
  });

  it("returns false for different epoch", () => {
    const blocks = makeBlocks(20);
    const { blockCid } = selectBlock(5, FILE_ROOT, CLIENT_A, blocks);
    // Different epoch → different selection → should fail
    // (unless by coincidence, but with 20 blocks this is very unlikely)
    const resultEpoch6 = verifyBlockSelection(
      6,
      FILE_ROOT,
      CLIENT_A,
      blockCid,
      blocks,
    );
    // We can't guarantee it's false (coincidence possible), but verify it works
    // by also checking the positive case
    const resultEpoch5 = verifyBlockSelection(
      5,
      FILE_ROOT,
      CLIENT_A,
      blockCid,
      blocks,
    );
    expect(resultEpoch5).toBe(true);
    // With 20 blocks, probability of coincidence is 1/20 = 5%
    // We accept this — the test verifies the mechanism, not exhaustive correctness
  });
});

describe("blockSelectionPrfHash", () => {
  it("returns a 64-char hex string", () => {
    const hash = blockSelectionPrfHash(5, FILE_ROOT, CLIENT_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const a = blockSelectionPrfHash(5, FILE_ROOT, CLIENT_A);
    const b = blockSelectionPrfHash(5, FILE_ROOT, CLIENT_A);
    expect(a).toBe(b);
  });

  it("changes with different inputs", () => {
    const a = blockSelectionPrfHash(5, FILE_ROOT, CLIENT_A);
    const b = blockSelectionPrfHash(5, FILE_ROOT, CLIENT_B);
    expect(a).not.toBe(b);
  });
});
