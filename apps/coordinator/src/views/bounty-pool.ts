/**
 * Bounty pool materialized view.
 * DocRef: MVP_PLAN:§Bounty Pool Mechanics
 *
 * Materialized from tip events. Replayable from event log.
 */

import {
  TIP_PROTOCOL_FEE_PCT,
  type CID,
} from "@dupenet/physics";

/** In-memory bounty pool state. */
const pools = new Map<CID, { balance: number; last_payout_epoch: number }>();

/**
 * Credit a tip to a bounty pool.
 * Protocol fee is deducted; remainder goes to pool.
 */
export function creditTip(cid: CID, amount: number): { poolCredit: number; protocolFee: number } {
  const protocolFee = Math.floor(amount * TIP_PROTOCOL_FEE_PCT);
  const poolCredit = amount - protocolFee;

  const existing = pools.get(cid) ?? { balance: 0, last_payout_epoch: 0 };
  existing.balance += poolCredit;
  pools.set(cid, existing);

  return { poolCredit, protocolFee };
}

/**
 * Debit a payout from a bounty pool.
 */
export function debitPayout(cid: CID, amount: number, epoch: number): boolean {
  const pool = pools.get(cid);
  if (!pool || pool.balance < amount) return false;

  pool.balance -= amount;
  pool.last_payout_epoch = epoch;
  return true;
}

export function getPool(cid: CID): { balance: number; last_payout_epoch: number } | undefined {
  return pools.get(cid);
}

export function getAllPools(): ReadonlyMap<CID, { balance: number; last_payout_epoch: number }> {
  return pools;
}
