/**
 * Epoch settlement — aggregate receipts, compute payouts, drain bounties.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards, §Receipt-Based Payouts, §Egress Royalty
 *
 * Called once per epoch (after epoch closes). Steps:
 *   1. Query all valid receipts for the epoch
 *   2. Group by (host, cid) via aggregateReceipts()
 *   3. Filter by payout eligibility (smooth: receiptCount >= 1, provenSats > 0)
 *   4. For each eligible group: compute reward, debit bounty, persist summary
 *   5. Compute egress royalty (flat 1% of proven egress) and debit from bounty
 *   6. Log EPOCH_SUMMARY_EVENT per settlement
 */

import type { PrismaClient } from "@prisma/client";
import {
  aggregateReceipts,
  isPayoutEligible,
  computePayoutWeight,
  computeEpochAutoBids,
  cidEpochCap,
  distributeRewards,
  computeEgressRoyalty,
  type ReceiptDigest,
  type HostScore,
  AGGREGATOR_FEE_PCT,
} from "@dupenet/physics";
import { debitPayout, getPool, creditTip } from "./bounty-pool.js";
import { drainPinBudgets } from "./pin-contracts.js";
import { appendEvent } from "../event-log/writer.js";
import { EPOCH_SUMMARY_EVENT } from "../event-log/schemas.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SettlementResult {
  epoch: number;
  /** Total groups found (host × cid). */
  totalGroups: number;
  /** Groups meeting payout eligibility. */
  eligibleGroups: number;
  /** Groups that actually received a payout (bounty > 0). */
  paidGroups: number;
  /** Total sats paid out to hosts from bounty pool. */
  totalPaidSats: number;
  /** Total aggregator fee collected. */
  totalAggregatorFeeSats: number;
  /** Total egress royalty deducted (1% of proven L402 fees). */
  totalEgressRoyaltySats: number;
  /** Total proven egress sats across all receipts. */
  totalProvenEgressSats: number;
  /** Total auto-bid sats credited to pools (before royalty). */
  totalAutoBidSats: number;
  /** Total auto-bid royalty deducted by founder. */
  totalAutoBidRoyaltySats: number;
  /** Per-group detail. */
  summaries: GroupSummary[];
}

export interface GroupSummary {
  host: string;
  cid: string;
  receiptCount: number;
  uniqueClients: number;
  totalProvenSats: number;
  eligible: boolean;
  rewardSats: number;
}

// ── Settlement ─────────────────────────────────────────────────────

/**
 * Settle a completed epoch: aggregate receipts, compute + execute payouts.
 *
 * Idempotent: if EpochSummaryRecords already exist for this epoch,
 * returns early with zero payouts (prevents double-spend).
 */
export async function settleEpoch(
  prisma: PrismaClient,
  epoch: number,
): Promise<SettlementResult> {
  // ── Idempotency guard ──────────────────────────────────────────
  const existingSummaries = await prisma.epochSummaryRecord.count({
    where: { epoch },
  });
  if (existingSummaries > 0) {
    return {
      epoch,
      totalGroups: 0,
      eligibleGroups: 0,
      paidGroups: 0,
      totalPaidSats: 0,
      totalAggregatorFeeSats: 0,
      totalEgressRoyaltySats: 0,
      totalProvenEgressSats: 0,
      totalAutoBidSats: 0,
      totalAutoBidRoyaltySats: 0,
      summaries: [],
    };
  }

  // ── 1. Fetch all receipts for this epoch ───────────────────────
  const receipts = await prisma.receipt.findMany({
    where: { epoch },
    select: {
      hostPubkey: true,
      fileRoot: true,
      assetRoot: true,
      clientPubkey: true,
      priceSats: true,
    },
  });

  if (receipts.length === 0) {
    return {
      epoch,
      totalGroups: 0,
      eligibleGroups: 0,
      paidGroups: 0,
      totalPaidSats: 0,
      totalAggregatorFeeSats: 0,
      totalEgressRoyaltySats: 0,
      totalProvenEgressSats: 0,
      totalAutoBidSats: 0,
      totalAutoBidRoyaltySats: 0,
      summaries: [],
    };
  }

  // ── 2. Map to ReceiptDigest (cid = assetRoot ?? fileRoot) ──────
  const digests: ReceiptDigest[] = receipts.map((r) => ({
    host_pubkey: r.hostPubkey,
    cid: r.assetRoot ?? r.fileRoot,
    client_pubkey: r.clientPubkey,
    price_sats: r.priceSats,
  }));

  // ── 3. Aggregate into (host, cid) groups ───────────────────────
  const groups = aggregateReceipts(digests);

  // ── 4. Classify eligible vs ineligible ─────────────────────────
  const summaries: GroupSummary[] = [];
  let totalPaidSats = 0;
  let totalAggregatorFeeSats = 0;
  let totalEgressRoyaltySats = 0;
  let totalProvenEgressSats = 0;
  let eligibleCount = 0;
  let paidCount = 0;

  // Collect all eligible groups per CID for multi-host reward splitting
  const cidHostGroups = new Map<
    string,
    { host: string; receiptCount: number; uniqueClients: number; totalProvenSats: number }[]
  >();

  for (const group of groups) {
    totalProvenEgressSats += group.totalProvenSats;

    if (isPayoutEligible(group)) {
      eligibleCount++;
      let hostList = cidHostGroups.get(group.cid);
      if (!hostList) {
        hostList = [];
        cidHostGroups.set(group.cid, hostList);
      }
      hostList.push({
        host: group.host,
        receiptCount: group.receiptCount,
        uniqueClients: group.uniqueClients,
        totalProvenSats: group.totalProvenSats,
      });
    } else {
      summaries.push({
        host: group.host,
        cid: group.cid,
        receiptCount: group.receiptCount,
        uniqueClients: group.uniqueClients,
        totalProvenSats: group.totalProvenSats,
        eligible: false,
        rewardSats: 0,
      });
    }
  }

  // ── 5. Compute rewards per CID, split among eligible hosts ─────
  for (const [cid, hostList] of cidHostGroups) {
    // Look up bounty pool balance
    const pool = await getPool(prisma, cid);
    const bountyBalance = pool?.balance ?? 0;

    if (bountyBalance <= 0) {
      // No bounty → hosts earn 0 from bounty pool (they still earned egress fees)
      for (const h of hostList) {
        summaries.push({
          host: h.host,
          cid,
          receiptCount: h.receiptCount,
          uniqueClients: h.uniqueClients,
          totalProvenSats: h.totalProvenSats,
          eligible: true,
          rewardSats: 0,
        });
      }
      continue;
    }

    // Build HostScore array for distributeRewards()
    // payoutWeight = totalProvenSats × (1 + log2(uniqueClients))
    const hostScores: HostScore[] = [];
    for (const h of hostList) {
      const hostRecord = await prisma.host.findUnique({
        where: { pubkey: h.host },
        select: { availabilityScore: true },
      });
      hostScores.push({
        payoutWeight: computePayoutWeight(h.totalProvenSats, h.uniqueClients),
        uptimeRatio: hostRecord?.availabilityScore ?? 0.5,
        diversityContribution: 1.0, // MVP: no ASN/geo data yet
      });
    }

    // distributeRewards already applies cidEpochCap + aggregator fee
    const rewards = distributeRewards(bountyBalance, hostScores);

    // Total drain for this CID = sum of rewards + aggregator fee
    const totalHostReward = rewards.reduce((sum, r) => sum + r, 0);
    const cap = cidEpochCap(bountyBalance);
    const aggregatorFee = Math.floor(cap * AGGREGATOR_FEE_PCT);

    // Egress royalty: flat 1% of total proven egress for this CID
    const cidProvenEgress = hostList.reduce((sum, h) => sum + h.totalProvenSats, 0);
    const { egressRoyalty } = computeEgressRoyalty(cidProvenEgress);

    const totalDrain = totalHostReward + aggregatorFee + egressRoyalty;

    // Debit from bounty pool (cap total to available balance)
    const actualDrain = Math.min(totalDrain, bountyBalance);
    if (actualDrain > 0) {
      await debitPayout(prisma, cid, actualDrain, epoch);
      // Update active pin contracts' remaining budgets
      await drainPinBudgets(prisma, cid, actualDrain);
    }

    // Record per-host results
    for (let i = 0; i < hostList.length; i++) {
      const h = hostList[i]!;
      const reward = rewards[i] ?? 0;

      summaries.push({
        host: h.host,
        cid,
        receiptCount: h.receiptCount,
        uniqueClients: h.uniqueClients,
        totalProvenSats: h.totalProvenSats,
        eligible: true,
        rewardSats: reward,
      });

      if (reward > 0) paidCount++;
      totalPaidSats += reward;
    }
    totalAggregatorFeeSats += aggregatorFee;
    totalEgressRoyaltySats += egressRoyalty;
  }

  // ── 6. Compute + credit auto-bids ────────────────────────────
  // Auto-bid: 2% of proven egress per CID → credited to pool[cid] (with royalty).
  // This creates the self-sustaining flywheel: traffic → auto-bids → bounty grows.
  const autoBidResults = computeEpochAutoBids(digests);
  let totalAutoBidSats = 0;
  let totalAutoBidRoyaltySats = 0;

  // Map from CID → autoBidSats for inclusion in per-host summaries
  const cidAutoBidMap = new Map<string, number>();

  for (const ab of autoBidResults) {
    // Credit pool via creditTip (applies founder royalty)
    const { protocolFee } = await creditTip(prisma, ab.poolKey, ab.autoBidSats);
    totalAutoBidSats += ab.autoBidSats;
    totalAutoBidRoyaltySats += protocolFee;
    cidAutoBidMap.set(ab.poolKey, (cidAutoBidMap.get(ab.poolKey) ?? 0) + ab.autoBidSats);
  }

  // ── 7. Persist EpochSummaryRecords ─────────────────────────────
  // Compute per-CID egress royalty for summary records
  const cidEgressRoyaltyMap = new Map<string, number>();
  for (const s of summaries) {
    if (s.eligible && s.totalProvenSats > 0) {
      const { egressRoyalty } = computeEgressRoyalty(s.totalProvenSats);
      cidEgressRoyaltyMap.set(
        `${s.host}:${s.cid}`,
        egressRoyalty,
      );
    }
  }

  for (const s of summaries) {
    const hostCidKey = `${s.host}:${s.cid}`;
    // Distribute CID-level auto-bid proportionally to hosts (or just store CID total on first host)
    // For simplicity: store the CID-level auto-bid on each host's record (query can aggregate)
    const cidAutoBid = cidAutoBidMap.get(s.cid) ?? 0;
    const hostEgressRoyalty = cidEgressRoyaltyMap.get(hostCidKey) ?? 0;

    await prisma.epochSummaryRecord.create({
      data: {
        epoch,
        hostPubkey: s.host,
        cid: s.cid,
        receiptCount: s.receiptCount,
        uniqueClients: s.uniqueClients,
        rewardSats: BigInt(s.rewardSats),
        autoBidSats: cidAutoBid,
        egressRoyaltySats: hostEgressRoyalty,
      },
    });
  }

  // ── 8. Log event ───────────────────────────────────────────────
  await appendEvent(prisma, {
    type: EPOCH_SUMMARY_EVENT,
    timestamp: Date.now(),
    signer: "coordinator",
    sig: "",
    payload: {
      epoch,
      total_groups: groups.length,
      eligible_groups: eligibleCount,
      paid_groups: paidCount,
      total_paid_sats: totalPaidSats,
      total_aggregator_fee_sats: totalAggregatorFeeSats,
      total_egress_royalty_sats: totalEgressRoyaltySats,
      total_proven_egress_sats: totalProvenEgressSats,
      total_auto_bid_sats: totalAutoBidSats,
      total_auto_bid_royalty_sats: totalAutoBidRoyaltySats,
    },
  });

  return {
    epoch,
    totalGroups: groups.length,
    eligibleGroups: eligibleCount,
    paidGroups: paidCount,
    totalPaidSats,
    totalAggregatorFeeSats,
    totalEgressRoyaltySats,
    totalProvenEgressSats,
    totalAutoBidSats,
    totalAutoBidRoyaltySats,
    summaries,
  };
}
