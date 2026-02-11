/**
 * Auto-bid + sustainability ratio test vectors.
 * DocRef: MVP_PLAN:§Clearinghouse Model, §Auto-Bids, §Sustainability Ratio
 */

import { describe, it, expect } from "vitest";
import {
  computeAutoBid,
  computeEpochAutoBids,
  sustainabilityRatio,
  isSelfSustaining,
  AUTO_BID_PCT,
  type ReceiptDigest,
} from "../../src/index.js";

const HOST_A = "aa".repeat(32);
const HOST_B = "bb".repeat(32);
const CID_1 = "11".repeat(32);
const CID_2 = "22".repeat(32);

function client(n: number): string {
  return n.toString(16).padStart(64, "0");
}

// ── computeAutoBid ──────────────────────────────────────────────

describe("computeAutoBid", () => {
  it("returns 0 for 0 price", () => {
    expect(computeAutoBid(0)).toBe(0);
  });

  it("returns 0 for negative price", () => {
    expect(computeAutoBid(-100)).toBe(0);
  });

  it("2% of 100 sats = 2 sats", () => {
    expect(computeAutoBid(100)).toBe(2);
  });

  it("2% of 3 sats = 0 (floor)", () => {
    // floor(3 * 0.02) = floor(0.06) = 0
    expect(computeAutoBid(3)).toBe(0);
  });

  it("2% of 50 sats = 1", () => {
    // floor(50 * 0.02) = floor(1.0) = 1
    expect(computeAutoBid(50)).toBe(1);
  });

  it("2% of 500 sats = 10", () => {
    expect(computeAutoBid(500)).toBe(10);
  });

  it("2% of 10000 sats = 200", () => {
    expect(computeAutoBid(10000)).toBe(200);
  });

  it("matches AUTO_BID_PCT at large values (minimal rounding)", () => {
    const price = 1_000_000;
    expect(computeAutoBid(price)).toBe(Math.floor(price * AUTO_BID_PCT));
  });
});

// ── computeEpochAutoBids ────────────────────────────────────────

describe("computeEpochAutoBids", () => {
  it("empty receipts → empty results", () => {
    expect(computeEpochAutoBids([])).toEqual([]);
  });

  it("single CID: sums egress and computes auto-bid", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 100 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2), price_sats: 100 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(3), price_sats: 100 },
    ];
    const results = computeEpochAutoBids(receipts);
    expect(results).toHaveLength(1);
    expect(results[0]!.poolKey).toBe(CID_1);
    expect(results[0]!.totalEgressSats).toBe(300);
    expect(results[0]!.autoBidSats).toBe(6); // floor(300 * 0.02)
    expect(results[0]!.receiptCount).toBe(3);
  });

  it("two CIDs: separate auto-bid per CID", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 500 },
      { host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(2), price_sats: 200 },
    ];
    const results = computeEpochAutoBids(receipts);
    expect(results).toHaveLength(2);

    const cid1 = results.find((r) => r.poolKey === CID_1)!;
    const cid2 = results.find((r) => r.poolKey === CID_2)!;

    expect(cid1.autoBidSats).toBe(10); // floor(500 * 0.02)
    expect(cid2.autoBidSats).toBe(4); // floor(200 * 0.02)
  });

  it("receipts from multiple hosts for same CID are grouped", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 100 },
      { host_pubkey: HOST_B, cid: CID_1, client_pubkey: client(2), price_sats: 100 },
    ];
    const results = computeEpochAutoBids(receipts);
    // Auto-bids group by CID (not by host) — both hosts serve same content
    expect(results).toHaveLength(1);
    expect(results[0]!.totalEgressSats).toBe(200);
    expect(results[0]!.autoBidSats).toBe(4); // floor(200 * 0.02)
    expect(results[0]!.receiptCount).toBe(2);
  });

  it("zero-price receipts are skipped", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 0 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2), price_sats: 0 },
    ];
    const results = computeEpochAutoBids(receipts);
    expect(results).toEqual([]);
  });

  it("CID with total egress too small for auto-bid is excluded", () => {
    // 3 sats each × 2 receipts = 6 total. floor(6 * 0.02) = 0 → excluded
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2), price_sats: 3 },
    ];
    const results = computeEpochAutoBids(receipts);
    expect(results).toEqual([]);
  });

  it("mixed CIDs: one produces auto-bid, another too small", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 500 },
      { host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(2), price_sats: 3 },
    ];
    const results = computeEpochAutoBids(receipts);
    expect(results).toHaveLength(1);
    expect(results[0]!.poolKey).toBe(CID_1);
  });

  it("large volume: many receipts aggregate correctly", () => {
    const receipts: ReceiptDigest[] = [];
    for (let i = 0; i < 1000; i++) {
      receipts.push({
        host_pubkey: i % 2 === 0 ? HOST_A : HOST_B,
        cid: CID_1,
        client_pubkey: client(i % 50),
        price_sats: 100,
      });
    }
    const results = computeEpochAutoBids(receipts);
    expect(results).toHaveLength(1);
    expect(results[0]!.totalEgressSats).toBe(100_000);
    expect(results[0]!.autoBidSats).toBe(2000); // floor(100000 * 0.02)
    expect(results[0]!.receiptCount).toBe(1000);
  });

  it("per-CID aggregation reduces rounding loss vs per-receipt", () => {
    // 10 receipts at 30 sats each:
    // Per-receipt: floor(30 * 0.02) = 0 each → total = 0
    // Per-CID aggregate: floor(300 * 0.02) = 6
    // computeEpochAutoBids uses per-CID aggregation → should be 6
    const receipts: ReceiptDigest[] = [];
    for (let i = 0; i < 10; i++) {
      receipts.push({
        host_pubkey: HOST_A,
        cid: CID_1,
        client_pubkey: client(i),
        price_sats: 30,
      });
    }
    const results = computeEpochAutoBids(receipts);
    expect(results).toHaveLength(1);
    expect(results[0]!.autoBidSats).toBe(6);
    // Verify this is better than per-receipt sum
    const perReceiptSum = receipts.reduce((sum, r) => sum + computeAutoBid(r.price_sats), 0);
    expect(perReceiptSum).toBe(0); // per-receipt floors to 0 each
    expect(results[0]!.autoBidSats).toBeGreaterThan(perReceiptSum);
  });
});

// ── sustainabilityRatio ─────────────────────────────────────────

describe("sustainabilityRatio", () => {
  it("zero income, zero cost → 0", () => {
    expect(sustainabilityRatio(0, 0)).toBe(0);
  });

  it("positive income, zero cost → Infinity", () => {
    expect(sustainabilityRatio(100, 0)).toBe(Infinity);
  });

  it("zero income, positive cost → 0", () => {
    expect(sustainabilityRatio(0, 100)).toBe(0);
  });

  it("income equals cost → ratio = 1.0", () => {
    expect(sustainabilityRatio(100, 100)).toBe(1.0);
  });

  it("income > cost → ratio > 1.0", () => {
    expect(sustainabilityRatio(200, 100)).toBe(2.0);
  });

  it("income < cost → ratio < 1.0", () => {
    expect(sustainabilityRatio(50, 100)).toBe(0.5);
  });

  it("small income, large cost → small ratio", () => {
    expect(sustainabilityRatio(1, 10000)).toBeCloseTo(0.0001, 6);
  });

  it("negative income treated as 0", () => {
    expect(sustainabilityRatio(-100, 100)).toBe(0);
  });
});

// ── isSelfSustaining ────────────────────────────────────────────

describe("isSelfSustaining", () => {
  it("ratio >= 1.0 → true", () => {
    expect(isSelfSustaining(100, 100)).toBe(true);
    expect(isSelfSustaining(200, 100)).toBe(true);
  });

  it("ratio < 1.0 → false", () => {
    expect(isSelfSustaining(50, 100)).toBe(false);
    expect(isSelfSustaining(0, 100)).toBe(false);
  });

  it("positive income, zero cost → true (infinitely sustainable)", () => {
    expect(isSelfSustaining(100, 0)).toBe(true);
  });

  it("zero income, zero cost → false (no data)", () => {
    expect(isSelfSustaining(0, 0)).toBe(false);
  });

  it("just barely self-sustaining (exact 1.0)", () => {
    expect(isSelfSustaining(100, 100)).toBe(true);
  });

  it("just barely not self-sustaining (0.99)", () => {
    expect(isSelfSustaining(99, 100)).toBe(false);
  });
});
