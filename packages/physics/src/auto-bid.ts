/**
 * Auto-bid computation — traffic-driven pool funding.
 * DocRef: MVP_PLAN:§Clearinghouse Model, §Auto-Bids, §Sustainability Ratio
 *
 * Every L402 fetch auto-credits AUTO_BID_PCT (2%) of the egress fee back
 * to pool[fetched_cid]. This creates the self-sustaining flywheel:
 *   traffic → auto-bids → bounty grows → hosts mirror → more availability → traffic
 *
 * Auto-bid credits are subject to founder royalty (same as manual FUND events).
 * The sustainability ratio measures whether organic auto-bid income covers
 * preservation costs — ratio >= 1.0 means content is self-sustaining.
 *
 * No I/O, no state. Pure functions only.
 */

import { AUTO_BID_PCT } from "./constants.js";
import type { ReceiptDigest } from "./epoch-aggregation.js";

// ── Single receipt auto-bid ──────────────────────────────────────

/**
 * Compute the auto-bid contribution for a single receipt.
 * @param priceSats - L402 egress fee in sats (from receipt.price_sats)
 * @returns auto-bid amount in sats (floored to integer)
 */
export function computeAutoBid(priceSats: number): number {
  if (priceSats <= 0) return 0;
  return Math.floor(priceSats * AUTO_BID_PCT);
}

// ── Epoch-level auto-bid aggregation ─────────────────────────────

/**
 * Result of auto-bid aggregation for one pool key (CID).
 */
export interface AutoBidResult {
  poolKey: string;
  /** Total L402 egress sats for this CID in the epoch. */
  totalEgressSats: number;
  /** Auto-bid amount to credit to pool (before royalty). */
  autoBidSats: number;
  /** Number of receipts contributing to this auto-bid. */
  receiptCount: number;
}

/**
 * Aggregate receipts into per-CID auto-bid credits for an epoch.
 *
 * Groups receipts by CID, sums price_sats per CID, then computes
 * auto-bid = floor(sum_price_sats * AUTO_BID_PCT) per CID.
 *
 * Note: auto-bid is computed on the per-CID aggregate (not per-receipt)
 * to minimize rounding loss on small individual prices.
 *
 * @param receipts - all valid receipts for the epoch
 * @returns per-CID auto-bid results
 */
export function computeEpochAutoBids(
  receipts: readonly ReceiptDigest[],
): AutoBidResult[] {
  if (receipts.length === 0) return [];

  // Group by CID
  const cidGroups = new Map<string, { totalEgress: number; count: number }>();

  for (const r of receipts) {
    if (r.price_sats <= 0) continue;
    let group = cidGroups.get(r.cid);
    if (!group) {
      group = { totalEgress: 0, count: 0 };
      cidGroups.set(r.cid, group);
    }
    group.totalEgress += r.price_sats;
    group.count++;
  }

  const results: AutoBidResult[] = [];
  for (const [poolKey, group] of cidGroups) {
    const autoBidSats = Math.floor(group.totalEgress * AUTO_BID_PCT);
    if (autoBidSats > 0) {
      results.push({
        poolKey,
        totalEgressSats: group.totalEgress,
        autoBidSats,
        receiptCount: group.count,
      });
    }
  }

  return results;
}

// ── Sustainability ratio ─────────────────────────────────────────

/**
 * Compute the sustainability ratio for a CID.
 *
 * ratio = organic_auto_bid_income / preservation_cost
 *
 * - organic_auto_bid_income: average auto-bid sats credited per epoch
 *   (from L402 traffic → AUTO_BID_PCT of egress fees)
 * - preservation_cost: sats drained per epoch for host rewards
 *   (from epoch drain rate: cidEpochCap applied to bounty pool)
 *
 * @param organicIncome - auto-bid sats per epoch (average)
 * @param preservationCost - sats drained per epoch (from rewards + fees)
 * @returns sustainability ratio (>= 1.0 means self-sustaining)
 */
export function sustainabilityRatio(
  organicIncome: number,
  preservationCost: number,
): number {
  if (preservationCost <= 0) {
    // No cost → infinitely sustainable (or no data yet)
    return organicIncome > 0 ? Infinity : 0;
  }
  if (organicIncome <= 0) return 0;
  return organicIncome / preservationCost;
}

/**
 * Check if a CID's traffic generates enough auto-bid income
 * to cover its preservation costs.
 */
export function isSelfSustaining(
  organicIncome: number,
  preservationCost: number,
): boolean {
  return sustainabilityRatio(organicIncome, preservationCost) >= 1.0;
}
