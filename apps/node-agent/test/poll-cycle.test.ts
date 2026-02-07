/**
 * Node agent poll cycle tests.
 * DocRef: MVP_PLAN:§Node Kit
 *
 * Tests the discover → mirror → announce loop using mock fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { findProfitableTargets, mirrorCid, type BountyFeedResponse } from "../src/mirror.js";

// ── Mock fetch ─────────────────────────────────────────────────────

const CID_1 = "aa".repeat(32);
const CID_2 = "bb".repeat(32);
const BLOCK_BYTES = new Uint8Array([1, 2, 3, 4]);

function createMockFetch(
  feedResponse: BountyFeedResponse,
  blockResponses: Map<string, Uint8Array> = new Map(),
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    // GET /bounty/feed
    if (urlStr.includes("/bounty/feed")) {
      return new Response(JSON.stringify(feedResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // GET /block/:cid (source gateway — fetch for mirroring)
    const blockGetMatch = urlStr.match(/\/block\/([0-9a-f]{64})$/);
    if (blockGetMatch && (!init || init.method === "GET" || !init.method)) {
      const cid = blockGetMatch[1]!;
      const bytes = blockResponses.get(cid);
      if (bytes) {
        return new Response(bytes, { status: 200 });
      }
      return new Response(null, { status: 404 });
    }

    // PUT /block/:cid (local gateway — store mirrored block)
    if (init?.method === "PUT" && urlStr.includes("/block/")) {
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }

    // POST /host/serve (coordinator — announce)
    if (init?.method === "POST" && urlStr.includes("/host/serve")) {
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }

    // POST /host/register
    if (init?.method === "POST" && urlStr.includes("/host/register")) {
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    }

    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("findProfitableTargets", () => {
  it("returns targets from bounty feed", async () => {
    const feed: BountyFeedResponse = {
      feed: [
        {
          cid: CID_1,
          balance: 1000,
          host_count: 2,
          profitability: 500,
          endpoints: ["http://host-a:3100"],
        },
        {
          cid: CID_2,
          balance: 500,
          host_count: 0,
          profitability: 500,
          endpoints: [],
        },
      ],
      timestamp: Date.now(),
    };

    const mockFetch = createMockFetch(feed);
    const targets = await findProfitableTargets(mockFetch);

    // CID_2 filtered out (no endpoints to mirror from)
    expect(targets).toHaveLength(1);
    expect(targets[0]!.cid).toBe(CID_1);
    expect(targets[0]!.bounty).toBe(1000);
    expect(targets[0]!.endpoints).toContain("http://host-a:3100");
  });

  it("returns empty on feed error", async () => {
    const mockFetch = vi.fn(async () =>
      new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;
    const targets = await findProfitableTargets(mockFetch);
    expect(targets).toEqual([]);
  });

  it("returns empty on fetch exception", async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    const targets = await findProfitableTargets(mockFetch);
    expect(targets).toEqual([]);
  });
});

describe("mirrorCid", () => {
  it("fetches block from source and pushes to local gateway", async () => {
    const blockResponses = new Map([[CID_1, BLOCK_BYTES]]);
    const mockFetch = createMockFetch(
      { feed: [], timestamp: 0 },
      blockResponses,
    );

    const ok = await mirrorCid(CID_1, "http://source:3100", mockFetch);
    expect(ok).toBe(true);

    // Verify fetch was called: GET from source, PUT to local
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const calls = mockFetch.mock.calls;
    expect(calls[0]![0]).toContain(`source:3100/block/${CID_1}`);
    expect(calls[1]![0]).toContain(`localhost:3100/block/${CID_1}`);
  });

  it("returns false when source block not found", async () => {
    const mockFetch = createMockFetch({ feed: [], timestamp: 0 });
    const ok = await mirrorCid(CID_1, "http://source:3100", mockFetch);
    expect(ok).toBe(false);
  });

  it("returns false on fetch error", async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const ok = await mirrorCid(CID_1, "http://source:3100", mockFetch);
    expect(ok).toBe(false);
  });
});
