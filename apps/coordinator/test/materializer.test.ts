/**
 * Materializer endpoint tests — event query, feeds, thread view.
 * DocRef: MVP_PLAN:§Signal Aggregation, §Protocol vs Materializer Boundary
 *
 * Tests POST /event + GET /events, GET /feed/funded, GET /feed/recent,
 * GET /thread/:event_id using mock Prisma.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeypair,
  toHex,
  signEvent,
  encodeEventBody,
  computeEventId,
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
  ZERO_REF,
  EVENT_KIND_FUND,
  EVENT_KIND_ANNOUNCE,
  EVENT_KIND_POST,
  EVENT_KIND_HOST,
} from "@dupenet/physics";
import { buildApp } from "../src/server.js";

// ── Helpers ────────────────────────────────────────────────────────

let clientKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let clientPubHex: string;
let otherKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let otherPubHex: string;

beforeAll(async () => {
  setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
  clientKey = await generateKeypair();
  clientPubHex = toHex(clientKey.publicKey);
  otherKey = await generateKeypair();
  otherPubHex = toHex(otherKey.publicKey);
});

/** Post a signed EventV1 to the app and return the response. */
async function postEvent(
  app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never,
  key: { publicKey: Uint8Array; privateKey: Uint8Array },
  overrides: Partial<Omit<import("@dupenet/physics").EventV1, "sig">> = {},
) {
  const pubHex = toHex(key.publicKey);
  const unsigned = {
    v: 1 as const,
    kind: EVENT_KIND_FUND,
    from: pubHex,
    ref: "aa".repeat(32),
    body: "",
    sats: 0,
    ts: Date.now(),
    ...overrides,
  };
  const signed = await signEvent(key.privateKey, unsigned);
  const res = await app.inject({
    method: "POST",
    url: "/event",
    payload: signed,
  });
  return { res, signed, eventId: computeEventId(unsigned) };
}

// ── Mock Prisma ────────────────────────────────────────────────────

function createMockPrisma() {
  // Storage
  const pools = new Map<string, { poolKey: string; balance: bigint; totalTipped: bigint; lastPayoutEpoch: number }>();
  const hosts = new Map<string, Record<string, unknown>>();
  const hostServes: Array<{ hostPubkey: string; cid: string; registeredEpoch: number }> = [];
  const protocolEvents: Array<{
    id: number;
    eventId: string;
    kind: number;
    from: string;
    ref: string;
    body: string;
    sats: number;
    ts: bigint;
    sig: string;
    createdAt: Date;
  }> = [];
  let eventSeq = 1;
  let peSeq = 1;

  return {
    _protocolEvents: protocolEvents,
    _pools: pools,
    bountyPool: {
      aggregate: async () => {
        let total = 0n;
        for (const p of pools.values()) total += p.totalTipped;
        return { _sum: { totalTipped: total } };
      },
      findMany: async ({ where, orderBy: _orderBy, take: _take }: {
        where?: { balance?: { gte: bigint } };
        orderBy?: Record<string, string>;
        take?: number;
      }) => {
        const minBal = where?.balance?.gte ?? 0n;
        return Array.from(pools.values())
          .filter((p) => p.balance >= minBal)
          .sort((a, b) => Number(b.balance - a.balance))
          .slice(0, _take);
      },
      findUnique: async ({ where }: { where: { poolKey: string } }) => {
        return pools.get(where.poolKey) ?? null;
      },
      upsert: async ({ where, create, update }: {
        where: { poolKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = pools.get(where.poolKey);
        if (existing) {
          if (update.balance && typeof update.balance === "object" && "increment" in update.balance) {
            existing.balance += update.balance.increment as bigint;
          }
          if (update.totalTipped && typeof update.totalTipped === "object" && "increment" in update.totalTipped) {
            existing.totalTipped += update.totalTipped.increment as bigint;
          }
          return existing;
        }
        const record = {
          poolKey: create.poolKey as string,
          balance: create.balance as bigint,
          totalTipped: create.totalTipped as bigint,
          lastPayoutEpoch: 0,
        };
        pools.set(where.poolKey, record);
        return record;
      },
    },
    host: {
      upsert: async ({ where, create }: {
        where: { pubkey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = hosts.get(where.pubkey);
        if (existing) return existing;
        const record = {
          pubkey: create.pubkey,
          endpoint: create.endpoint,
          stake: create.stake,
          status: create.status ?? "PENDING",
          minRequestSats: create.minRequestSats,
          satsPerGb: create.satsPerGb,
          availabilityScore: create.availabilityScore ?? 0,
          registeredEpoch: create.registeredEpoch,
          unbondEpoch: null,
        };
        hosts.set(where.pubkey, record);
        return record;
      },
    },
    hostServe: {
      count: async ({ where }: { where?: { cid?: string } }) => {
        if (where?.cid) return hostServes.filter((s) => s.cid === where.cid).length;
        return hostServes.length;
      },
      findMany: async ({ where }: { where?: { cid?: string } }) => {
        if (where?.cid) return hostServes.filter((s) => s.cid === where.cid);
        return hostServes;
      },
    },
    protocolEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const existing = protocolEvents.find((e) => e.eventId === data.eventId);
        if (existing) throw new Error("Unique constraint failed on the fields: (`event_id`)");
        const record = {
          id: peSeq++,
          eventId: data.eventId as string,
          kind: data.kind as number,
          from: data.from as string,
          ref: data.ref as string,
          body: (data.body as string) ?? "",
          sats: (data.sats as number) ?? 0,
          ts: data.ts as bigint,
          sig: data.sig as string,
          createdAt: new Date(),
        };
        protocolEvents.push(record);
        return record;
      },
      findMany: async ({ where, orderBy, take, skip, select: _select }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, string>;
        take?: number;
        skip?: number;
        select?: Record<string, boolean>;
      }) => {
        let results = [...protocolEvents];

        // Filter
        if (where) {
          if (where.ref !== undefined) {
            if (typeof where.ref === "string") {
              results = results.filter((e) => e.ref === where.ref);
            } else if (typeof where.ref === "object" && "in" in (where.ref as Record<string, unknown>)) {
              const refIn = (where.ref as { in: string[] }).in;
              results = results.filter((e) => refIn.includes(e.ref));
            }
          }
          if (where.kind !== undefined) {
            results = results.filter((e) => e.kind === where.kind);
          }
          if (where.from !== undefined) {
            results = results.filter((e) => e.from === where.from);
          }
          if (where.ts && typeof where.ts === "object" && "gte" in (where.ts as Record<string, unknown>)) {
            const gte = (where.ts as { gte: bigint }).gte;
            results = results.filter((e) => e.ts >= gte);
          }
        }

        // Sort
        if (orderBy) {
          const key = Object.keys(orderBy)[0]!;
          const dir = orderBy[key];
          results.sort((a, b) => {
            const aVal = a[key as keyof typeof a];
            const bVal = b[key as keyof typeof b];
            if (typeof aVal === "bigint" && typeof bVal === "bigint") {
              return dir === "desc" ? Number(bVal - aVal) : Number(aVal - bVal);
            }
            return dir === "desc" ? Number(bVal as number) - Number(aVal as number) : Number(aVal as number) - Number(bVal as number);
          });
        }

        // Pagination
        if (skip) results = results.slice(skip);
        if (take) results = results.slice(0, take);

        return results;
      },
      findFirst: async ({ where, orderBy }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, string>;
      }) => {
        let results = [...protocolEvents];
        if (where) {
          if (where.ref !== undefined) results = results.filter((e) => e.ref === where.ref);
          if (where.kind !== undefined) results = results.filter((e) => e.kind === where.kind);
        }
        if (orderBy) {
          const key = Object.keys(orderBy)[0]!;
          const dir = orderBy[key];
          results.sort((a, b) => {
            const aVal = a[key as keyof typeof a];
            const bVal = b[key as keyof typeof b];
            if (typeof aVal === "bigint" && typeof bVal === "bigint") {
              return dir === "desc" ? Number(bVal - aVal) : Number(aVal - bVal);
            }
            return 0;
          });
        }
        return results[0] ?? null;
      },
      findUnique: async ({ where }: { where: { eventId: string } }) => {
        return protocolEvents.find((e) => e.eventId === where.eventId) ?? null;
      },
    },
    event: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        seq: eventSeq++,
        ...data,
        createdAt: new Date(),
      }),
      count: async () => eventSeq - 1,
    },
    $disconnect: async () => {},
  } as unknown;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("POST /event + ProtocolEvent storage", () => {
  it("stores event in ProtocolEvent table and returns event_id", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const { res, eventId } = await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "bb".repeat(32),
      body: encodeEventBody({ title: "Test Doc" }),
      sats: 0,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.event_id).toBe(eventId);

    // Verify it was stored in protocolEvent
    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;
    expect(mock._protocolEvents).toHaveLength(1);
    expect(mock._protocolEvents[0]!.eventId).toBe(eventId);
    expect(mock._protocolEvents[0]!.kind).toBe(EVENT_KIND_ANNOUNCE);
  });

  it("FUND event credits pool and stores in ProtocolEvent", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const { res } = await postEvent(app, clientKey, {
      kind: EVENT_KIND_FUND,
      ref: "cc".repeat(32),
      sats: 1000,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pool_credit).toBeGreaterThan(0);
    expect(body.protocol_fee).toBeGreaterThan(0);

    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;
    expect(mock._protocolEvents).toHaveLength(1);
    expect(mock._pools.has("cc".repeat(32))).toBe(true);
  });

  it("duplicate event_id is silently ignored", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const ts = Date.now();
    await postEvent(app, clientKey, { kind: EVENT_KIND_FUND, ts, ref: "dd".repeat(32) });
    // Same event (same content → same event_id) should not error
    await postEvent(app, clientKey, { kind: EVENT_KIND_FUND, ts, ref: "dd".repeat(32) });

    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;
    // Only 1 stored (second was deduplicated)
    expect(mock._protocolEvents).toHaveLength(1);
  });
});

describe("GET /events", () => {
  it("returns all events when no filters", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    await postEvent(app, clientKey, { kind: EVENT_KIND_ANNOUNCE, ref: "aa".repeat(32), ts: 1000 });
    await postEvent(app, clientKey, { kind: EVENT_KIND_FUND, ref: "bb".repeat(32), ts: 2000 });

    const res = await app.inject({ method: "GET", url: "/events" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    // Newest first
    expect(body.events[0].ts).toBeGreaterThanOrEqual(body.events[1].ts);
  });

  it("filters by ref", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });
    const ref = "aa".repeat(32);

    await postEvent(app, clientKey, { kind: EVENT_KIND_ANNOUNCE, ref, ts: 1000 });
    await postEvent(app, clientKey, { kind: EVENT_KIND_FUND, ref: "bb".repeat(32), ts: 2000 });

    const res = await app.inject({ method: "GET", url: `/events?ref=${ref}` });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].ref).toBe(ref);
  });

  it("filters by kind", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    await postEvent(app, clientKey, { kind: EVENT_KIND_ANNOUNCE, ref: "aa".repeat(32), ts: 1000 });
    await postEvent(app, clientKey, { kind: EVENT_KIND_POST, ref: "bb".repeat(32), ts: 2000 });

    const res = await app.inject({ method: "GET", url: `/events?kind=${EVENT_KIND_POST}` });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe(EVENT_KIND_POST);
  });

  it("filters by from (pubkey)", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    await postEvent(app, clientKey, { kind: EVENT_KIND_ANNOUNCE, ref: "aa".repeat(32), ts: 1000 });
    await postEvent(app, otherKey, { kind: EVENT_KIND_ANNOUNCE, ref: "bb".repeat(32), ts: 2000 });

    const res = await app.inject({ method: "GET", url: `/events?from=${otherPubHex}` });
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].from).toBe(otherPubHex);
  });

  it("respects limit and offset", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    for (let i = 0; i < 5; i++) {
      await postEvent(app, clientKey, { kind: EVENT_KIND_POST, ref: "aa".repeat(32), ts: 1000 + i });
    }

    const res = await app.inject({ method: "GET", url: "/events?limit=2&offset=1" });
    const body = res.json();
    expect(body.events).toHaveLength(2);
  });
});

describe("GET /feed/funded", () => {
  it("returns empty when no pools", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({ method: "GET", url: "/feed/funded" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it("returns pools ranked by balance with ANNOUNCE metadata", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });
    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;

    const ref1 = "aa".repeat(32);
    const ref2 = "bb".repeat(32);

    // Seed pools
    mock._pools.set(ref1, { poolKey: ref1, balance: 500n, totalTipped: 500n, lastPayoutEpoch: 0 });
    mock._pools.set(ref2, { poolKey: ref2, balance: 2000n, totalTipped: 2000n, lastPayoutEpoch: 0 });

    // Publish ANNOUNCE event for ref2
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: ref2,
      body: encodeEventBody({ title: "Important Leak", tags: ["legal"] }),
      sats: 0,
    });

    const res = await app.inject({ method: "GET", url: "/feed/funded" });
    const body = res.json();

    expect(body.items).toHaveLength(2);
    // ref2 has higher balance, should be first
    expect(body.items[0].pool_key).toBe(ref2);
    expect(body.items[0].balance).toBe(2000);
    expect(body.items[0].metadata).not.toBeNull();
    expect(body.items[0].metadata.title).toBe("Important Leak");
    expect(body.items[0].metadata.tags).toEqual(["legal"]);

    // ref1 has no ANNOUNCE → metadata is null
    expect(body.items[1].pool_key).toBe(ref1);
    expect(body.items[1].metadata).toBeNull();
  });

  it("respects min_balance filter", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });
    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;

    mock._pools.set("aa".repeat(32), { poolKey: "aa".repeat(32), balance: 50n, totalTipped: 50n, lastPayoutEpoch: 0 });
    mock._pools.set("bb".repeat(32), { poolKey: "bb".repeat(32), balance: 500n, totalTipped: 500n, lastPayoutEpoch: 0 });

    const res = await app.inject({ method: "GET", url: "/feed/funded?min_balance=100" });
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].pool_key).toBe("bb".repeat(32));
  });
});

describe("GET /feed/recent", () => {
  it("returns recent ANNOUNCE events", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "aa".repeat(32),
      body: encodeEventBody({ title: "First Post", tags: ["news"] }),
      ts: 1000,
    });
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "bb".repeat(32),
      body: encodeEventBody({ title: "Second Post", tags: ["legal"] }),
      ts: 2000,
    });
    // A non-ANNOUNCE event — should not appear
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_FUND,
      ref: "cc".repeat(32),
      sats: 100,
      ts: 3000,
    });

    const res = await app.inject({ method: "GET", url: "/feed/recent" });
    const body = res.json();

    expect(body.items).toHaveLength(2);
    // Newest first
    expect(body.items[0].metadata.title).toBe("Second Post");
    expect(body.items[1].metadata.title).toBe("First Post");
  });

  it("filters by tag", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "aa".repeat(32),
      body: encodeEventBody({ title: "News Item", tags: ["news"] }),
      ts: 1000,
    });
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "bb".repeat(32),
      body: encodeEventBody({ title: "Legal Filing", tags: ["legal", "finance"] }),
      ts: 2000,
    });

    const res = await app.inject({ method: "GET", url: "/feed/recent?tag=legal" });
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].metadata.title).toBe("Legal Filing");
  });

  it("respects pagination", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    for (let i = 0; i < 5; i++) {
      await postEvent(app, clientKey, {
        kind: EVENT_KIND_ANNOUNCE,
        ref: `${"a".repeat(62)}${String(i).padStart(2, "0")}`,
        body: encodeEventBody({ title: `Post ${i}` }),
        ts: 1000 + i,
      });
    }

    const res = await app.inject({ method: "GET", url: "/feed/recent?limit=2&offset=0" });
    expect(res.json().items).toHaveLength(2);

    const res2 = await app.inject({ method: "GET", url: "/feed/recent?limit=2&offset=2" });
    expect(res2.json().items).toHaveLength(2);
  });
});

describe("GET /thread/:event_id", () => {
  it("returns 404 for unknown event_id", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({ method: "GET", url: `/thread/${"ff".repeat(32)}` });
    expect(res.statusCode).toBe(404);
  });

  it("returns root event with no replies", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const { eventId } = await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "aa".repeat(32),
      body: encodeEventBody({ title: "Root Document" }),
    });

    const res = await app.inject({ method: "GET", url: `/thread/${eventId}` });
    expect(res.statusCode).toBe(200);
    const thread = res.json();
    expect(thread.event_id).toBe(eventId);
    expect(thread.replies).toEqual([]);
  });

  it("returns thread tree with nested replies", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    // Root: ANNOUNCE event
    const { eventId: rootId } = await postEvent(app, clientKey, {
      kind: EVENT_KIND_ANNOUNCE,
      ref: "aa".repeat(32),
      body: encodeEventBody({ title: "Root Document" }),
      ts: 1000,
    });

    // Reply 1: POST referencing root
    const { eventId: reply1Id } = await postEvent(app, otherKey, {
      kind: EVENT_KIND_POST,
      ref: rootId,
      body: encodeEventBody({ text: "First comment" }),
      ts: 2000,
    });

    // Reply 2: POST also referencing root
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_POST,
      ref: rootId,
      body: encodeEventBody({ text: "Second comment" }),
      ts: 3000,
    });

    // Nested reply: POST referencing reply 1
    await postEvent(app, clientKey, {
      kind: EVENT_KIND_POST,
      ref: reply1Id,
      body: encodeEventBody({ text: "Reply to first comment" }),
      ts: 4000,
    });

    const res = await app.inject({ method: "GET", url: `/thread/${rootId}` });
    expect(res.statusCode).toBe(200);
    const thread = res.json();

    expect(thread.event_id).toBe(rootId);
    expect(thread.replies).toHaveLength(2);

    // First reply has a nested reply
    const firstReply = thread.replies.find(
      (r: { event_id: string }) => r.event_id === reply1Id,
    );
    expect(firstReply).toBeDefined();
    expect(firstReply.replies).toHaveLength(1);
    expect(firstReply.replies[0].body.text).toBe("Reply to first comment");

    // Second reply has no children
    const secondReply = thread.replies.find(
      (r: { event_id: string }) => r.event_id !== reply1Id,
    );
    expect(secondReply).toBeDefined();
    expect(secondReply.replies).toEqual([]);
  });

  it("rejects invalid event_id format", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({ method: "GET", url: "/thread/not-hex" });
    expect(res.statusCode).toBe(400);
  });
});
