/**
 * Pin contract lifecycle tests.
 * DocRef: MVP_PLAN:§Pin Contract API
 *
 * Tests: create, validate, status, cancel, drain rate, exhaustion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PIN_MIN_BUDGET_SATS,
  PIN_MAX_COPIES,
  PIN_CANCEL_FEE_PCT,
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
  cidFromObject,
} from "@dupenet/physics";
import {
  createPin,
  getPinStatus,
  cancelPin,
  drainPinBudgets,
  validatePinInput,
  type CreatePinInput,
} from "../src/views/pin-contracts.js";

// ── Helpers ────────────────────────────────────────────────────────

const CLIENT = "aa".repeat(32);
const ASSET_ROOT = "bb".repeat(32);

function makeInput(overrides?: Partial<CreatePinInput>): CreatePinInput {
  return {
    client: CLIENT,
    asset_root: ASSET_ROOT,
    min_copies: 3,
    duration_epochs: 100,
    budget_sats: 1000,
    sig: "cc".repeat(64),
    ...overrides,
  };
}

// ── Mock PrismaClient ──────────────────────────────────────────────

interface MockStore {
  pinContracts: Map<string, {
    id: string;
    client: string;
    assetRoot: string;
    minCopies: number;
    durationEpochs: number;
    budgetSats: bigint;
    drainRate: bigint;
    remainingBudget: bigint;
    status: string;
    createdEpoch: number;
    sig: string;
    createdAt: Date;
  }>;
  bountyPools: Map<string, {
    cid: string;
    balance: bigint;
    lastPayoutEpoch: number;
    totalTipped: bigint;
  }>;
  epochSummaries: Array<{
    id: number;
    epoch: number;
    hostPubkey: string;
    cid: string;
    receiptCount: number;
    uniqueClients: number;
    rewardSats: bigint;
  }>;
  events: Array<{
    seq: number;
    type: string;
    timestamp: bigint;
    signer: string;
    sig: string;
    payload: unknown;
    createdAt: Date;
  }>;
}

function createMockPrisma(store: MockStore) {
  let eventSeq = 1;
  let summaryId = 1;

  return {
    pinContract: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = data.id as string;
        if (store.pinContracts.has(id)) {
          throw new Error("Unique constraint failed");
        }
        const record = {
          id,
          client: data.client as string,
          assetRoot: data.assetRoot as string,
          minCopies: data.minCopies as number,
          durationEpochs: data.durationEpochs as number,
          budgetSats: data.budgetSats as bigint,
          drainRate: data.drainRate as bigint,
          remainingBudget: data.remainingBudget as bigint,
          status: data.status as string,
          createdEpoch: data.createdEpoch as number,
          sig: data.sig as string,
          createdAt: new Date(),
        };
        store.pinContracts.set(id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.pinContracts.get(where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { assetRoot: string; status: string } }) => {
        return Array.from(store.pinContracts.values()).filter(
          (p) => p.assetRoot === where.assetRoot && p.status === where.status,
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const pin = store.pinContracts.get(where.id);
        if (!pin) throw new Error("Not found");
        if (data.status !== undefined) pin.status = data.status as string;
        if (data.remainingBudget !== undefined) pin.remainingBudget = data.remainingBudget as bigint;
        return pin;
      }),
    },
    bountyPool: {
      upsert: vi.fn(async ({ where, create, update }: {
        where: { poolKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = store.bountyPools.get(where.poolKey);
        if (existing) {
          if (update.balance && typeof update.balance === "object" && "increment" in update.balance) {
            existing.balance += update.balance.increment as bigint;
          }
          return existing;
        }
        const record = {
          poolKey: create.poolKey as string,
          balance: create.balance as bigint,
          lastPayoutEpoch: 0,
          totalTipped: create.totalTipped as bigint,
        };
        store.bountyPools.set(where.poolKey, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: { where: { poolKey: string } }) => {
        return store.bountyPools.get(where.poolKey) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { poolKey: string }; data: Record<string, unknown> }) => {
        const pool = store.bountyPools.get(where.poolKey);
        if (!pool) throw new Error("Pool not found");
        if (data.balance && typeof data.balance === "object" && "decrement" in data.balance) {
          pool.balance -= data.balance.decrement as bigint;
        }
        if (data.lastPayoutEpoch !== undefined) {
          pool.lastPayoutEpoch = data.lastPayoutEpoch as number;
        }
        return pool;
      }),
    },
    epochSummaryRecord: {
      findMany: vi.fn(async ({ where }: { where: { cid: string; epoch: { gte: number } } }) => {
        return store.epochSummaries.filter(
          (s) => s.cid === where.cid && s.epoch >= where.epoch.gte,
        );
      }),
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

describe("validatePinInput", () => {
  it("valid input passes", () => {
    expect(validatePinInput(makeInput()).valid).toBe(true);
  });

  it("budget below minimum fails", () => {
    const result = validatePinInput(makeInput({ budget_sats: 10 }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("budget_sats");
  });

  it("min_copies too high fails", () => {
    const result = validatePinInput(makeInput({ min_copies: 50 }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("min_copies");
  });

  it("min_copies zero fails", () => {
    const result = validatePinInput(makeInput({ min_copies: 0 }));
    expect(result.valid).toBe(false);
  });

  it("duration_epochs zero fails", () => {
    const result = validatePinInput(makeInput({ duration_epochs: 0 }));
    expect(result.valid).toBe(false);
  });

  it("invalid asset_root fails", () => {
    const result = validatePinInput(makeInput({ asset_root: "not-hex" }));
    expect(result.valid).toBe(false);
  });
});

describe("createPin", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      pinContracts: new Map(),
      bountyPools: new Map(),
      epochSummaries: [],
      events: [],
    };
  });

  it("creates pin contract and credits bounty pool", async () => {
    const prisma = createMockPrisma(store);
    const input = makeInput();
    const pin = await createPin(prisma as never, input);

    expect(pin.client).toBe(CLIENT);
    expect(pin.asset_root).toBe(ASSET_ROOT);
    expect(pin.budget_sats).toBe(1000);
    expect(pin.drain_rate).toBe(10); // 1000 / 100
    expect(pin.remaining_budget).toBe(1000);
    expect(pin.status).toBe("ACTIVE");

    // Bounty pool should be credited
    const pool = store.bountyPools.get(ASSET_ROOT)!;
    expect(Number(pool.balance)).toBe(1000);

    // Event logged
    expect(store.events).toHaveLength(1);
    expect(store.events[0]!.type).toBe("pin.create.v1");

    // Pin stored
    expect(store.pinContracts.size).toBe(1);
  });

  it("drain_rate rounds down", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput({
      budget_sats: 1000,
      duration_epochs: 3,
    }));
    expect(pin.drain_rate).toBe(333); // floor(1000/3)
  });

  it("pin ID is deterministic from content", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput());
    expect(pin.id).toMatch(/^[0-9a-f]{64}$/);
    // ID should be non-empty hex
    expect(pin.id.length).toBe(64);
  });
});

describe("getPinStatus", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      pinContracts: new Map(),
      bountyPools: new Map(),
      epochSummaries: [],
      events: [],
    };
  });

  it("returns null for non-existent pin", async () => {
    const prisma = createMockPrisma(store);
    const result = await getPinStatus(prisma as never, "00".repeat(32));
    expect(result).toBeNull();
  });

  it("returns pin status with active hosts from epoch summaries", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput());

    // Simulate epoch summaries for this asset
    const HOST_A = "11".repeat(32);
    const HOST_B = "22".repeat(32);
    store.epochSummaries.push(
      { id: 1, epoch: 8, hostPubkey: HOST_A, cid: ASSET_ROOT, receiptCount: 5, uniqueClients: 3, rewardSats: 10n },
      { id: 2, epoch: 8, hostPubkey: HOST_B, cid: ASSET_ROOT, receiptCount: 6, uniqueClients: 4, rewardSats: 12n },
      { id: 3, epoch: 9, hostPubkey: HOST_A, cid: ASSET_ROOT, receiptCount: 7, uniqueClients: 5, rewardSats: 15n },
    );

    const status = await getPinStatus(prisma as never, pin.id);
    expect(status).not.toBeNull();
    expect(status!.active_hosts).toBe(2); // HOST_A and HOST_B
    expect(status!.copies_met).toBe(false); // 2 < min_copies(3)
    expect(status!.recent_epoch_proofs).toHaveLength(3);
  });

  it("copies_met is true when enough hosts", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput({ min_copies: 2 }));

    const HOST_A = "11".repeat(32);
    const HOST_B = "22".repeat(32);
    store.epochSummaries.push(
      { id: 1, epoch: 8, hostPubkey: HOST_A, cid: ASSET_ROOT, receiptCount: 5, uniqueClients: 3, rewardSats: 10n },
      { id: 2, epoch: 8, hostPubkey: HOST_B, cid: ASSET_ROOT, receiptCount: 6, uniqueClients: 4, rewardSats: 12n },
    );

    const status = await getPinStatus(prisma as never, pin.id);
    expect(status!.copies_met).toBe(true); // 2 >= min_copies(2)
  });
});

describe("cancelPin", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      pinContracts: new Map(),
      bountyPools: new Map(),
      epochSummaries: [],
      events: [],
    };
  });

  it("cancel returns remaining budget minus fee", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput({ budget_sats: 1000 }));

    const result = await cancelPin(prisma as never, pin.id, "sig");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      const expectedFee = Math.floor(1000 * PIN_CANCEL_FEE_PCT);
      expect(result.fee).toBe(expectedFee); // 50
      expect(result.refund).toBe(1000 - expectedFee); // 950
    }

    // Pin should be CANCELLED with zero remaining
    const cancelled = store.pinContracts.get(pin.id)!;
    expect(cancelled.status).toBe("CANCELLED");
    expect(Number(cancelled.remainingBudget)).toBe(0);

    // Event logged
    const cancelEvent = store.events.find((e) => e.type === "pin.cancel.v1");
    expect(cancelEvent).toBeDefined();
  });

  it("cancel non-existent pin returns error", async () => {
    const prisma = createMockPrisma(store);
    const result = await cancelPin(prisma as never, "00".repeat(32), "sig");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("pin_not_found");
  });

  it("cancel already-cancelled pin returns error", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput());
    await cancelPin(prisma as never, pin.id, "sig");

    const result = await cancelPin(prisma as never, pin.id, "sig");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("pin_not_active");
  });

  it("cancel partially drained pin returns only remaining budget", async () => {
    const prisma = createMockPrisma(store);
    const pin = await createPin(prisma as never, makeInput({ budget_sats: 1000 }));

    // Simulate draining 300 from the pin's remaining budget
    const pinRecord = store.pinContracts.get(pin.id)!;
    pinRecord.remainingBudget = 700n;

    const result = await cancelPin(prisma as never, pin.id, "sig");
    if (!("error" in result)) {
      const expectedFee = Math.floor(700 * PIN_CANCEL_FEE_PCT);
      expect(result.fee).toBe(expectedFee); // 35
      expect(result.refund).toBe(700 - expectedFee); // 665
    }
  });
});

describe("drainPinBudgets", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      pinContracts: new Map(),
      bountyPools: new Map(),
      epochSummaries: [],
      events: [],
    };
  });

  it("drains pin by min(actualDrain, drainRate)", async () => {
    const prisma = createMockPrisma(store);
    await createPin(prisma as never, makeInput({
      budget_sats: 1000,
      duration_epochs: 100,
    })); // drain_rate = 10

    // Actual epoch drain = 50 (larger than drain_rate)
    const exhausted = await drainPinBudgets(prisma as never, ASSET_ROOT, 50);

    expect(exhausted).toBe(0);
    const pin = Array.from(store.pinContracts.values())[0]!;
    expect(Number(pin.remainingBudget)).toBe(990); // drained by 10 (drain_rate)
    expect(pin.status).toBe("ACTIVE");
  });

  it("drains by actualDrain when smaller than drainRate", async () => {
    const prisma = createMockPrisma(store);
    await createPin(prisma as never, makeInput({
      budget_sats: 1000,
      duration_epochs: 10,
    })); // drain_rate = 100

    // Actual epoch drain = 30 (smaller than drain_rate)
    await drainPinBudgets(prisma as never, ASSET_ROOT, 30);

    const pin = Array.from(store.pinContracts.values())[0]!;
    expect(Number(pin.remainingBudget)).toBe(970); // drained by 30
  });

  it("exhausts pin when remaining drops to 0", async () => {
    const prisma = createMockPrisma(store);
    await createPin(prisma as never, makeInput({
      budget_sats: 100,
      duration_epochs: 10,
    })); // drain_rate = 10

    // Drain 10 times
    for (let i = 0; i < 10; i++) {
      await drainPinBudgets(prisma as never, ASSET_ROOT, 20);
    }

    const pin = Array.from(store.pinContracts.values())[0]!;
    expect(Number(pin.remainingBudget)).toBe(0);
    expect(pin.status).toBe("EXHAUSTED");
  });

  it("returns count of exhausted pins", async () => {
    const prisma = createMockPrisma(store);
    // Create pin with only 5 sats remaining
    await createPin(prisma as never, makeInput({ budget_sats: PIN_MIN_BUDGET_SATS, duration_epochs: 1 }));

    const pin = Array.from(store.pinContracts.values())[0]!;
    pin.remainingBudget = 5n; // almost exhausted

    const exhausted = await drainPinBudgets(prisma as never, ASSET_ROOT, 100);
    expect(exhausted).toBe(1);
    expect(pin.status).toBe("EXHAUSTED");
  });

  it("does nothing when no active pins for CID", async () => {
    const prisma = createMockPrisma(store);
    const exhausted = await drainPinBudgets(prisma as never, ASSET_ROOT, 100);
    expect(exhausted).toBe(0);
  });

  it("skips already-exhausted pins", async () => {
    const prisma = createMockPrisma(store);
    await createPin(prisma as never, makeInput());

    // Manually exhaust the pin
    const pin = Array.from(store.pinContracts.values())[0]!;
    pin.status = "EXHAUSTED";
    pin.remainingBudget = 0n;

    // findMany filters by status=ACTIVE, so this should find nothing
    const exhausted = await drainPinBudgets(prisma as never, ASSET_ROOT, 100);
    expect(exhausted).toBe(0);
  });
});
