/**
 * Materializer views — queryable event state.
 * DocRef: MVP_PLAN:§Signal Aggregation, §Protocol vs Materializer Boundary
 *
 * These are product features built over the EventV1 stream. Not protocol.
 * Other materializers may offer different views from the same event log.
 *
 * Functions:
 *   storeProtocolEvent()  — persist an EventV1 to the indexed ProtocolEvent table
 *   queryEvents()         — generic event query (by ref, kind, from, since)
 *   feedFunded()          — pool keys ranked by balance, enriched with ANNOUNCE metadata
 *   feedRecent()          — recent ANNOUNCE events, paginated
 *   getThread()           — resolve ref-chain from POST events into a tree
 */

import type { PrismaClient } from "@prisma/client";
import {
  EVENT_KIND_ANNOUNCE,
  EVENT_KIND_POST,
  decodeEventBody,
} from "@dupenet/physics";

// ── Types ──────────────────────────────────────────────────────────

export interface ProtocolEventRecord {
  event_id: string;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
  sig: string;
}

export interface FundedItem {
  pool_key: string;
  balance: number;
  host_count: number;
  /** Metadata from the most recent ANNOUNCE event referencing this pool key. */
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    mime?: string;
    access?: string;
    announced_by?: string;
  } | null;
}

export interface ThreadNode {
  event_id: string;
  from: string;
  ref: string;
  body: unknown;
  sats: number;
  ts: number;
  replies: ThreadNode[];
}

// ── Store ──────────────────────────────────────────────────────────

/**
 * Persist an EventV1 to the indexed ProtocolEvent table.
 * Idempotent: duplicate event_ids are silently ignored.
 */
export async function storeProtocolEvent(
  prisma: PrismaClient,
  event: {
    eventId: string;
    kind: number;
    from: string;
    ref: string;
    body: string;
    sats: number;
    ts: number;
    sig: string;
  },
): Promise<void> {
  try {
    await prisma.protocolEvent.create({
      data: {
        eventId: event.eventId,
        kind: event.kind,
        from: event.from,
        ref: event.ref,
        body: event.body,
        sats: event.sats,
        ts: BigInt(event.ts),
        sig: event.sig,
      },
    });
  } catch (err: unknown) {
    // Duplicate event_id — idempotent, skip silently
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return;
    }
    throw err;
  }
}

// ── Query Events ───────────────────────────────────────────────────

export interface QueryEventsParams {
  ref?: string;
  kind?: number;
  from?: string;
  since?: number;
  limit?: number;
  offset?: number;
}

/**
 * Generic event query. All filters are optional (AND-combined).
 * Returns events ordered by timestamp descending (newest first).
 */
export async function queryEvents(
  prisma: PrismaClient,
  params: QueryEventsParams,
): Promise<ProtocolEventRecord[]> {
  const where: Record<string, unknown> = {};
  if (params.ref) where.ref = params.ref;
  if (params.kind !== undefined) where.kind = params.kind;
  if (params.from) where.from = params.from;
  if (params.since !== undefined) where.ts = { gte: BigInt(params.since) };

  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const rows = await prisma.protocolEvent.findMany({
    where,
    orderBy: { ts: "desc" },
    take: limit,
    skip: offset,
  });

  return rows.map(toRecord);
}

// ── Feed: Funded ───────────────────────────────────────────────────

/**
 * Pool keys ranked by balance, enriched with ANNOUNCE event metadata.
 * This replaces GET /bounty/feed with event-aware metadata.
 */
export async function feedFunded(
  prisma: PrismaClient,
  opts: { minBalance?: number; limit?: number } = {},
): Promise<FundedItem[]> {
  const minBal = opts.minBalance ?? 0;
  const limit = Math.min(opts.limit ?? 50, 200);

  // Get top pools by balance
  const pools = await prisma.bountyPool.findMany({
    where: { balance: { gte: BigInt(minBal) } },
    orderBy: { balance: "desc" },
    take: limit,
  });

  const items: FundedItem[] = [];

  for (const pool of pools) {
    // Count hosts serving this pool key
    const hostCount = await prisma.hostServe.count({
      where: { cid: pool.poolKey },
    });

    // Find the most recent ANNOUNCE event for this pool key
    const announce = await prisma.protocolEvent.findFirst({
      where: { ref: pool.poolKey, kind: EVENT_KIND_ANNOUNCE },
      orderBy: { ts: "desc" },
    });

    let metadata: FundedItem["metadata"] = null;
    if (announce) {
      try {
        const decoded = decodeEventBody(announce.body) as Record<string, unknown>;
        metadata = {
          title: decoded.title as string | undefined,
          description: decoded.description as string | undefined,
          tags: decoded.tags as string[] | undefined,
          mime: decoded.mime as string | undefined,
          access: decoded.access as string | undefined,
          announced_by: announce.from,
        };
      } catch {
        // Body decode failure — metadata stays null
      }
    }

    items.push({
      pool_key: pool.poolKey,
      balance: Number(pool.balance),
      host_count: hostCount,
      metadata,
    });
  }

  return items;
}

// ── Feed: Recent ───────────────────────────────────────────────────

export interface RecentItem {
  event_id: string;
  from: string;
  ref: string;
  sats: number;
  ts: number;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    mime?: string;
    size?: number;
    access?: string;
  };
}

/**
 * Recent ANNOUNCE events, paginated.
 * The content discovery feed — what's been published recently.
 */
export async function feedRecent(
  prisma: PrismaClient,
  opts: { limit?: number; offset?: number; tag?: string } = {},
): Promise<RecentItem[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const rows = await prisma.protocolEvent.findMany({
    where: { kind: EVENT_KIND_ANNOUNCE },
    orderBy: { ts: "desc" },
    take: limit,
    skip: offset,
  });

  const items: RecentItem[] = [];
  for (const row of rows) {
    let decoded: Record<string, unknown> = {};
    try {
      decoded = decodeEventBody(row.body) as Record<string, unknown>;
    } catch {
      // Skip malformed bodies
    }

    // Tag filter (post-query — acceptable for MVP volume)
    if (opts.tag) {
      const tags = (decoded.tags as string[] | undefined) ?? [];
      if (!tags.includes(opts.tag)) continue;
    }

    items.push({
      event_id: row.eventId,
      from: row.from,
      ref: row.ref,
      sats: row.sats,
      ts: Number(row.ts),
      metadata: {
        title: decoded.title as string | undefined,
        description: decoded.description as string | undefined,
        tags: decoded.tags as string[] | undefined,
        mime: decoded.mime as string | undefined,
        size: decoded.size as number | undefined,
        access: decoded.access as string | undefined,
      },
    });
  }

  return items;
}

// ── Thread ─────────────────────────────────────────────────────────

/**
 * Resolve a thread tree from POST events.
 * The root is the event_id passed in. Replies are events whose ref = root or descendants.
 *
 * Strategy: fetch all POST events whose ref is in the thread ancestry,
 * then build the tree in memory. Depth-limited to prevent abuse.
 */
export async function getThread(
  prisma: PrismaClient,
  rootEventId: string,
  opts: { maxDepth?: number; limit?: number } = {},
): Promise<ThreadNode | null> {
  const maxDepth = opts.maxDepth ?? 10;
  const limit = Math.min(opts.limit ?? 200, 500);

  // 1. Find the root event (any kind — could be ANNOUNCE, POST, FUND, etc.)
  const root = await prisma.protocolEvent.findUnique({
    where: { eventId: rootEventId },
  });
  if (!root) return null;

  // 2. Fetch all POST replies referencing this event_id (direct children)
  //    Then recursively fetch their children up to maxDepth.
  //    For MVP: collect all POST events, build tree in memory.
  const allReplies = await collectReplies(prisma, [rootEventId], maxDepth, limit);

  // 3. Build tree
  const rootNode: ThreadNode = {
    event_id: root.eventId,
    from: root.from,
    ref: root.ref,
    body: safeDecodeBody(root.body),
    sats: root.sats,
    ts: Number(root.ts),
    replies: [],
  };

  // Index all reply nodes by event_id
  const nodeMap = new Map<string, ThreadNode>();
  nodeMap.set(rootNode.event_id, rootNode);

  for (const reply of allReplies) {
    const node: ThreadNode = {
      event_id: reply.eventId,
      from: reply.from,
      ref: reply.ref,
      body: safeDecodeBody(reply.body),
      sats: reply.sats,
      ts: Number(reply.ts),
      replies: [],
    };
    nodeMap.set(node.event_id, node);
  }

  // Attach children to parents
  for (const reply of allReplies) {
    const parent = nodeMap.get(reply.ref);
    const child = nodeMap.get(reply.eventId);
    if (parent && child) {
      parent.replies.push(child);
    }
  }

  // Sort replies by timestamp (oldest first for thread reading order)
  sortReplies(rootNode);

  return rootNode;
}

/**
 * Recursively collect POST events that reply to the given parent event_ids.
 */
async function collectReplies(
  prisma: PrismaClient,
  parentIds: string[],
  remainingDepth: number,
  remainingLimit: number,
): Promise<Array<{
  eventId: string;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: bigint;
}>> {
  if (remainingDepth <= 0 || remainingLimit <= 0 || parentIds.length === 0) {
    return [];
  }

  const replies = await prisma.protocolEvent.findMany({
    where: {
      kind: EVENT_KIND_POST,
      ref: { in: parentIds },
    },
    orderBy: { ts: "asc" },
    take: remainingLimit,
    select: {
      eventId: true,
      from: true,
      ref: true,
      body: true,
      sats: true,
      ts: true,
    },
  });

  if (replies.length === 0) return replies;

  // Recurse for the next depth level
  const childIds = replies.map((r) => r.eventId);
  const deeper = await collectReplies(
    prisma,
    childIds,
    remainingDepth - 1,
    remainingLimit - replies.length,
  );

  return [...replies, ...deeper];
}

function sortReplies(node: ThreadNode): void {
  node.replies.sort((a, b) => a.ts - b.ts);
  for (const child of node.replies) {
    sortReplies(child);
  }
}

function safeDecodeBody(bodyHex: string): unknown {
  try {
    return decodeEventBody(bodyHex);
  } catch {
    return {};
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function toRecord(row: {
  eventId: string;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: bigint;
  sig: string;
}): ProtocolEventRecord {
  return {
    event_id: row.eventId,
    kind: row.kind,
    from: row.from,
    ref: row.ref,
    body: row.body,
    sats: row.sats,
    ts: Number(row.ts),
    sig: row.sig,
  };
}
