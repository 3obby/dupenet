/**
 * Bounty pool — Prisma-backed.
 * DocRef: MVP_PLAN:§Bounty Pool Mechanics
 *
 * Materialized from tip events. Replayable from event log.
 */

import type { PrismaClient } from "@prisma/client";
import { TIP_PROTOCOL_FEE_PCT } from "@dupenet/physics";

/**
 * Credit a tip to a bounty pool.
 * Protocol fee is deducted; remainder goes to pool.
 */
export async function creditTip(
  prisma: PrismaClient,
  cid: string,
  amount: number,
): Promise<{ poolCredit: number; protocolFee: number }> {
  const protocolFee = Math.floor(amount * TIP_PROTOCOL_FEE_PCT);
  const poolCredit = amount - protocolFee;

  await prisma.bountyPool.upsert({
    where: { cid },
    create: {
      cid,
      balance: BigInt(poolCredit),
      totalTipped: BigInt(amount),
    },
    update: {
      balance: { increment: BigInt(poolCredit) },
      totalTipped: { increment: BigInt(amount) },
    },
  });

  return { poolCredit, protocolFee };
}

/**
 * Debit a payout from a bounty pool.
 */
export async function debitPayout(
  prisma: PrismaClient,
  cid: string,
  amount: number,
  epoch: number,
): Promise<boolean> {
  const pool = await prisma.bountyPool.findUnique({ where: { cid } });
  if (!pool || Number(pool.balance) < amount) return false;

  await prisma.bountyPool.update({
    where: { cid },
    data: {
      balance: { decrement: BigInt(amount) },
      lastPayoutEpoch: epoch,
    },
  });

  return true;
}

export async function getPool(
  prisma: PrismaClient,
  cid: string,
): Promise<{ balance: number; last_payout_epoch: number } | null> {
  const pool = await prisma.bountyPool.findUnique({ where: { cid } });
  if (!pool) return null;
  return {
    balance: Number(pool.balance),
    last_payout_epoch: pool.lastPayoutEpoch,
  };
}
