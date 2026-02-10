/**
 * Event signature enforcement tests.
 * DocRef: MVP_PLAN:§Longevity L4 (signed events)
 *
 * Tests that POST /tip and POST /host/register reject unsigned
 * or incorrectly signed requests.
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

let clientKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let clientPubHex: string;

beforeAll(async () => {
  setGenesisTimestamp(Date.now() - EPOCH_LENGTH_MS * 10);
  clientKey = await generateKeypair();
  clientPubHex = toHex(clientKey.publicKey);
});

// We need a mock PrismaClient for the coordinator routes
function createMockPrisma() {
  const pools = new Map<string, { cid: string; balance: bigint; totalTipped: bigint }>();
  const hosts = new Map<string, Record<string, unknown>>();
  let eventSeq = 1;

  return {
    bountyPool: {
      aggregate: async () => {
        let total = 0n;
        for (const p of pools.values()) total += p.totalTipped;
        return { _sum: { totalTipped: total } };
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
        };
        pools.set(where.poolKey, record);
        return record;
      },
    },
    host: {
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
          status: create.status,
          minRequestSats: create.minRequestSats,
          satsPerGb: create.satsPerGb,
          availabilityScore: create.availabilityScore,
          registeredEpoch: create.registeredEpoch,
          unbondEpoch: null,
        };
        hosts.set(where.pubkey, record);
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

describe("POST /tip signature verification", () => {
  it("accepts a properly signed tip", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const tipPayload = {
      cid: "aa".repeat(32),
      amount: 100,
      payment_proof: "bb".repeat(32),
    };

    const sig = await signEventPayload(clientKey.privateKey, tipPayload);

    const res = await app.inject({
      method: "POST",
      url: "/tip",
      payload: {
        ...tipPayload,
        from: clientPubHex,
        sig,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.pool_credit).toBeGreaterThan(0);
  });

  it("rejects tip with wrong signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const tipPayload = {
      cid: "aa".repeat(32),
      amount: 100,
      payment_proof: "bb".repeat(32),
    };

    // Sign with correct key but tamper the amount
    const sig = await signEventPayload(clientKey.privateKey, {
      ...tipPayload,
      amount: 999, // different amount
    });

    const res = await app.inject({
      method: "POST",
      url: "/tip",
      payload: {
        ...tipPayload,
        from: clientPubHex,
        sig,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("rejects tip with missing signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({
      method: "POST",
      url: "/tip",
      payload: {
        cid: "aa".repeat(32),
        amount: 100,
        payment_proof: "bb".repeat(32),
        from: clientPubHex,
        sig: "",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects tip signed by different key", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const otherKey = await generateKeypair();
    const tipPayload = {
      cid: "aa".repeat(32),
      amount: 100,
      payment_proof: "bb".repeat(32),
    };

    // Sign with otherKey but claim to be clientPubHex
    const sig = await signEventPayload(otherKey.privateKey, tipPayload);

    const res = await app.inject({
      method: "POST",
      url: "/tip",
      payload: {
        ...tipPayload,
        from: clientPubHex,
        sig,
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /host/register signature verification", () => {
  it("accepts a properly signed registration", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const regPayload = {
      pubkey: clientPubHex,
      endpoint: "http://myhost:3100",
      pricing: { min_request_sats: 3, sats_per_gb: 500 },
    };

    const sig = await signEventPayload(clientKey.privateKey, regPayload);

    const res = await app.inject({
      method: "POST",
      url: "/host/register",
      payload: { ...regPayload, sig },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
  });

  it("rejects registration with wrong signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const regPayload = {
      pubkey: clientPubHex,
      endpoint: "http://myhost:3100",
      pricing: { min_request_sats: 3, sats_per_gb: 500 },
    };

    // Sign a different payload
    const sig = await signEventPayload(clientKey.privateKey, { wrong: true });

    const res = await app.inject({
      method: "POST",
      url: "/host/register",
      payload: { ...regPayload, sig },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("rejects registration with empty signature", async () => {
    const prisma = createMockPrisma();
    const app = await buildApp({ prisma: prisma as never });

    const res = await app.inject({
      method: "POST",
      url: "/host/register",
      payload: {
        pubkey: clientPubHex,
        endpoint: "http://myhost:3100",
        pricing: { min_request_sats: 3, sats_per_gb: 500 },
        sig: "",
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
