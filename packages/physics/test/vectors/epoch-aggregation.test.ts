/**
 * Golden test vectors — epoch aggregation + payout eligibility + payout weight.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards (smooth payout_weight replaces 5/3 gate)
 */

import { describe, it, expect } from "vitest";
import {
  aggregateReceipts,
  isPayoutEligible,
  computePayoutWeight,
  type ReceiptDigest,
} from "../../src/epoch-aggregation.js";

const HOST_A = "aa".repeat(32);
const HOST_B = "bb".repeat(32);
const CID_1 = "11".repeat(32);
const CID_2 = "22".repeat(32);

function client(n: number): string {
  return n.toString(16).padStart(64, "0");
}

describe("aggregateReceipts", () => {
  it("empty receipts → empty groups", () => {
    expect(aggregateReceipts([])).toEqual([]);
  });

  it("single receipt → single group with count=1 and totalProvenSats", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      host: HOST_A,
      cid: CID_1,
      receiptCount: 1,
      uniqueClients: 1,
      totalProvenSats: 3,
    });
  });

  it("same (host, cid) receipts from different clients are grouped", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2), price_sats: 5 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(3), price_sats: 3 },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.receiptCount).toBe(3);
    expect(groups[0]!.uniqueClients).toBe(3);
    expect(groups[0]!.totalProvenSats).toBe(11);
  });

  it("duplicate client counted once for uniqueClients, but all sats sum", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2), price_sats: 5 },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups[0]!.receiptCount).toBe(3);
    expect(groups[0]!.uniqueClients).toBe(2);
    expect(groups[0]!.totalProvenSats).toBe(11);
  });

  it("different hosts with same CID → separate groups", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_B, cid: CID_1, client_pubkey: client(2), price_sats: 3 },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(2);
  });

  it("same host, different CIDs → separate groups", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1), price_sats: 3 },
      { host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(2), price_sats: 5 },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(2);
  });

  it("mixed scenario: two hosts, two CIDs", () => {
    const receipts: ReceiptDigest[] = [];
    // Host A serves CID_1: 6 receipts from 4 clients
    for (let i = 0; i < 6; i++) {
      receipts.push({
        host_pubkey: HOST_A,
        cid: CID_1,
        client_pubkey: client(i % 4),
        price_sats: 3,
      });
    }
    // Host B serves CID_1: 3 receipts from 2 clients
    for (let i = 0; i < 3; i++) {
      receipts.push({
        host_pubkey: HOST_B,
        cid: CID_1,
        client_pubkey: client(i % 2),
        price_sats: 5,
      });
    }
    // Host A serves CID_2: 2 receipts from 1 client
    receipts.push({ host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(10), price_sats: 3 });
    receipts.push({ host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(10), price_sats: 3 });

    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(3);

    const hostACid1 = groups.find((g) => g.host === HOST_A && g.cid === CID_1)!;
    expect(hostACid1.receiptCount).toBe(6);
    expect(hostACid1.uniqueClients).toBe(4);
    expect(hostACid1.totalProvenSats).toBe(18); // 6 × 3

    const hostBCid1 = groups.find((g) => g.host === HOST_B && g.cid === CID_1)!;
    expect(hostBCid1.receiptCount).toBe(3);
    expect(hostBCid1.uniqueClients).toBe(2);
    expect(hostBCid1.totalProvenSats).toBe(15); // 3 × 5

    const hostACid2 = groups.find((g) => g.host === HOST_A && g.cid === CID_2)!;
    expect(hostACid2.receiptCount).toBe(2);
    expect(hostACid2.uniqueClients).toBe(1);
    expect(hostACid2.totalProvenSats).toBe(6); // 2 × 3
  });
});

describe("isPayoutEligible (smooth model)", () => {
  it("zero receipts → ineligible", () => {
    expect(isPayoutEligible({ receiptCount: 0, totalProvenSats: 0 })).toBe(false);
  });

  it("1 receipt with 0 provenSats → ineligible", () => {
    expect(isPayoutEligible({ receiptCount: 1, totalProvenSats: 0 })).toBe(false);
  });

  it("1 receipt with proven sats → eligible", () => {
    expect(isPayoutEligible({ receiptCount: 1, totalProvenSats: 3 })).toBe(true);
  });

  it("many receipts with proven sats → eligible", () => {
    expect(isPayoutEligible({ receiptCount: 100, totalProvenSats: 500 })).toBe(true);
  });

  it("old 5/3 scenario that was ineligible is now eligible (2 receipts, 1 client, proven sats)", () => {
    // Under old rules: 2 receipts < 5, 1 client < 3 → ineligible
    // Under new rules: receiptCount >= 1 && totalProvenSats > 0 → eligible
    expect(isPayoutEligible({ receiptCount: 2, totalProvenSats: 6 })).toBe(true);
  });
});

describe("computePayoutWeight", () => {
  it("zero provenSats → 0 weight", () => {
    expect(computePayoutWeight(0, 5)).toBe(0);
  });

  it("zero clients → 0 weight", () => {
    expect(computePayoutWeight(100, 0)).toBe(0);
  });

  it("1 client → weight = totalProvenSats × 1", () => {
    // log2(1) = 0, so weight = 100 × (1 + 0) = 100
    expect(computePayoutWeight(100, 1)).toBe(100);
  });

  it("2 clients → weight = totalProvenSats × 2", () => {
    // log2(2) = 1, so weight = 100 × (1 + 1) = 200
    expect(computePayoutWeight(100, 2)).toBe(200);
  });

  it("4 clients → weight = totalProvenSats × 3", () => {
    // log2(4) = 2, so weight = 100 × (1 + 2) = 300
    expect(computePayoutWeight(100, 4)).toBe(300);
  });

  it("5 clients → weight ≈ totalProvenSats × 3.32", () => {
    const w = computePayoutWeight(100, 5);
    expect(w).toBeCloseTo(100 * (1 + Math.log2(5)), 6);
  });

  it("10 clients → weight ≈ totalProvenSats × 4.32", () => {
    const w = computePayoutWeight(100, 10);
    expect(w).toBeCloseTo(100 * (1 + Math.log2(10)), 6);
  });

  it("is monotonically increasing in clients (fixed sats)", () => {
    const clients = [1, 2, 3, 5, 10, 20, 100];
    for (let i = 1; i < clients.length; i++) {
      expect(computePayoutWeight(100, clients[i]!)).toBeGreaterThan(
        computePayoutWeight(100, clients[i - 1]!),
      );
    }
  });

  it("is monotonically increasing in sats (fixed clients)", () => {
    const sats = [1, 10, 100, 1000, 10000];
    for (let i = 1; i < sats.length; i++) {
      expect(computePayoutWeight(sats[i]!, 3)).toBeGreaterThan(
        computePayoutWeight(sats[i - 1]!, 3),
      );
    }
  });

  it("smooth: no cliff at 5/3 boundary", () => {
    // Old model had a cliff at 5 receipts / 3 clients — everything below was 0.
    // New model should give non-zero weight for 1 receipt / 1 client.
    expect(computePayoutWeight(3, 1)).toBe(3); // small but non-zero
    expect(computePayoutWeight(15, 3)).toBeCloseTo(15 * (1 + Math.log2(3)), 6);
  });
});
