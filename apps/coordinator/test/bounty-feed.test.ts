/**
 * Bounty feed + host serve announcement tests.
 * DocRef: MVP_PLAN:§Node Kit, §Bounty Pool Mechanics
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeypair,
  signEventPayload,
  setGenesisTimestamp,
  EPOCH_LENGTH_MS,
} from "@dupenet/physics";
import { toHex } from "@dupenet/physics";
import { buildApp } from "../src/server.js";

// ── Helpers ────────────────────────────────────────────────────────

let hostKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let hostPubHex: string;
let clientKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let clientPubHex: string;

beforeAll(async () => {
  setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
  hostKey = await generateKeypair();
  hostPubHex = toHex(hostKey.publicKey);
  clientKey = await generateKeypair();
  clientPubHex = toHex(clientKey.publicKey);
});

function createMockPrisma() {
  const pools = new Map<string, { cid: string; balance: bigint; totalTipped: bigint; lastPayoutEpoch: number }>();
  const hosts = new Map<string, Record<string, unknown>>();
  const hostServes: Array<{ hostPubkey: string; cid: string; registeredEpoch: number }> = [];
  let eventSeq = 1;

  return {
    _pools: pools,
    _hostServes: hostServes,
    bountyPool: {
      findMany: async ({ where, orderBy: _orderBy, take: _take }: {
        where?: { balance?: { gte: bigint } };
        orderBy?: Record<string, string>;
        take?: number;
      }) => {
        const minBal = where?.balance?.gte ?? 0n;
        return Array.from(pools.values())
          .filter((p) => p.balance >= minBal)
          .sort((a, b) => Number(b.balance - a.balance));
      },
      findUnique: async ({ where }: { where: { cid: string } }) => {
        return pools.get(where.cid) ?? null;
      },
      upsert: async ({ where, create, update }: {
        where: { cid: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = pools.get(where.cid);
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
          cid: create.cid as string,
          balance: create.balance as bigint,
          totalTipped: create.totalTipped as bigint,
          lastPayoutEpoch: 0,
        };
        pools.set(where.cid, record);
        return record;
      },
    },
    host: {
      findUnique: async ({ where, select: _select }: { where: { pubkey: string }; select?: Record<string, boolean> }) => {
        return hosts.get(where.pubkey) ?? null;
      },
      findMany: async () => Array.from(hosts.values()),
      upsert: async ({ where, create, update: _update }: {
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
      findMany: async ({ where, select: _select }: { where: { cid?: string; hostPubkey?: string }; select?: Record<string, boolean> }) => {
        if (where.cid) return hostServes.filter((s) => s.cid === where.cid);
        if (where.hostPubkey) return hostServes.filter((s) => s.hostPubkey === where.hostPubkey);
        return hostServes;
      },
      upsert: async ({ where: _where, create, update: _update }: {
        where: { hostPubkey_cid: { hostPubkey: string; cid: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = hostServes.find(
          (s) => s.hostPubkey === create.hostPubkey && s.cid === create.cid,
        );
        if (existing) return existing;
        const record = {
          hostPubkey: create.hostPubkey as string,
          cid: create.cid as string,
          registeredEpoch: create.registeredEpoch as number,
        };
        hostServes.push(record);
        return record;
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

describe("GET /bounty/feed", () => {
  it("returns empty feed when no bounty pools", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({ method: "GET", url: "/bounty/feed" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feed).toEqual([]);
  });

  it("returns CIDs above min_balance sorted by profitability", async () => {
    const prisma = createMockPrisma();
    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;

    // Seed bounty pools
    mock._pools.set("aa".repeat(32), {
      cid: "aa".repeat(32),
      balance: 500n,
      totalTipped: 500n,
      lastPayoutEpoch: 0,
    });
    mock._pools.set("bb".repeat(32), {
      cid: "bb".repeat(32),
      balance: 2000n,
      totalTipped: 2000n,
      lastPayoutEpoch: 0,
    });
    mock._pools.set("cc".repeat(32), {
      cid: "cc".repeat(32),
      balance: 50n, // below default min_balance=100
      totalTipped: 50n,
      lastPayoutEpoch: 0,
    });

    const app = await buildApp({ prisma: prisma as never });
    const res = await app.inject({ method: "GET", url: "/bounty/feed" });
    const body = res.json();

    expect(body.feed).toHaveLength(2); // cc filtered out (below 100)
    // bb (2000) should be first (higher profitability)
    expect(body.feed[0].cid).toBe("bb".repeat(32));
    expect(body.feed[0].balance).toBe(2000);
    expect(body.feed[1].cid).toBe("aa".repeat(32));
  });

  it("includes host endpoints for served CIDs", async () => {
    const prisma = createMockPrisma();
    const mock = prisma as unknown as ReturnType<typeof createMockPrisma>;
    const CID = "dd".repeat(32);

    mock._pools.set(CID, { cid: CID, balance: 1000n, totalTipped: 1000n, lastPayoutEpoch: 0 });

    // Register host first (needed for host/serve later)
    const app = await buildApp({ prisma: prisma as never });
    const regPayload = {
      pubkey: hostPubHex,
      endpoint: "http://myhost:3100",
      pricing: { min_request_sats: 3, sats_per_gb: 500 },
    };
    const regSig = await signEventPayload(hostKey.privateKey, regPayload);
    await app.inject({
      method: "POST",
      url: "/host/register",
      payload: { ...regPayload, sig: regSig },
    });

    // Make host TRUSTED so it appears in feed endpoints
    const hostRecord = (mock as any)._pools; // just for the host
    // We need to set the host status to TRUSTED
    const hosts = await (prisma as any).host.findMany();
    if (hosts[0]) hosts[0].status = "TRUSTED";

    // Announce serve
    const servePayload = { pubkey: hostPubHex, cid: CID };
    const serveSig = await signEventPayload(hostKey.privateKey, servePayload);
    await app.inject({
      method: "POST",
      url: "/host/serve",
      payload: { ...servePayload, sig: serveSig },
    });

    const res = await app.inject({ method: "GET", url: "/bounty/feed" });
    const body = res.json();

    expect(body.feed).toHaveLength(1);
    expect(body.feed[0].host_count).toBe(1);
    expect(body.feed[0].endpoints).toContain("http://myhost:3100");
  });
});

describe("POST /host/serve", () => {
  it("registers a serve announcement with valid signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    // Register host first
    const regPayload = {
      pubkey: hostPubHex,
      endpoint: "http://myhost:3100",
      pricing: { min_request_sats: 3, sats_per_gb: 500 },
    };
    const regSig = await signEventPayload(hostKey.privateKey, regPayload);
    await app.inject({
      method: "POST",
      url: "/host/register",
      payload: { ...regPayload, sig: regSig },
    });

    // Announce serve
    const CID = "ee".repeat(32);
    const servePayload = { pubkey: hostPubHex, cid: CID };
    const sig = await signEventPayload(hostKey.privateKey, servePayload);

    const res = await app.inject({
      method: "POST",
      url: "/host/serve",
      payload: { ...servePayload, sig },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
    expect(res.json().cid).toBe(CID);
  });

  it("rejects serve with invalid signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    // Register host
    const regPayload = {
      pubkey: hostPubHex,
      endpoint: "http://myhost:3100",
      pricing: { min_request_sats: 3, sats_per_gb: 500 },
    };
    const regSig = await signEventPayload(hostKey.privateKey, regPayload);
    await app.inject({
      method: "POST",
      url: "/host/register",
      payload: { ...regPayload, sig: regSig },
    });

    const res = await app.inject({
      method: "POST",
      url: "/host/serve",
      payload: { pubkey: hostPubHex, cid: "ff".repeat(32), sig: "bad" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects serve for non-existent host", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const servePayload = { pubkey: hostPubHex, cid: "ff".repeat(32) };
    const sig = await signEventPayload(hostKey.privateKey, servePayload);

    const res = await app.inject({
      method: "POST",
      url: "/host/serve",
      payload: { ...servePayload, sig },
    });

    expect(res.statusCode).toBe(404);
  });
});
