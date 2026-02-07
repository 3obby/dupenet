/**
 * Availability monitoring + status lifecycle tests.
 * DocRef: MVP_PLAN:§Enforcement: Earning Decay, §Availability Score
 *
 * Tests: spot-check execution, score computation, status transitions,
 * and integration with epoch settlement (degraded host gets zero).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
} from "@dupenet/physics";
import {
  spotCheckHost,
  runAllChecks,
  recordCheck,
  getHostChecks,
  updateAllScores,
  type SpotCheckFetcher,
  type SpotCheckResult,
} from "../src/views/availability.js";

// ── Helpers ────────────────────────────────────────────────────────

const HOST_A = "aa".repeat(32);
const HOST_B = "bb".repeat(32);
const CID_1 = "11".repeat(32);
const CID_2 = "22".repeat(32);
const ENDPOINT = "http://host-a:3100";

// ── Mock PrismaClient ──────────────────────────────────────────────

interface MockStore {
  hosts: Map<string, {
    pubkey: string;
    endpoint: string | null;
    status: string;
    availabilityScore: number;
  }>;
  hostServes: Array<{ hostPubkey: string; cid: string }>;
  spotChecks: Array<{
    id: number;
    hostPubkey: string;
    cid: string;
    epoch: number;
    passed: boolean;
    latencyMs: number | null;
    error: string | null;
    checkedAt: Date;
  }>;
}

function createMockPrisma(store: MockStore) {
  let checkId = 1;

  return {
    host: {
      findUnique: vi.fn(async ({ where }: { where: { pubkey: string } }) => {
        return store.hosts.get(where.pubkey) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        let hosts = Array.from(store.hosts.values());
        if (where?.status && typeof where.status === "object" && "notIn" in where.status) {
          const notIn = (where.status as { notIn: string[] }).notIn;
          hosts = hosts.filter((h) => !notIn.includes(h.status));
        }
        if (where?.endpoint && typeof where.endpoint === "object" && "not" in where.endpoint) {
          hosts = hosts.filter((h) => h.endpoint !== null);
        }
        return hosts;
      }),
      update: vi.fn(async ({ where, data }: { where: { pubkey: string }; data: Record<string, unknown> }) => {
        const host = store.hosts.get(where.pubkey);
        if (!host) throw new Error("Not found");
        if (data.availabilityScore !== undefined) {
          host.availabilityScore = data.availabilityScore as number;
        }
        if (data.status !== undefined) {
          host.status = data.status as string;
        }
        return host;
      }),
    },
    hostServe: {
      findMany: vi.fn(async ({ where }: { where: { hostPubkey: string } }) => {
        return store.hostServes.filter((s) => s.hostPubkey === where.hostPubkey);
      }),
    },
    spotCheck: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: checkId++,
          hostPubkey: data.hostPubkey as string,
          cid: data.cid as string,
          epoch: data.epoch as number,
          passed: data.passed as boolean,
          latencyMs: data.latencyMs as number | null,
          error: data.error as string | null,
          checkedAt: new Date(),
        };
        store.spotChecks.push(record);
        return record;
      }),
      findMany: vi.fn(async ({ where, orderBy: _orderBy, select: _select }: {
        where: { hostPubkey: string; epoch: { gte: number } };
        orderBy?: Record<string, string>;
        select?: Record<string, boolean>;
      }) => {
        return store.spotChecks
          .filter(
            (c) =>
              c.hostPubkey === where.hostPubkey &&
              c.epoch >= where.epoch.gte,
          )
          .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
      }),
    },
  } as unknown;
}

// ── Mock Fetcher ───────────────────────────────────────────────────

function mockFetcher(results: Map<string, boolean>): SpotCheckFetcher {
  return async (url: string) => {
    // Extract CID from URL: http://host:port/spot-check/{cid}
    const cid = url.split("/spot-check/")[1];
    if (!cid || !results.has(cid)) {
      throw new Error("connection refused");
    }
    return { verified: results.get(cid)!, size: 262144 };
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("spotCheckHost", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      hosts: new Map(),
      hostServes: [],
      spotChecks: [],
    };
  });

  it("returns null for host with no endpoint", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: null,
      status: "PENDING",
      availabilityScore: 0,
    });

    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A);
    expect(result).toBeNull();
  });

  it("returns null for UNBONDING host", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "UNBONDING",
      availabilityScore: 0,
    });

    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A);
    expect(result).toBeNull();
  });

  it("returns null for host with no served CIDs", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "PENDING",
      availabilityScore: 0,
    });

    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A);
    expect(result).toBeNull();
  });

  it("passes when host responds with verified=true", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "PENDING",
      availabilityScore: 0,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    const fetcher = mockFetcher(new Map([[CID_1, true]]));
    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A, fetcher);

    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.hostPubkey).toBe(HOST_A);
    expect(result!.cid).toBe(CID_1);
    expect(result!.latencyMs).toBeDefined();
  });

  it("fails when host responds with verified=false", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "TRUSTED",
      availabilityScore: 1.0,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    const fetcher = mockFetcher(new Map([[CID_1, false]]));
    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A, fetcher);

    expect(result!.passed).toBe(false);
  });

  it("fails when host is unreachable", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "TRUSTED",
      availabilityScore: 1.0,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    const fetcher: SpotCheckFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const prisma = createMockPrisma(store);
    const result = await spotCheckHost(prisma as never, HOST_A, fetcher);

    expect(result!.passed).toBe(false);
    expect(result!.error).toBe("ECONNREFUSED");
  });
});

describe("runAllChecks + updateAllScores", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      hosts: new Map(),
      hostServes: [],
      spotChecks: [],
    };
  });

  it("checks all active hosts and updates scores", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: "http://host-a:3100",
      status: "PENDING",
      availabilityScore: 0,
    });
    store.hosts.set(HOST_B, {
      pubkey: HOST_B,
      endpoint: "http://host-b:3100",
      status: "PENDING",
      availabilityScore: 0,
    });
    store.hostServes.push(
      { hostPubkey: HOST_A, cid: CID_1 },
      { hostPubkey: HOST_B, cid: CID_2 },
    );

    const fetcher = mockFetcher(new Map([
      [CID_1, true],
      [CID_2, true],
    ]));

    const prisma = createMockPrisma(store);
    const summary = await runAllChecks(prisma as never, fetcher);

    expect(summary.totalHosts).toBe(2);
    expect(summary.checkedHosts).toBe(2);
    expect(summary.passedHosts).toBe(2);
    expect(summary.failedHosts).toBe(0);

    // Spot checks should be recorded
    expect(store.spotChecks).toHaveLength(2);

    // Scores should be updated (1 pass = 1.0 score → TRUSTED)
    expect(store.hosts.get(HOST_A)!.availabilityScore).toBe(1.0);
    expect(store.hosts.get(HOST_A)!.status).toBe("TRUSTED");
    expect(store.hosts.get(HOST_B)!.availabilityScore).toBe(1.0);
    expect(store.hosts.get(HOST_B)!.status).toBe("TRUSTED");
  });

  it("failing host transitions TRUSTED → DEGRADED", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "TRUSTED",
      availabilityScore: 1.0,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    // Seed 4 prior failures, then 1 more from this check = 0/5
    const epoch = Math.floor((Date.now() - (Date.now() - EPOCH_LENGTH_MS * 10)) / EPOCH_LENGTH_MS);
    for (let i = 0; i < 4; i++) {
      store.spotChecks.push({
        id: i + 1,
        hostPubkey: HOST_A,
        cid: CID_1,
        epoch: epoch - 1,
        passed: false,
        latencyMs: 100,
        error: null,
        checkedAt: new Date(),
      });
    }

    // This check also fails
    const fetcher: SpotCheckFetcher = async () => {
      throw new Error("timeout");
    };

    const prisma = createMockPrisma(store);
    await runAllChecks(prisma as never, fetcher);

    // 0/5 checks passed → score 0.0 → INACTIVE (or DEGRADED depending on transition logic)
    expect(store.hosts.get(HOST_A)!.availabilityScore).toBe(0);
    // With score == 0 and previous status TRUSTED → goes to DEGRADED or INACTIVE
    // updateAvailability: score < 0.6 && status === "TRUSTED" → DEGRADED
    // BUT then score === 0 && status !== "UNBONDING" → INACTIVE
    // The code checks: score < 0.6 first (→ DEGRADED), then score === 0 (→ INACTIVE)
    // Since both conditions are checked, the final status depends on order
    // In updateAvailability: it's if/else-if, so score < 0.6 → DEGRADED wins
    // Then score === 0 check only triggers if status !== "UNBONDING" but the previous check already set DEGRADED
    // Actually let me re-read the code...
    // The status transitions are: if score >= 0.6 && PENDING → TRUSTED, elif score >= 0.6 && DEGRADED → TRUSTED,
    // elif score < 0.6 && TRUSTED → DEGRADED, elif score === 0 && not UNBONDING → INACTIVE
    // For TRUSTED with score 0: score < 0.6 → DEGRADED (third branch)
    // The score === 0 branch only triggers if not already matched
    expect(store.hosts.get(HOST_A)!.status).toBe("DEGRADED");
  });

  it("recovering host transitions DEGRADED → TRUSTED", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "DEGRADED",
      availabilityScore: 0.2,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    // Seed 2 prior passes
    const epoch = Math.floor((Date.now() - (Date.now() - EPOCH_LENGTH_MS * 10)) / EPOCH_LENGTH_MS);
    for (let i = 0; i < 2; i++) {
      store.spotChecks.push({
        id: i + 1,
        hostPubkey: HOST_A,
        cid: CID_1,
        epoch,
        passed: true,
        latencyMs: 50,
        error: null,
        checkedAt: new Date(),
      });
    }

    // This check also passes (3/3 = 1.0)
    const fetcher = mockFetcher(new Map([[CID_1, true]]));
    const prisma = createMockPrisma(store);
    await runAllChecks(prisma as never, fetcher);

    expect(store.hosts.get(HOST_A)!.availabilityScore).toBe(1.0);
    expect(store.hosts.get(HOST_A)!.status).toBe("TRUSTED");
  });

  it("skips hosts with no served CIDs", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "PENDING",
      availabilityScore: 0,
    });
    // No hostServes for HOST_A

    const fetcher = mockFetcher(new Map());
    const prisma = createMockPrisma(store);
    const summary = await runAllChecks(prisma as never, fetcher);

    expect(summary.totalHosts).toBe(1);
    expect(summary.skippedHosts).toBe(1);
    expect(summary.checkedHosts).toBe(0);
  });

  it("PENDING host transitions to TRUSTED on first pass", async () => {
    store.hosts.set(HOST_A, {
      pubkey: HOST_A,
      endpoint: ENDPOINT,
      status: "PENDING",
      availabilityScore: 0,
    });
    store.hostServes.push({ hostPubkey: HOST_A, cid: CID_1 });

    const fetcher = mockFetcher(new Map([[CID_1, true]]));
    const prisma = createMockPrisma(store);
    await runAllChecks(prisma as never, fetcher);

    expect(store.hosts.get(HOST_A)!.status).toBe("TRUSTED");
    expect(store.hosts.get(HOST_A)!.availabilityScore).toBe(1.0);
  });
});

describe("recordCheck + getHostChecks", () => {
  let store: MockStore;

  beforeEach(() => {
    setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
    store = {
      hosts: new Map(),
      hostServes: [],
      spotChecks: [],
    };
  });

  it("records and retrieves checks", async () => {
    const prisma = createMockPrisma(store);
    const result: SpotCheckResult = {
      hostPubkey: HOST_A,
      cid: CID_1,
      passed: true,
      latencyMs: 42,
    };

    await recordCheck(prisma as never, result, 8);
    await recordCheck(prisma as never, { ...result, passed: false }, 9);

    expect(store.spotChecks).toHaveLength(2);

    const checks = await getHostChecks(prisma as never, HOST_A);
    expect(checks).toHaveLength(2);
  });
});
