/**
 * Bounty pool — Prisma-backed.
 * DocRef: MVP_PLAN:§Bounty Pool Mechanics, §Founder Royalty
 *
 * Materialized from tip/fund events. Replayable from event log.
 * Founder royalty is volume-tapering: r(v) = 0.15 × (1 + v/125M)^(-0.3155)
 */

import type { PrismaClient } from "@prisma/client";
import { computeRoyalty } from "@dupenet/physics";

/**
 * Get cumulative volume (total sats ever credited across all pools).
 * Used as input to the founder royalty formula.
 */
export async function getCumulativeVolume(prisma: PrismaClient): Promise<number> {
  const result = await prisma.bountyPool.aggregate({
    _sum: { totalTipped: true },
  });
  return Number(result._sum.totalTipped ?? 0n);
}

/**
 * Credit a tip/fund to a bounty pool.
 * Founder royalty (volume-tapering) is deducted; remainder goes to pool.
 */
export async function creditTip(
  prisma: PrismaClient,
  cid: string,
  amount: number,
): Promise<{ poolCredit: number; protocolFee: number }> {
  const cumulativeVolume = await getCumulativeVolume(prisma);
  const { royalty, poolCredit } = computeRoyalty(amount, cumulativeVolume);

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

  return { poolCredit, protocolFee: royalty };
}

/**
 * Credit a bounty pool directly (no protocol fee).
 * Used by pin contracts — budget goes straight to pool.
 */
export async function creditBountyDirect(
  prisma: PrismaClient,
  cid: string,
  amount: number,
): Promise<void> {
  await prisma.bountyPool.upsert({
    where: { cid },
    create: {
      cid,
      balance: BigInt(amount),
      totalTipped: 0n,
    },
    update: {
      balance: { increment: BigInt(amount) },
    },
  });
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
