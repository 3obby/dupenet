/**
 * Epoch aggregation — pure functions for grouping receipts,
 * checking payout eligibility, and computing payout weight.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards, §Receipt-Based Payouts
 *
 * No I/O, no state. Takes receipt digests, returns grouped summaries.
 *
 * Economics rework (2026-02-10):
 *   - Hard 5/3 gate replaced with smooth payout_weight multiplier.
 *   - isPayoutEligible: receipt_count >= 1 AND totalProvenSats > 0.
 *   - payout_weight = totalProvenSats * (1 + log2(uniqueClients)).
 */

import { RECEIPT_MIN_COUNT } from "./constants.js";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Minimal receipt fields needed for epoch aggregation.
 * The `cid` field should be `assetRoot ?? fileRoot` (caller resolves).
 * `price_sats` is the L402 egress fee bound to the receipt.
 */
export interface ReceiptDigest {
  host_pubkey: string;
  cid: string;
  client_pubkey: string;
  price_sats: number;
}

/**
 * Aggregated group: one (host, cid) pair in an epoch.
 */
export interface EpochGroup {
  host: string;
  cid: string;
  receiptCount: number;
  uniqueClients: number;
  /** Sum of price_sats across all receipts in this group. */
  totalProvenSats: number;
}

// ── Aggregation ────────────────────────────────────────────────────

/**
 * Group receipts by (host, cid) and compute per-group stats.
 * Pure function — no I/O.
 */
export function aggregateReceipts(receipts: readonly ReceiptDigest[]): EpochGroup[] {
  const groups = new Map<
    string,
    { host: string; cid: string; count: number; clients: Set<string>; provenSats: number }
  >();

  for (const r of receipts) {
    const key = `${r.host_pubkey}:${r.cid}`;
    let group = groups.get(key);
    if (!group) {
      group = { host: r.host_pubkey, cid: r.cid, count: 0, clients: new Set(), provenSats: 0 };
      groups.set(key, group);
    }
    group.count++;
    group.clients.add(r.client_pubkey);
    group.provenSats += r.price_sats;
  }

  return Array.from(groups.values()).map((g) => ({
    host: g.host,
    cid: g.cid,
    receiptCount: g.count,
    uniqueClients: g.clients.size,
    totalProvenSats: g.provenSats,
  }));
}

// ── Eligibility ────────────────────────────────────────────────────

/**
 * Check if an (host, cid) group meets the payout threshold.
 * Smooth model: requires >= RECEIPT_MIN_COUNT (1) receipt with totalProvenSats > 0.
 * The actual reward magnitude is scaled by computePayoutWeight().
 */
export function isPayoutEligible(group: {
  receiptCount: number;
  totalProvenSats: number;
}): boolean {
  return group.receiptCount >= RECEIPT_MIN_COUNT && group.totalProvenSats > 0;
}

// ── Payout Weight ──────────────────────────────────────────────────

/**
 * Smooth payout weight: demand signal × client diversity bonus.
 *
 * payout_weight = totalProvenSats × (1 + log2(uniqueClients))
 *
 * - 1 client:  weight = totalProvenSats × 1   (base)
 * - 2 clients: weight = totalProvenSats × 2   (2× for organic diversity)
 * - 5 clients: weight = totalProvenSats × 3.3 (3.3×)
 * - 10 clients: weight = totalProvenSats × 4.3 (4.3×)
 *
 * Replaces the old W_CLIENTS * uniqueClients additive term.
 * No cliffs, no discontinuities — hosts earn proportionally from epoch 1.
 */
export function computePayoutWeight(
  totalProvenSats: number,
  uniqueClients: number,
): number {
  if (totalProvenSats <= 0 || uniqueClients <= 0) return 0;
  return totalProvenSats * (1 + Math.log2(uniqueClients));
}
