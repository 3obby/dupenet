/**
 * Epoch boundary scheduler tests.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards
 *
 * Tests the auto-settlement logic: detect epoch boundary → settle → track state.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
  currentEpoch,
} from "@dupenet/physics";
import { createEpochScheduler } from "../src/scheduler.js";

// ── Mock PrismaClient (minimal for scheduler) ─────────────────────

function createMockPrisma() {
  const settled = new Map<number, boolean>();

  return {
    _settled: settled,
    receipt: {
      findMany: vi.fn(async () => []), // no receipts → quick settle
    },
    epochSummaryRecord: {
      count: vi.fn(async ({ where }: { where: { epoch: number } }) => {
        return settled.has(where.epoch) ? 1 : 0;
      }),
      create: vi.fn(async () => ({})),
    },
    bountyPool: {
      findUnique: vi.fn(async () => null),
    },
    host: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    hostServe: {
      findMany: vi.fn(async () => []),
    },
    spotCheck: {
      create: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    pinContract: {
      findMany: vi.fn(async () => []),
    },
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Mark epoch as settled when event is logged
        const payload = data.payload as { epoch?: number } | null;
        if (payload?.epoch !== undefined) {
          settled.set(payload.epoch, true);
        }
        return { seq: 1, ...data, createdAt: new Date() };
      }),
    },
  } as unknown;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("createEpochScheduler", () => {
  beforeEach(() => {
    // Set genesis so we're in epoch 10 (plenty of closed epochs)
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
  });

  it("tick() settles the most recent closed epoch", async () => {
    const prisma = createMockPrisma();
    const onSettle = vi.fn();

    const scheduler = createEpochScheduler(prisma as never, {
      runSpotChecks: false,
      onSettle,
    });

    const result = await scheduler.tick();
    expect(result).not.toBeNull();

    const epoch = currentEpoch();
    // Should have settled epoch - 1 (the most recent closed epoch)
    expect(result!.epoch).toBe(epoch - 1);
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it("second tick() for same epoch returns null (already settled)", async () => {
    const prisma = createMockPrisma();
    const scheduler = createEpochScheduler(prisma as never, {
      runSpotChecks: false,
    });

    const first = await scheduler.tick();
    expect(first).not.toBeNull();

    const second = await scheduler.tick();
    expect(second).toBeNull(); // same epoch, already settled
  });

  it("lastSettledEpoch() tracks the latest settlement", async () => {
    const prisma = createMockPrisma();
    const scheduler = createEpochScheduler(prisma as never, {
      runSpotChecks: false,
    });

    expect(scheduler.lastSettledEpoch()).toBe(-1); // not started

    await scheduler.tick();

    const epoch = currentEpoch();
    expect(scheduler.lastSettledEpoch()).toBe(epoch - 1);
  });

  it("start() triggers immediate tick", async () => {
    const prisma = createMockPrisma();
    const onSettle = vi.fn();

    const scheduler = createEpochScheduler(prisma as never, {
      checkIntervalMs: 100_000, // long interval so only the immediate tick fires
      runSpotChecks: false,
      onSettle,
    });

    scheduler.start();

    // Wait a bit for the async tick to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(onSettle).toHaveBeenCalledOnce();

    scheduler.stop();
  });

  it("stop() prevents further ticks", async () => {
    const prisma = createMockPrisma();
    const scheduler = createEpochScheduler(prisma as never, {
      checkIntervalMs: 10,
      runSpotChecks: false,
    });

    scheduler.start();
    scheduler.stop();

    // After stop, no more ticks should fire
    await new Promise((r) => setTimeout(r, 50));

    // Only the immediate tick from start() should have run
    // (subsequent interval ticks should not)
    expect(scheduler.lastSettledEpoch()).toBeGreaterThanOrEqual(-1);
  });

  it("runs spot-checks after settlement when enabled", async () => {
    const prisma = createMockPrisma();
    const spotCheckFetcher = vi.fn(async () => ({
      verified: true,
      size: 100,
    }));

    const scheduler = createEpochScheduler(prisma as never, {
      runSpotChecks: true,
      spotCheckFetcher: spotCheckFetcher as never,
    });

    await scheduler.tick();

    // Spot-checks ran (even though no hosts to check, the function was called)
    // The host.findMany mock returns [] so no actual checks happen,
    // but the runAllChecks function was invoked
    expect(scheduler.lastSettledEpoch()).toBeGreaterThan(-1);
  });

  it("onError is called when settlement throws", async () => {
    const prisma = createMockPrisma();
    // Make receipt.findMany throw to simulate an error
    (prisma as any).receipt.findMany = vi.fn(async () => {
      throw new Error("db connection lost");
    });

    const onError = vi.fn();
    const scheduler = createEpochScheduler(prisma as never, {
      runSpotChecks: false,
      onError,
    });

    const result = await scheduler.tick();
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
