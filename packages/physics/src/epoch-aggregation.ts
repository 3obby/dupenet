/**
 * Epoch aggregation — pure functions for grouping receipts and
 * checking payout eligibility.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards, §Receipt-Based Payouts
 *
 * No I/O, no state. Takes receipt digests, returns grouped summaries.
 */

import {
  RECEIPT_MIN_COUNT,
  RECEIPT_MIN_UNIQUE_CLIENTS,
} from "./constants.js";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Minimal receipt fields needed for epoch aggregation.
 * The `cid` field should be `assetRoot ?? fileRoot` (caller resolves).
 */
export interface ReceiptDigest {
  host_pubkey: string;
  cid: string;
  client_pubkey: string;
}

/**
 * Aggregated group: one (host, cid) pair in an epoch.
 */
export interface EpochGroup {
  host: string;
  cid: string;
  receiptCount: number;
  uniqueClients: number;
}

// ── Aggregation ────────────────────────────────────────────────────

/**
 * Group receipts by (host, cid) and compute per-group stats.
 * Pure function — no I/O.
 */
export function aggregateReceipts(receipts: readonly ReceiptDigest[]): EpochGroup[] {
  const groups = new Map<string, { host: string; cid: string; count: number; clients: Set<string> }>();

  for (const r of receipts) {
    const key = `${r.host_pubkey}:${r.cid}`;
    let group = groups.get(key);
    if (!group) {
      group = { host: r.host_pubkey, cid: r.cid, count: 0, clients: new Set() };
      groups.set(key, group);
    }
    group.count++;
    group.clients.add(r.client_pubkey);
  }

  return Array.from(groups.values()).map((g) => ({
    host: g.host,
    cid: g.cid,
    receiptCount: g.count,
    uniqueClients: g.clients.size,
  }));
}

// ── Eligibility ────────────────────────────────────────────────────

/**
 * Check if an (host, cid) group meets the payout threshold.
 * Requires >= RECEIPT_MIN_COUNT receipts from >= RECEIPT_MIN_UNIQUE_CLIENTS.
 */
export function isPayoutEligible(group: {
  receiptCount: number;
  uniqueClients: number;
}): boolean {
  return (
    group.receiptCount >= RECEIPT_MIN_COUNT &&
    group.uniqueClients >= RECEIPT_MIN_UNIQUE_CLIENTS
  );
}
