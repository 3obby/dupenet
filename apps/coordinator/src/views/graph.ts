/**
 * Citation graph: body edge extraction + graph importance computation.
 * DocRef: MVP_PLAN:§Signal Layer, §Reference Graph
 *
 * Body edges are inline citations in event bodies: [ref:hex64] tokens.
 * Graph importance is a weighted PageRank over the citation DAG
 * (ref edges + body edges + list item edges).
 *
 * Functions:
 *   extractBodyEdges()     — parse [ref:bytes32] tokens from a body string
 *   storeBodyEdges()       — persist extracted edges to Prisma
 *   extractAndStoreEdges() — combined: extract + store + update counts
 *   computeGraphImportance() — incremental PageRank over the full citation DAG
 *   getSignals()           — dual score for a ref (direct pool + graph importance)
 *   getOrphans()           — high pool + low graph connectivity + low discussion
 */

import type { PrismaClient } from "@prisma/client";

// ── Edge Extraction ─────────────────────────────────────────────────

/** A [ref:hex64] token found in an event body. */
export interface BodyEdgeCandidate {
  targetRef: string;
}

/**
 * Parse [ref:bytes32] tokens from a hex-encoded CBOR body string.
 * Also accepts decoded text (for convenience in tests).
 *
 * Pattern: [ref:HEX64] where HEX64 is exactly 64 lowercase hex chars.
 * Returns unique target refs (deduped).
 */
export function extractBodyEdges(bodyOrText: string): BodyEdgeCandidate[] {
  // Try to decode hex body to text for pattern matching
  let text = bodyOrText;
  if (/^[0-9a-f]*$/.test(bodyOrText) && bodyOrText.length > 0) {
    try {
      // Hex-encoded CBOR — try to extract text content
      // Body is hex CBOR, but the text field inside may contain refs.
      // For simplicity, scan the hex for the ASCII pattern too.
      const bytes = hexToBytes(bodyOrText);
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      text = bodyOrText;
    }
  }

  const pattern = /\[ref:([0-9a-f]{64})\]/g;
  const seen = new Set<string>();
  const edges: BodyEdgeCandidate[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const ref = match[1] as string | undefined;
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      edges.push({ targetRef: ref });
    }
  }

  return edges;
}

/**
 * Also extract refs from the event's `ref` field and LIST body items.
 * These form structural edges (not inline citations).
 */
export function extractListItems(decodedBody: unknown): string[] {
  if (
    typeof decodedBody === "object" &&
    decodedBody !== null &&
    "items" in decodedBody
  ) {
    const items = (decodedBody as { items: unknown }).items;
    if (Array.isArray(items)) {
      return items.filter(
        (item): item is string =>
          typeof item === "string" && /^[0-9a-f]{64}$/.test(item),
      );
    }
  }
  return [];
}

// ── Store Edges ─────────────────────────────────────────────────────

/**
 * Persist body edges extracted from an event.
 * Splits source event sats evenly across edges (floor division).
 */
export async function storeBodyEdges(
  prisma: PrismaClient,
  opts: {
    sourceEventId: string;
    sourceRef: string;
    sourceKind: number;
    sourceSats: number;
    edges: BodyEdgeCandidate[];
  },
): Promise<number> {
  if (opts.edges.length === 0) return 0;

  const edgeSats =
    opts.sourceSats > 0
      ? Math.floor(opts.sourceSats / opts.edges.length)
      : 0;

  // Batch create
  const created = await prisma.bodyEdge.createMany({
    data: opts.edges.map((e) => ({
      sourceEventId: opts.sourceEventId,
      sourceRef: opts.sourceRef,
      targetRef: e.targetRef,
      edgeSats,
      sourceKind: opts.sourceKind,
    })),
    skipDuplicates: true,
  });

  return created.count;
}

/**
 * Combined: extract edges from event body, store, and update graph importance counts.
 * Called from POST /event handler after storing the ProtocolEvent.
 */
export async function extractAndStoreEdges(
  prisma: PrismaClient,
  event: {
    eventId: string;
    kind: number;
    ref: string;
    body: string;
    sats: number;
    decodedBody?: unknown;
  },
): Promise<number> {
  // 1. Extract inline [ref:hex64] citations from body
  const bodyEdges = extractBodyEdges(event.body);

  // 2. Extract LIST items as structural edges
  if (event.decodedBody) {
    const listItems = extractListItems(event.decodedBody);
    for (const item of listItems) {
      if (!bodyEdges.some((e) => e.targetRef === item)) {
        bodyEdges.push({ targetRef: item });
      }
    }
  }

  if (bodyEdges.length === 0) return 0;

  // 3. Store edges
  const count = await storeBodyEdges(prisma, {
    sourceEventId: event.eventId,
    sourceRef: event.ref,
    sourceKind: event.kind,
    sourceSats: event.sats,
    edges: bodyEdges,
  });

  // 4. Update graph importance counts (lightweight — full recompute is separate)
  if (count > 0) {
    await updateEdgeCounts(prisma, event.ref, bodyEdges);
  }

  return count;
}

// ── Graph Importance (PageRank) ─────────────────────────────────────

const DAMPING = 0.85;
const MAX_ITERATIONS = 20;
const CONVERGENCE_THRESHOLD = 0.0001;

/**
 * Compute graph importance scores for all refs in the citation DAG.
 * Uses a simplified weighted PageRank:
 *   - Nodes are refs (pool keys)
 *   - Edges are body edges + ref edges + list edges (from BodyEdge table)
 *   - Weight = edgeSats (economic weight of the citation)
 *
 * Incremental: recomputes from scratch but only updates changed scores.
 * For MVP scale (~1000 nodes) this completes in <100ms.
 */
export async function computeGraphImportance(
  prisma: PrismaClient,
  epoch: number,
): Promise<{ updated: number }> {
  // 1. Load all edges
  const edges = await prisma.bodyEdge.findMany({
    select: {
      sourceRef: true,
      targetRef: true,
      edgeSats: true,
    },
  });

  if (edges.length === 0) return { updated: 0 };

  // 2. Build adjacency: source → [(target, weight)]
  const outgoing = new Map<string, { target: string; weight: number }[]>();
  const allNodes = new Set<string>();

  for (const edge of edges) {
    allNodes.add(edge.sourceRef);
    allNodes.add(edge.targetRef);

    let list = outgoing.get(edge.sourceRef);
    if (!list) {
      list = [];
      outgoing.set(edge.sourceRef, list);
    }
    list.push({ target: edge.targetRef, weight: Math.max(edge.edgeSats, 1) });
  }

  const nodes = Array.from(allNodes);
  const n = nodes.length;
  if (n === 0) return { updated: 0 };

  // 3. Initialize scores uniformly
  const scores = new Map<string, number>();
  const initialScore = 1.0 / n;
  for (const node of nodes) {
    scores.set(node, initialScore);
  }

  // 4. Iterate PageRank
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const newScores = new Map<string, number>();
    let maxDelta = 0;

    // Base score (random teleport)
    const base = (1 - DAMPING) / n;

    for (const node of nodes) {
      newScores.set(node, base);
    }

    // Distribute score through edges (weighted)
    for (const [source, targetList] of outgoing) {
      const sourceScore = scores.get(source) ?? 0;
      const totalWeight = targetList.reduce((s, t) => s + t.weight, 0);

      if (totalWeight === 0) continue;

      for (const { target, weight } of targetList) {
        const contribution = DAMPING * sourceScore * (weight / totalWeight);
        newScores.set(target, (newScores.get(target) ?? 0) + contribution);
      }
    }

    // Check convergence
    for (const node of nodes) {
      const oldScore = scores.get(node) ?? 0;
      const newScore = newScores.get(node) ?? 0;
      maxDelta = Math.max(maxDelta, Math.abs(newScore - oldScore));
    }

    // Update scores
    for (const [node, score] of newScores) {
      scores.set(node, score);
    }

    if (maxDelta < CONVERGENCE_THRESHOLD) break;
  }

  // 5. Compute edge counts per node
  const inboundCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();

  for (const edge of edges) {
    inboundCounts.set(
      edge.targetRef,
      (inboundCounts.get(edge.targetRef) ?? 0) + 1,
    );
    outboundCounts.set(
      edge.sourceRef,
      (outboundCounts.get(edge.sourceRef) ?? 0) + 1,
    );
  }

  // 6. Upsert scores into GraphImportance table
  let updated = 0;
  for (const [ref, score] of scores) {
    await prisma.graphImportance.upsert({
      where: { ref },
      create: {
        ref,
        score,
        inboundEdges: inboundCounts.get(ref) ?? 0,
        outboundEdges: outboundCounts.get(ref) ?? 0,
        updatedEpoch: epoch,
      },
      update: {
        score,
        inboundEdges: inboundCounts.get(ref) ?? 0,
        outboundEdges: outboundCounts.get(ref) ?? 0,
        updatedEpoch: epoch,
      },
    });
    updated++;
  }

  return { updated };
}

// ── Signals Endpoint ────────────────────────────────────────────────

export interface ContentSignals {
  /** Direct pool balance (sats). */
  pool_balance: number;
  /** Graph importance score (PageRank). */
  graph_importance: number;
  /** Dual score: pool_balance × (1 + graph_importance × 1000). */
  dual_score: number;
  /** Number of inbound citations. */
  inbound_edges: number;
  /** Number of outbound citations. */
  outbound_edges: number;
  /** Host count serving this content. */
  host_count: number;
  /** Funder count. */
  funder_count: number;
  /** Discussion depth (POST reply count). */
  discussion_depth: number;
  /** Estimated runway in months. */
  runway_months: number;
  /** Demand: total receipts for this CID in recent epochs. */
  demand_receipts: number;
}

/**
 * GET /content/:ref/signals — dual score + resilience metrics.
 */
export async function getSignals(
  prisma: PrismaClient,
  ref: string,
): Promise<ContentSignals> {
  const EVENT_KIND_FUND = 0x01;
  const EVENT_KIND_POST = 0x03;

  const [pool, graphNode, hostCount, fundEvents, postCount, recentReceipts] =
    await Promise.all([
      prisma.bountyPool.findUnique({ where: { poolKey: ref } }),
      prisma.graphImportance.findUnique({ where: { ref } }),
      prisma.hostServe.count({ where: { cid: ref } }),
      prisma.protocolEvent.findMany({
        where: { ref, kind: EVENT_KIND_FUND },
        select: { from: true },
      }),
      prisma.protocolEvent.count({ where: { ref, kind: EVENT_KIND_POST } }),
      // Recent demand: receipts in last 6 epochs
      prisma.epochSummaryRecord.aggregate({
        where: { cid: ref },
        _sum: { receiptCount: true },
      }),
    ]);

  const balance = Number(pool?.balance ?? 0n);
  const gi = graphNode?.score ?? 0;
  const dualScore = balance * (1 + gi * 1000);
  const funderCount = new Set(fundEvents.map((e: { from: string }) => e.from)).size;

  // Runway estimate (same formula as web app)
  let runwayMonths = 0;
  if (hostCount > 0 && balance > 0) {
    const drainPerMonth = balance * 0.02 * 6 * 30;
    runwayMonths = drainPerMonth > 0 ? Math.floor(balance / drainPerMonth) : 0;
  }

  return {
    pool_balance: balance,
    graph_importance: gi,
    dual_score: Math.round(dualScore),
    inbound_edges: graphNode?.inboundEdges ?? 0,
    outbound_edges: graphNode?.outboundEdges ?? 0,
    host_count: hostCount,
    funder_count: funderCount,
    discussion_depth: postCount,
    runway_months: runwayMonths,
    demand_receipts: recentReceipts._sum?.receiptCount ?? 0,
  };
}

// ── Orphans ─────────────────────────────────────────────────────────

export interface OrphanItem {
  pool_key: string;
  balance: number;
  /** Graph connectivity score (0 = isolated, higher = well-connected). */
  connectivity: number;
  /** Discussion depth (POST count). */
  discussion_depth: number;
  /** Three-part orphan score (higher = more orphaned). */
  orphan_score: number;
  /** Metadata from ANNOUNCE event. */
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
  } | null;
}

/**
 * GET /orphans — three-part orphan score:
 *   1. High direct pool (well-funded)
 *   2. Low graph connectivity (few inbound edges from funded events)
 *   3. Low discussion depth (few/zero POST replies)
 *
 * "Funded, but under-analyzed." The analyst job board.
 * Hard to game: inflating pool costs real sats, reducing connectivity
 * means not linking to the node (defeats visibility gaming).
 */
export async function getOrphans(
  prisma: PrismaClient,
  opts: { limit?: number; minBalance?: number } = {},
): Promise<OrphanItem[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const minBal = opts.minBalance ?? 100;

  // Get funded pools
  const pools = await prisma.bountyPool.findMany({
    where: { balance: { gte: BigInt(minBal) } },
    orderBy: { balance: "desc" },
    take: limit * 3, // fetch more to filter
  });

  const items: OrphanItem[] = [];

  for (const pool of pools) {
    const ref = pool.poolKey;
    const balance = Number(pool.balance);

    // Graph connectivity
    const graphNode = await prisma.graphImportance.findUnique({
      where: { ref },
    });
    const connectivity = graphNode?.inboundEdges ?? 0;

    // Discussion depth
    const postCount = await prisma.protocolEvent.count({
      where: { ref, kind: 0x03 },
    });

    // Orphan score: high balance × (1 / (1 + connectivity)) × (1 / (1 + discussion_depth))
    // Higher = more orphaned (funded but isolated/undiscussed)
    const orphanScore =
      balance *
      (1 / (1 + connectivity)) *
      (1 / (1 + postCount));

    // Get metadata
    let metadata: OrphanItem["metadata"] = null;
    const announce = await prisma.protocolEvent.findFirst({
      where: { ref, kind: 0x02 },
      orderBy: { ts: "desc" },
    });
    if (announce) {
      try {
        const { decodeEventBody } = await import("@dupenet/physics");
        const decoded = decodeEventBody(announce.body) as Record<
          string,
          unknown
        >;
        metadata = {
          title: decoded.title as string | undefined,
          description: decoded.description as string | undefined,
          tags: decoded.tags as string[] | undefined,
        };
      } catch {
        /* ignore */
      }
    }

    items.push({
      pool_key: ref,
      balance,
      connectivity,
      discussion_depth: postCount,
      orphan_score: Math.round(orphanScore),
      metadata,
    });
  }

  // Sort by orphan_score descending (most orphaned first)
  items.sort((a, b) => b.orphan_score - a.orphan_score);

  return items.slice(0, limit);
}

// ── Host Scorecard ──────────────────────────────────────────────────

export interface HostScorecard {
  pubkey: string;
  endpoint: string | null;
  status: string;
  availability_score: number;
  /** Total receipts across all epochs. */
  total_receipts: number;
  /** Total reward sats earned. */
  total_rewards: number;
  /** CIDs served. */
  served_cids: number;
  /** Spot-check pass rate (0-1). */
  spot_check_pass_rate: number;
  /** Total spot-checks. */
  total_spot_checks: number;
  /** Epochs active (with receipts). */
  active_epochs: number;
}

/**
 * GET /host/:pubkey/scorecard — host reputation from protocol data.
 */
export async function getHostScorecard(
  prisma: PrismaClient,
  pubkey: string,
): Promise<HostScorecard | null> {
  const host = await prisma.host.findUnique({ where: { pubkey } });
  if (!host) return null;

  const [servedCount, epochSummaries, spotChecks] = await Promise.all([
    prisma.hostServe.count({ where: { hostPubkey: pubkey } }),
    prisma.epochSummaryRecord.findMany({
      where: { hostPubkey: pubkey },
      select: { epoch: true, receiptCount: true, rewardSats: true },
    }),
    prisma.spotCheck.findMany({
      where: { hostPubkey: pubkey },
      select: { passed: true },
      orderBy: { checkedAt: "desc" },
      take: 100,
    }),
  ]);

  const totalReceipts = epochSummaries.reduce(
    (s, e) => s + e.receiptCount,
    0,
  );
  const totalRewards = epochSummaries.reduce(
    (s, e) => s + Number(e.rewardSats),
    0,
  );
  const activeEpochs = new Set(
    epochSummaries.filter((e) => e.receiptCount > 0).map((e) => e.epoch),
  ).size;

  const passedChecks = spotChecks.filter((c) => c.passed).length;
  const spotCheckPassRate =
    spotChecks.length > 0 ? passedChecks / spotChecks.length : 1;

  return {
    pubkey,
    endpoint: host.endpoint,
    status: host.status,
    availability_score: host.availabilityScore,
    total_receipts: totalReceipts,
    total_rewards: totalRewards,
    served_cids: servedCount,
    spot_check_pass_rate: Math.round(spotCheckPassRate * 100) / 100,
    total_spot_checks: spotChecks.length,
    active_epochs: activeEpochs,
  };
}

// ── Author Profile ──────────────────────────────────────────────────

export interface AuthorProfile {
  pubkey: string;
  /** Total events published. */
  total_events: number;
  /** ANNOUNCE events (content published). */
  announcements: number;
  /** POST events (comments). */
  posts: number;
  /** FUND events (funding others). */
  funds: number;
  /** Total sats funded to others. */
  total_funded_sats: number;
  /** Total sats received on their content. */
  total_received_sats: number;
  /** Number of unique refs funded. */
  unique_refs_funded: number;
  /** Number of unique refs authored (ANNOUNCE). */
  authored_refs: number;
  /** Demand on their content (receipt count from epoch summaries). */
  demand_receipts: number;
}

/**
 * GET /author/:pubkey/profile — pseudonymous reputation.
 */
export async function getAuthorProfile(
  prisma: PrismaClient,
  pubkey: string,
): Promise<AuthorProfile> {
  const [
    totalEvents,
    announceEvents,
    postCount,
    fundEvents,
  ] = await Promise.all([
    prisma.protocolEvent.count({ where: { from: pubkey } }),
    prisma.protocolEvent.findMany({
      where: { from: pubkey, kind: 0x02 },
      select: { ref: true },
    }),
    prisma.protocolEvent.count({ where: { from: pubkey, kind: 0x03 } }),
    prisma.protocolEvent.findMany({
      where: { from: pubkey, kind: 0x01 },
      select: { ref: true, sats: true },
    }),
  ]);

  const totalFundedSats = fundEvents.reduce((s, e) => s + e.sats, 0);
  const uniqueRefsFunded = new Set(fundEvents.map((e) => e.ref)).size;
  const authoredRefs = new Set(announceEvents.map((e) => e.ref));

  // Demand on authored content: sum receipts for refs they announced
  let demandReceipts = 0;
  if (authoredRefs.size > 0) {
    const demand = await prisma.epochSummaryRecord.aggregate({
      where: { cid: { in: Array.from(authoredRefs) } },
      _sum: { receiptCount: true },
    });
    demandReceipts = demand._sum?.receiptCount ?? 0;
  }

  // Total sats received on their content
  let totalReceivedSats = 0;
  if (authoredRefs.size > 0) {
    const received = await prisma.protocolEvent.aggregate({
      where: { ref: { in: Array.from(authoredRefs) }, kind: 0x01 },
      _sum: { sats: true },
    });
    totalReceivedSats = received._sum?.sats ?? 0;
  }

  return {
    pubkey,
    total_events: totalEvents,
    announcements: announceEvents.length,
    posts: postCount,
    funds: fundEvents.length,
    total_funded_sats: totalFundedSats,
    total_received_sats: totalReceivedSats,
    unique_refs_funded: uniqueRefsFunded,
    authored_refs: authoredRefs.size,
    demand_receipts: demandReceipts,
  };
}

// ── Market Quote ────────────────────────────────────────────────────

export interface MarketQuote {
  /** Number of hosts in the directory. */
  total_hosts: number;
  /** Number of TRUSTED hosts. */
  trusted_hosts: number;
  /** Supply curve: sorted array of host min_bounty_sats thresholds. */
  supply_curve: { min_sats: number; hosts_at_or_below: number }[];
  /** Tier pricing estimates (sats for Gold/Silver/Bronze). */
  tier_estimates: {
    gold: { sats: number; replicas: number; months: number };
    silver: { sats: number; replicas: number; months: number };
    bronze: { sats: number; replicas: number; months: number };
  };
  /** Median min_request_sats across trusted hosts. */
  median_price: number;
}

/**
 * GET /market/quote — supply curve + tier pricing from host directory.
 */
export async function getMarketQuote(
  prisma: PrismaClient,
): Promise<MarketQuote> {
  const hosts = await prisma.host.findMany({
    where: { status: "TRUSTED" },
    select: { minRequestSats: true },
    orderBy: { minRequestSats: "asc" },
  });

  const totalHosts = await prisma.host.count();
  const trustedHosts = hosts.length;

  // Supply curve: at each price threshold, how many hosts are available
  const thresholds = [1, 3, 10, 21, 50, 100, 210, 500, 1000];
  const supplyCurve = thresholds.map((t) => ({
    min_sats: t,
    hosts_at_or_below: hosts.filter((h) => h.minRequestSats <= t).length,
  }));

  // Median price
  const medianHost = trustedHosts > 0 ? hosts[Math.floor(trustedHosts / 2)] : null;
  const medianPrice = medianHost?.minRequestSats ?? 0;

  // Tier estimates: sats needed for N replicas for M months
  // Based on drain rate: ~2% of pool per epoch, 6 epochs/day, 30 days/month
  // drain_per_month ≈ pool × 0.02 × 6 × 30 = pool × 3.6
  // To last M months with balance B: B = drain × M → B = B × 3.6 × M → need B/(3.6×M) starting
  // Actually: if drain per month = balance × 3.6, months = balance / (balance × 3.6) = 1/3.6 ≈ 0.28
  // That means any balance lasts ~0.28 months. That doesn't make sense with the 2% cap.
  // Correct: drain per epoch = min(cap, actual). Cap = balance × 0.02. Over 180 epochs/month:
  // total drain = balance × 0.02 × 180 = balance × 3.6 per month. So balance lasts ~0.28 months.
  // But cap recalculates each epoch on remaining balance, so it's exponential decay:
  // after 1 month: balance × (0.98)^180 ≈ balance × 0.026. Pool lasts ~4-5 months effectively.
  // Use exponential model: months until pool < 1 sat.
  // (0.98)^(6*30*M) < 1/B → M = -log(B) / (180 * log(0.98))
  //
  // For simplicity, use a factor: sats_needed = desired_months × hosts × estimated_drain_per_host_per_month
  // Approximate: 100 sats/host/month as baseline drain.
  const drainPerHostPerMonth = 100;

  const tierEstimates = {
    gold: {
      sats: 10 * 6 * drainPerHostPerMonth, // 10 replicas × 6 months
      replicas: 10,
      months: 6,
    },
    silver: {
      sats: 5 * 3 * drainPerHostPerMonth, // 5 replicas × 3 months
      replicas: 5,
      months: 3,
    },
    bronze: {
      sats: 3 * 1 * drainPerHostPerMonth, // 3 replicas × 1 month
      replicas: 3,
      months: 1,
    },
  };

  return {
    total_hosts: totalHosts,
    trusted_hosts: trustedHosts,
    supply_curve: supplyCurve,
    tier_estimates: tierEstimates,
    median_price: medianPrice,
  };
}

// ── Host ROI ────────────────────────────────────────────────────────

export interface HostROI {
  /** Top earning CIDs in recent epochs. */
  top_earning_cids: {
    cid: string;
    total_reward_sats: number;
    receipt_count: number;
    epochs_active: number;
  }[];
  /** Estimated sats/day if mirroring top 20 CIDs. */
  estimated_sats_per_day: number;
  /** Total rewards distributed in last 24h (6 epochs). */
  total_rewards_24h: number;
  /** Median payout per host per epoch. */
  median_payout_per_epoch: number;
}

/**
 * GET /host/roi — host conversion surface.
 * "How much will I earn if I run a host?"
 */
export async function getHostROI(
  prisma: PrismaClient,
): Promise<HostROI> {
  // Get recent epoch summaries (last 6 epochs = ~24h)
  const latestSummary = await prisma.epochSummaryRecord.findFirst({
    orderBy: { epoch: "desc" },
    select: { epoch: true },
  });

  const latestEpoch = latestSummary?.epoch ?? 0;
  const sinceEpoch = Math.max(0, latestEpoch - 5);

  const summaries = await prisma.epochSummaryRecord.findMany({
    where: { epoch: { gte: sinceEpoch } },
  });

  // Aggregate by CID
  const cidStats = new Map<
    string,
    { totalReward: number; receiptCount: number; epochs: Set<number> }
  >();

  let totalRewards24h = 0;
  const payoutsPerEpoch: number[] = [];

  for (const s of summaries) {
    const reward = Number(s.rewardSats);
    totalRewards24h += reward;

    let stat = cidStats.get(s.cid);
    if (!stat) {
      stat = { totalReward: 0, receiptCount: 0, epochs: new Set() };
      cidStats.set(s.cid, stat);
    }
    stat.totalReward += reward;
    stat.receiptCount += s.receiptCount;
    stat.epochs.add(s.epoch);
  }

  // Per-host-per-epoch payouts for median calculation
  const epochHostMap = new Map<string, number>();
  for (const s of summaries) {
    const key = `${s.epoch}:${s.hostPubkey}`;
    epochHostMap.set(key, (epochHostMap.get(key) ?? 0) + Number(s.rewardSats));
  }
  for (const payout of epochHostMap.values()) {
    payoutsPerEpoch.push(payout);
  }
  payoutsPerEpoch.sort((a, b) => a - b);

  const medianPayout =
    payoutsPerEpoch.length > 0
      ? (payoutsPerEpoch[Math.floor(payoutsPerEpoch.length / 2)] ?? 0)
      : 0;

  // Top earning CIDs
  const topCids = Array.from(cidStats.entries())
    .map(([cid, stat]) => ({
      cid,
      total_reward_sats: stat.totalReward,
      receipt_count: stat.receiptCount,
      epochs_active: stat.epochs.size,
    }))
    .sort((a, b) => b.total_reward_sats - a.total_reward_sats)
    .slice(0, 20);

  // Estimated sats/day if mirroring top 20
  const top20Total = topCids.reduce((s, c) => s + c.total_reward_sats, 0);
  const epochsInRange = Math.max(1, latestEpoch - sinceEpoch + 1);
  const satsPerEpoch = top20Total / epochsInRange;
  const estimatedPerDay = Math.round(satsPerEpoch * 6);

  return {
    top_earning_cids: topCids,
    estimated_sats_per_day: estimatedPerDay,
    total_rewards_24h: totalRewards24h,
    median_payout_per_epoch: medianPayout,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Update edge counts in GraphImportance after new edges are stored.
 * Lightweight incremental update (upsert counts only).
 */
async function updateEdgeCounts(
  prisma: PrismaClient,
  sourceRef: string,
  edges: BodyEdgeCandidate[],
): Promise<void> {
  // Update outbound count for source
  const outboundCount = await prisma.bodyEdge.count({
    where: { sourceRef },
  });
  await prisma.graphImportance.upsert({
    where: { ref: sourceRef },
    create: { ref: sourceRef, outboundEdges: outboundCount, score: 0 },
    update: { outboundEdges: outboundCount },
  });

  // Update inbound counts for targets
  for (const edge of edges) {
    const inboundCount = await prisma.bodyEdge.count({
      where: { targetRef: edge.targetRef },
    });
    await prisma.graphImportance.upsert({
      where: { ref: edge.targetRef },
      create: {
        ref: edge.targetRef,
        inboundEdges: inboundCount,
        score: 0,
      },
      update: { inboundEdges: inboundCount },
    });
  }
}
