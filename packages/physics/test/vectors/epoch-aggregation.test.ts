/**
 * Golden test vectors — epoch aggregation + payout eligibility.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards (5/3 threshold)
 */

import { describe, it, expect } from "vitest";
import {
  aggregateReceipts,
  isPayoutEligible,
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

  it("single receipt → single group with count=1", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      host: HOST_A,
      cid: CID_1,
      receiptCount: 1,
      uniqueClients: 1,
    });
  });

  it("same (host, cid) receipts from different clients are grouped", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2) },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(3) },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.receiptCount).toBe(3);
    expect(groups[0]!.uniqueClients).toBe(3);
  });

  it("duplicate client counted once for uniqueClients", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(2) },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups[0]!.receiptCount).toBe(3);
    expect(groups[0]!.uniqueClients).toBe(2);
  });

  it("different hosts with same CID → separate groups", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
      { host_pubkey: HOST_B, cid: CID_1, client_pubkey: client(2) },
    ];
    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(2);
  });

  it("same host, different CIDs → separate groups", () => {
    const receipts: ReceiptDigest[] = [
      { host_pubkey: HOST_A, cid: CID_1, client_pubkey: client(1) },
      { host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(2) },
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
      });
    }
    // Host B serves CID_1: 3 receipts from 2 clients
    for (let i = 0; i < 3; i++) {
      receipts.push({
        host_pubkey: HOST_B,
        cid: CID_1,
        client_pubkey: client(i % 2),
      });
    }
    // Host A serves CID_2: 2 receipts from 1 client
    receipts.push({ host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(10) });
    receipts.push({ host_pubkey: HOST_A, cid: CID_2, client_pubkey: client(10) });

    const groups = aggregateReceipts(receipts);
    expect(groups).toHaveLength(3);

    const hostACid1 = groups.find((g) => g.host === HOST_A && g.cid === CID_1)!;
    expect(hostACid1.receiptCount).toBe(6);
    expect(hostACid1.uniqueClients).toBe(4);

    const hostBCid1 = groups.find((g) => g.host === HOST_B && g.cid === CID_1)!;
    expect(hostBCid1.receiptCount).toBe(3);
    expect(hostBCid1.uniqueClients).toBe(2);

    const hostACid2 = groups.find((g) => g.host === HOST_A && g.cid === CID_2)!;
    expect(hostACid2.receiptCount).toBe(2);
    expect(hostACid2.uniqueClients).toBe(1);
  });
});

describe("isPayoutEligible", () => {
  it("below both thresholds → ineligible", () => {
    expect(isPayoutEligible({ receiptCount: 2, uniqueClients: 1 })).toBe(false);
  });

  it("enough receipts but too few clients → ineligible", () => {
    expect(isPayoutEligible({ receiptCount: 10, uniqueClients: 2 })).toBe(false);
  });

  it("enough clients but too few receipts → ineligible", () => {
    expect(isPayoutEligible({ receiptCount: 3, uniqueClients: 5 })).toBe(false);
  });

  it("exactly at threshold → eligible", () => {
    expect(isPayoutEligible({ receiptCount: 5, uniqueClients: 3 })).toBe(true);
  });

  it("above threshold → eligible", () => {
    expect(isPayoutEligible({ receiptCount: 100, uniqueClients: 20 })).toBe(true);
  });
});
