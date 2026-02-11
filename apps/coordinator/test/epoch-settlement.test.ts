/**
 * Epoch settlement integration test.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards, §Receipt-Based Payouts, §Egress Royalty, §Auto-Bids
 *
 * Uses a mock PrismaClient to test the full settlement flow:
 * receipts → aggregation → eligibility → reward computation → bounty drain → auto-bids.
 *
 * Economics rework (2026-02-10):
 *   - Smooth payout_weight replaces hard 5/3 gate.
 *   - Egress royalty (1% of proven L402 fees) deducted at settlement.
 *   - Hosts with 1 receipt + proven sats are now eligible (small payout_weight).
 *   - Auto-bids: 2% of proven egress credited to pool (with founder royalty).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cidEpochCap,
  computePayoutWeight,
  AGGREGATOR_FEE_PCT,
  EGRESS_ROYALTY_PCT,
  AUTO_BID_PCT,
  FOUNDER_ROYALTY_R0,
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
} from "@dupenet/physics";
import { settleEpoch } from "../src/views/epoch-settlement.js";

// ── Helpers ────────────────────────────────────────────────────────

const HOST_A = "aa".repeat(32);
const HOST_B = "bb".repeat(32);
const CID_1 = "11".repeat(32);
const CID_2 = "22".repeat(32);
const EPOCH = 5;
const PRICE_SATS = 3;

function client(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function makeReceipt(
  host: string,
  cid: string,
  clientPubkey: string,
  idx: number,
  priceSats = PRICE_SATS,
) {
  return {
    id: idx,
    epoch: EPOCH,
    hostPubkey: host,
    blockCid: "cc".repeat(32),
    fileRoot: cid,
    assetRoot: null as string | null,
    clientPubkey,
    paymentHash: idx.toString(16).padStart(64, "0"),
    responseHash: "dd".repeat(32),
    priceSats,
    powHash: "ee".repeat(32),
    nonce: BigInt(0),
    receiptToken: "ff".repeat(32),
    clientSig: "00".repeat(64),
    createdAt: new Date(),
  };
}

// ── Mock PrismaClient ──────────────────────────────────────────────

interface MockStore {
  receipts: ReturnType<typeof makeReceipt>[];
  bountyPools: Map<string, { cid: string; balance: bigint; lastPayoutEpoch: number; totalTipped: bigint }>;
  hosts: Map<string, { pubkey: string; availabilityScore: number }>;
  epochSummaries: Array<{
    id: number;
    epoch: number;
    hostPubkey: string;
    cid: string;
    receiptCount: number;
    uniqueClients: number;
    rewardSats: bigint;
    autoBidSats: number;
    egressRoyaltySats: number;
  }>;
  events: Array<{ seq: number; type: string; timestamp: bigint; signer: string; sig: string; payload: unknown; createdAt: Date }>;
}

function createMockPrisma(store: MockStore) {
  let summaryId = 1;
  let eventSeq = 1;

  return {
    receipt: {
      findMany: vi.fn(async ({ where }: { where: { epoch: number } }) => {
        return store.receipts.filter((r) => r.epoch === where.epoch);
      }),
    },
    bountyPool: {
      findUnique: vi.fn(async ({ where }: { where: { poolKey: string } }) => {
        return store.bountyPools.get(where.poolKey) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { poolKey: string }; data: Record<string, unknown> }) => {
        const pool = store.bountyPools.get(where.poolKey);
        if (!pool) throw new Error(`Pool not found: ${where.poolKey}`);
        if (data.balance && typeof data.balance === "object" && "decrement" in data.balance) {
          pool.balance -= data.balance.decrement as bigint;
        }
        if (data.balance && typeof data.balance === "object" && "increment" in data.balance) {
          pool.balance += data.balance.increment as bigint;
        }
        if (data.lastPayoutEpoch !== undefined) {
          pool.lastPayoutEpoch = data.lastPayoutEpoch as number;
        }
        if (data.totalTipped && typeof data.totalTipped === "object" && "increment" in data.totalTipped) {
          pool.totalTipped += data.totalTipped.increment as bigint;
        }
        return pool;
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { poolKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        let pool = store.bountyPools.get(where.poolKey);
        if (!pool) {
          // Create new pool
          pool = {
            cid: where.poolKey,
            balance: create.balance as bigint,
            lastPayoutEpoch: 0,
            totalTipped: (create.totalTipped as bigint) ?? 0n,
          };
          store.bountyPools.set(where.poolKey, pool);
        } else {
          // Update existing
          if (update.balance && typeof update.balance === "object" && "increment" in update.balance) {
            pool.balance += update.balance.increment as bigint;
          }
          if (update.totalTipped && typeof update.totalTipped === "object" && "increment" in update.totalTipped) {
            pool.totalTipped += update.totalTipped.increment as bigint;
          }
        }
        return pool;
      }),
      aggregate: vi.fn(async () => {
        let total = 0n;
        for (const pool of store.bountyPools.values()) {
          total += pool.totalTipped;
        }
        return { _sum: { totalTipped: total } };
      }),
    },
    host: {
      findUnique: vi.fn(async ({ where }: { where: { pubkey: string } }) => {
        return store.hosts.get(where.pubkey) ?? null;
      }),
    },
    epochSummaryRecord: {
      count: vi.fn(async ({ where }: { where: { epoch: number } }) => {
        return store.epochSummaries.filter((s) => s.epoch === where.epoch).length;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: summaryId++,
          epoch: data.epoch as number,
          hostPubkey: data.hostPubkey as string,
          cid: data.cid as string,
          receiptCount: data.receiptCount as number,
          uniqueClients: data.uniqueClients as number,
          rewardSats: data.rewardSats as bigint,
          autoBidSats: (data.autoBidSats as number) ?? 0,
          egressRoyaltySats: (data.egressRoyaltySats as number) ?? 0,
        };
        store.epochSummaries.push(record);
        return record;
      }),
    },
    pinContract: {
      findMany: vi.fn(async () => []), // no active pins in epoch-settlement tests
      update: vi.fn(async () => ({})),
    },
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          seq: eventSeq++,
          type: data.type as string,
          timestamp: data.timestamp as bigint,
          signer: data.signer as string,
          sig: data.sig as string,
          payload: data.payload,
          createdAt: new Date(),
        };
        store.events.push(record);
        return record;
      }),
    },
  } as unknown;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("settleEpoch", () => {
  let store: MockStore;

  beforeEach(() => {
    // Set genesis so epoch 5 is in the past
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);

    store = {
      receipts: [],
      bountyPools: new Map(),
      hosts: new Map(),
      epochSummaries: [],
      events: [],
    };
  });

  it("no receipts → zero payouts, no summaries persisted, no auto-bids", async () => {
    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.epoch).toBe(EPOCH);
    expect(result.totalGroups).toBe(0);
    expect(result.eligibleGroups).toBe(0);
    expect(result.paidGroups).toBe(0);
    expect(result.totalPaidSats).toBe(0);
    expect(result.totalEgressRoyaltySats).toBe(0);
    expect(result.totalProvenEgressSats).toBe(0);
    expect(result.totalAutoBidSats).toBe(0);
    expect(result.totalAutoBidRoyaltySats).toBe(0);
    expect(store.epochSummaries).toHaveLength(0);
  });

  it("1 receipt with proven sats → eligible (smooth model, no 5/3 gate)", async () => {
    // Under old rules: 1 receipt < 5 → ineligible.
    // Under new rules: receiptCount >= 1 && totalProvenSats > 0 → eligible.
    store.receipts.push(makeReceipt(HOST_A, CID_1, client(1), 0));
    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: 1000n,
      lastPayoutEpoch: 0,
      totalTipped: 1000n,
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 0.8 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.totalGroups).toBe(1);
    expect(result.eligibleGroups).toBe(1);
    expect(result.paidGroups).toBe(1);
    expect(result.totalPaidSats).toBeGreaterThan(0);
    // Even with small payoutWeight, host should earn something
    expect(store.epochSummaries).toHaveLength(1);
    expect(Number(store.epochSummaries[0]!.rewardSats)).toBeGreaterThan(0);
  });

  it("single eligible host: bounty drains correctly with egress royalty", async () => {
    const bountyBalance = 2500;

    // 6 receipts from 4 unique clients at 3 sats each
    for (let i = 0; i < 6; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 4), i));
    }
    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: BigInt(bountyBalance),
      lastPayoutEpoch: 0,
      totalTipped: BigInt(bountyBalance),
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.eligibleGroups).toBe(1);
    expect(result.paidGroups).toBe(1);

    // Verify reward amount matches physics formula
    const cap = cidEpochCap(bountyBalance);
    const expectedReward = Math.floor(cap * (1 - AGGREGATOR_FEE_PCT));
    const expectedAggFee = Math.floor(cap * AGGREGATOR_FEE_PCT);

    expect(result.totalPaidSats).toBe(expectedReward);
    expect(result.totalAggregatorFeeSats).toBe(expectedAggFee);

    // Verify egress royalty
    const totalEgress = 6 * PRICE_SATS; // 6 receipts × 3 sats
    const expectedEgressRoyalty = Math.floor(totalEgress * EGRESS_ROYALTY_PCT);
    expect(result.totalEgressRoyaltySats).toBe(expectedEgressRoyalty);
    expect(result.totalProvenEgressSats).toBe(totalEgress);

    // Bounty pool should be debited by reward + agg fee + egress royalty
    const remainingBalance = Number(store.bountyPools.get(CID_1)!.balance);
    expect(remainingBalance).toBe(bountyBalance - (expectedReward + expectedAggFee + expectedEgressRoyalty));

    // EpochSummary persisted
    expect(store.epochSummaries).toHaveLength(1);
    expect(Number(store.epochSummaries[0]!.rewardSats)).toBe(expectedReward);

    // Event logged
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.type).toBe("epoch.summary.v1");
  });

  it("two eligible hosts for same CID: rewards split by payoutWeight × quality", async () => {
    const bountyBalance = 5000;

    // Host A: 8 receipts from 5 clients at 3 sats each (high payoutWeight)
    for (let i = 0; i < 8; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i));
    }
    // Host B: 5 receipts from 3 clients at 3 sats each (lower payoutWeight)
    for (let i = 0; i < 5; i++) {
      store.receipts.push(
        makeReceipt(HOST_B, CID_1, client(10 + (i % 3)), 100 + i),
      );
    }

    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: BigInt(bountyBalance),
      lastPayoutEpoch: 0,
      totalTipped: BigInt(bountyBalance),
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });
    store.hosts.set(HOST_B, { pubkey: HOST_B, availabilityScore: 0.8 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.eligibleGroups).toBe(2);
    expect(result.paidGroups).toBe(2);

    // Host A should earn more (higher payoutWeight + higher uptime)
    const hostAReward = result.summaries.find(
      (s) => s.host === HOST_A && s.eligible,
    )!;
    const hostBReward = result.summaries.find(
      (s) => s.host === HOST_B && s.eligible,
    )!;
    expect(hostAReward.rewardSats).toBeGreaterThan(hostBReward.rewardSats);

    // Total paid should be less than cap (rounding)
    const cap = cidEpochCap(bountyBalance);
    expect(result.totalPaidSats).toBeLessThanOrEqual(
      Math.floor(cap * (1 - AGGREGATOR_FEE_PCT)),
    );

    // Egress royalty should be tracked
    expect(result.totalEgressRoyaltySats).toBeGreaterThanOrEqual(0);
    expect(result.totalProvenEgressSats).toBe((8 + 5) * PRICE_SATS);
  });

  it("eligible group but zero bounty → zero reward", async () => {
    // 1 receipt with proven sats (eligible under smooth model)
    store.receipts.push(makeReceipt(HOST_A, CID_1, client(1), 0));
    // No bounty pool exists for CID_1

    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.eligibleGroups).toBe(1);
    expect(result.paidGroups).toBe(0);
    expect(result.totalPaidSats).toBe(0);
    // Summary still recorded
    expect(store.epochSummaries).toHaveLength(1);
    expect(Number(store.epochSummaries[0]!.rewardSats)).toBe(0);
  });

  it("idempotent: second call returns zero (no double-spend)", async () => {
    // Seed eligible receipts
    for (let i = 0; i < 6; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 4), i));
    }
    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: 2500n,
      lastPayoutEpoch: 0,
      totalTipped: 2500n,
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);

    // First settlement
    const result1 = await settleEpoch(prisma as never, EPOCH);
    expect(result1.paidGroups).toBe(1);

    // Second settlement — should be a no-op (summaries already exist)
    const result2 = await settleEpoch(prisma as never, EPOCH);
    expect(result2.totalGroups).toBe(0);
    expect(result2.paidGroups).toBe(0);
    expect(result2.totalPaidSats).toBe(0);
    expect(result2.totalEgressRoyaltySats).toBe(0);
    expect(result2.totalAutoBidSats).toBe(0);
    expect(result2.totalAutoBidRoyaltySats).toBe(0);
  });

  it("assetRoot used as CID when available", async () => {
    const ASSET_ROOT = "99".repeat(32);

    // Receipts with assetRoot set
    for (let i = 0; i < 6; i++) {
      const r = makeReceipt(HOST_A, CID_1, client(i % 4), i);
      r.assetRoot = ASSET_ROOT;
      store.receipts.push(r);
    }

    store.bountyPools.set(ASSET_ROOT, {
      cid: ASSET_ROOT,
      balance: 1000n,
      lastPayoutEpoch: 0,
      totalTipped: 1000n,
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.eligibleGroups).toBe(1);
    // The CID in summaries should be assetRoot, not fileRoot
    expect(result.summaries[0]!.cid).toBe(ASSET_ROOT);
    // Bounty pool for assetRoot should be debited
    expect(Number(store.bountyPools.get(ASSET_ROOT)!.balance)).toBeLessThan(1000);
  });

  it("mixed eligible and ineligible groups in same epoch", async () => {
    // CID_1: eligible (6 receipts, 4 clients, proven sats)
    for (let i = 0; i < 6; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 4), i));
    }
    // CID_2: ineligible (receipts with 0 price_sats)
    for (let i = 0; i < 2; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_2, client(10), 100 + i, 0));
    }

    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: 1000n,
      lastPayoutEpoch: 0,
      totalTipped: 1000n,
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.totalGroups).toBe(2);
    expect(result.eligibleGroups).toBe(1);
    expect(result.paidGroups).toBe(1);

    // Both groups should have summaries
    expect(store.epochSummaries).toHaveLength(2);
    const ineligible = result.summaries.find((s) => s.cid === CID_2)!;
    expect(ineligible.eligible).toBe(false);
    expect(ineligible.rewardSats).toBe(0);
  });

  it("egress royalty is flat 1% regardless of volume", async () => {
    const bountyBalance = 100_000;
    const highPriceSats = 500; // expensive blocks

    // 10 receipts from 5 clients at 500 sats each = 5000 total egress
    for (let i = 0; i < 10; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i, highPriceSats));
    }
    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: BigInt(bountyBalance),
      lastPayoutEpoch: 0,
      totalTipped: BigInt(bountyBalance),
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    const totalEgress = 10 * highPriceSats; // 5000
    expect(result.totalProvenEgressSats).toBe(totalEgress);
    expect(result.totalEgressRoyaltySats).toBe(Math.floor(totalEgress * EGRESS_ROYALTY_PCT)); // 50
    expect(result.totalEgressRoyaltySats).toBe(50);
  });

  // ── Auto-bid tests ──────────────────────────────────────────────

  it("auto-bids: 2% of proven egress credited to pool (with royalty)", async () => {
    const bountyBalance = 10_000;
    const priceSats = 500; // 500 sats per receipt

    // 10 receipts × 500 sats = 5000 total egress
    for (let i = 0; i < 10; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i, priceSats));
    }
    store.bountyPools.set(CID_1, {
      cid: CID_1,
      balance: BigInt(bountyBalance),
      lastPayoutEpoch: 0,
      totalTipped: BigInt(bountyBalance),
    });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    // Auto-bid = floor(5000 * 0.02) = 100
    const expectedAutoBid = Math.floor(5000 * AUTO_BID_PCT);
    expect(expectedAutoBid).toBe(100);
    expect(result.totalAutoBidSats).toBe(expectedAutoBid);

    // Royalty on auto-bid: computed from cumulative volume (not exactly genesis rate
    // because the pool already has totalTipped=10000 in the mock store)
    expect(result.totalAutoBidRoyaltySats).toBeGreaterThan(0);
    expect(result.totalAutoBidRoyaltySats).toBeLessThanOrEqual(
      Math.floor(expectedAutoBid * FOUNDER_ROYALTY_R0),
    );
    const actualRoyalty = result.totalAutoBidRoyaltySats;

    // Pool balance should reflect: original - drain + auto-bid credit (after royalty)
    const pool = store.bountyPools.get(CID_1)!;
    const cap = cidEpochCap(bountyBalance);
    const egressRoyalty = Math.floor(5000 * EGRESS_ROYALTY_PCT);
    const aggFee = Math.floor(cap * AGGREGATOR_FEE_PCT);
    const hostReward = Math.floor(cap * (1 - AGGREGATOR_FEE_PCT));
    const totalDrain = hostReward + aggFee + egressRoyalty;
    const autoBidCredit = expectedAutoBid - actualRoyalty;

    expect(Number(pool.balance)).toBe(bountyBalance - totalDrain + autoBidCredit);
  });

  it("auto-bids: multiple CIDs get separate auto-bid credits", async () => {
    const priceSats = 200;

    // CID_1: 5 receipts × 200 = 1000 egress → auto-bid = floor(1000*0.02) = 20
    for (let i = 0; i < 5; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i), i, priceSats));
    }
    // CID_2: 3 receipts × 200 = 600 egress → auto-bid = floor(600*0.02) = 12
    for (let i = 0; i < 3; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_2, client(10 + i), 100 + i, priceSats));
    }

    store.bountyPools.set(CID_1, { cid: CID_1, balance: 5000n, lastPayoutEpoch: 0, totalTipped: 5000n });
    store.bountyPools.set(CID_2, { cid: CID_2, balance: 3000n, lastPayoutEpoch: 0, totalTipped: 3000n });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    // Total auto-bids = 20 + 12 = 32
    expect(result.totalAutoBidSats).toBe(32);
    expect(result.totalAutoBidRoyaltySats).toBeGreaterThan(0);

    // Both pools should have received auto-bid credits
    // (exact balance depends on drain + credit, but both should exist)
    expect(store.bountyPools.has(CID_1)).toBe(true);
    expect(store.bountyPools.has(CID_2)).toBe(true);
  });

  it("auto-bids: zero-price receipts produce no auto-bids", async () => {
    // All receipts at 0 price (e.g., free preview fetches)
    for (let i = 0; i < 5; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i), i, 0));
    }
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.totalAutoBidSats).toBe(0);
    expect(result.totalAutoBidRoyaltySats).toBe(0);
  });

  it("auto-bids: small egress that rounds to 0 produces no auto-bid", async () => {
    // 3 sats × 6 receipts = 18 total egress → floor(18 * 0.02) = 0
    for (let i = 0; i < 6; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 4), i, 3));
    }
    store.bountyPools.set(CID_1, { cid: CID_1, balance: 2500n, lastPayoutEpoch: 0, totalTipped: 2500n });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    // 18 * 0.02 = 0.36, floor = 0 → no auto-bid
    expect(result.totalAutoBidSats).toBe(0);
    expect(result.totalAutoBidRoyaltySats).toBe(0);
  });

  it("auto-bids: creates pool if CID has no existing pool", async () => {
    const priceSats = 500;

    // CID_1 has no bounty pool (host earns 0 from pool, but L402 was paid)
    for (let i = 0; i < 10; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i, priceSats));
    }
    // Don't set a bounty pool for CID_1
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    // Auto-bid = floor(5000 * 0.02) = 100
    expect(result.totalAutoBidSats).toBe(100);

    // Pool should now exist (created by creditTip via upsert)
    const pool = store.bountyPools.get(CID_1);
    expect(pool).toBeDefined();
    expect(Number(pool!.balance)).toBeGreaterThan(0);
  });

  it("auto-bids: EpochSummaryRecord includes autoBidSats field", async () => {
    const priceSats = 500;

    for (let i = 0; i < 10; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i, priceSats));
    }
    store.bountyPools.set(CID_1, { cid: CID_1, balance: 5000n, lastPayoutEpoch: 0, totalTipped: 5000n });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    await settleEpoch(prisma as never, EPOCH);

    // Check that the EpochSummaryRecord was persisted with autoBidSats
    expect(store.epochSummaries).toHaveLength(1);
    const summary = store.epochSummaries[0]!;
    expect(summary.autoBidSats).toBe(Math.floor(5000 * AUTO_BID_PCT)); // 100
    expect(summary.egressRoyaltySats).toBeGreaterThanOrEqual(0);
  });

  it("auto-bids: settlement event log includes auto-bid totals", async () => {
    const priceSats = 500;

    for (let i = 0; i < 10; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i, priceSats));
    }
    store.bountyPools.set(CID_1, { cid: CID_1, balance: 10000n, lastPayoutEpoch: 0, totalTipped: 10000n });
    store.hosts.set(HOST_A, { pubkey: HOST_A, availabilityScore: 1.0 });

    const prisma = createMockPrisma(store);
    await settleEpoch(prisma as never, EPOCH);

    // Event log should contain auto-bid fields
    expect(store.events).toHaveLength(1);
    const payload = store.events[0]!.payload as Record<string, unknown>;
    expect(payload.total_auto_bid_sats).toBe(Math.floor(5000 * AUTO_BID_PCT));
    expect(payload.total_auto_bid_royalty_sats).toBeGreaterThan(0);
  });
});
