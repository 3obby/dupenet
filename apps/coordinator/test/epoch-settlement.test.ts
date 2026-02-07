/**
 * Epoch settlement integration test.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards, §Receipt-Based Payouts
 *
 * Uses a mock PrismaClient to test the full settlement flow:
 * receipts → aggregation → eligibility → reward computation → bounty drain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cidEpochCap,
  AGGREGATOR_FEE_PCT,
  RECEIPT_MIN_COUNT,
  RECEIPT_MIN_UNIQUE_CLIENTS,
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

function client(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function makeReceipt(
  host: string,
  cid: string,
  clientPubkey: string,
  idx: number,
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
    priceSats: 3,
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
      findUnique: vi.fn(async ({ where }: { where: { cid: string } }) => {
        return store.bountyPools.get(where.cid) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { cid: string }; data: Record<string, unknown> }) => {
        const pool = store.bountyPools.get(where.cid);
        if (!pool) throw new Error(`Pool not found: ${where.cid}`);
        if (data.balance && typeof data.balance === "object" && "decrement" in data.balance) {
          pool.balance -= data.balance.decrement as bigint;
        }
        if (data.lastPayoutEpoch !== undefined) {
          pool.lastPayoutEpoch = data.lastPayoutEpoch as number;
        }
        return pool;
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

  it("no receipts → zero payouts, no summaries persisted", async () => {
    const prisma = createMockPrisma(store);
    const result = await settleEpoch(prisma as never, EPOCH);

    expect(result.epoch).toBe(EPOCH);
    expect(result.totalGroups).toBe(0);
    expect(result.eligibleGroups).toBe(0);
    expect(result.paidGroups).toBe(0);
    expect(result.totalPaidSats).toBe(0);
    expect(store.epochSummaries).toHaveLength(0);
  });

  it("receipts below 5/3 threshold → ineligible, zero reward", async () => {
    // 4 receipts from 2 clients — below both thresholds
    for (let i = 0; i < 4; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 2), i));
    }
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
    expect(result.eligibleGroups).toBe(0);
    expect(result.paidGroups).toBe(0);
    expect(result.totalPaidSats).toBe(0);
    // Summary still persisted (with rewardSats=0)
    expect(store.epochSummaries).toHaveLength(1);
    expect(Number(store.epochSummaries[0]!.rewardSats)).toBe(0);
  });

  it("single eligible host: bounty drains correctly", async () => {
    const bountyBalance = 2500;

    // 6 receipts from 4 unique clients (above 5/3)
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

    // Bounty pool should be debited by reward + agg fee
    const remainingBalance = Number(store.bountyPools.get(CID_1)!.balance);
    expect(remainingBalance).toBe(bountyBalance - (expectedReward + expectedAggFee));

    // EpochSummary persisted
    expect(store.epochSummaries).toHaveLength(1);
    expect(Number(store.epochSummaries[0]!.rewardSats)).toBe(expectedReward);

    // Event logged
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.type).toBe("epoch.summary.v1");
  });

  it("two eligible hosts for same CID: rewards split by score", async () => {
    const bountyBalance = 5000;

    // Host A: 8 receipts from 5 clients (high score)
    for (let i = 0; i < 8; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 5), i));
    }
    // Host B: 5 receipts from 3 clients (minimum eligible)
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

    // Host A should earn more (higher score)
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
  });

  it("eligible group but zero bounty → zero reward", async () => {
    // 5 receipts from 3 clients (eligible)
    for (let i = 0; i < 5; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 3), i));
    }
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
    // CID_1: eligible (6 receipts, 4 clients)
    for (let i = 0; i < 6; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_1, client(i % 4), i));
    }
    // CID_2: ineligible (2 receipts, 1 client)
    for (let i = 0; i < 2; i++) {
      store.receipts.push(makeReceipt(HOST_A, CID_2, client(10), 100 + i));
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
});
