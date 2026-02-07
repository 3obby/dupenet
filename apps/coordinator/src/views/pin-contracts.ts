/**
 * Pin contract lifecycle — budgeted durability.
 * DocRef: MVP_PLAN:§Pin Contract API
 *
 * Pin contracts wrap bounty pools with explicit SLA constraints.
 * Budget tops up bounty[asset_root]; drain_rate caps per-epoch budget depletion.
 * Platforms treat this as "pay for durability."
 */

import type { PrismaClient } from "@prisma/client";
import {
  cidFromObject,
  PIN_MIN_BUDGET_SATS,
  PIN_MAX_COPIES,
  PIN_CANCEL_FEE_PCT,
  currentEpoch,
} from "@dupenet/physics";
import { creditBountyDirect, debitPayout } from "./bounty-pool.js";
import { appendEvent } from "../event-log/writer.js";
import { PIN_CREATE_EVENT, PIN_CANCEL_EVENT } from "../event-log/schemas.js";

// ── Types ──────────────────────────────────────────────────────────

export interface CreatePinInput {
  client: string;
  asset_root: string;
  min_copies: number;
  duration_epochs: number;
  budget_sats: number;
  sig: string;
}

export interface PinResult {
  id: string;
  client: string;
  asset_root: string;
  min_copies: number;
  duration_epochs: number;
  budget_sats: number;
  drain_rate: number;
  remaining_budget: number;
  status: string;
  created_epoch: number;
}

export interface PinStatusResult extends PinResult {
  active_hosts: number;
  recent_epoch_proofs: EpochProof[];
  copies_met: boolean;
}

export interface EpochProof {
  epoch: number;
  host: string;
  receipt_count: number;
  unique_clients: number;
  reward_sats: number;
}

// ── Validation ─────────────────────────────────────────────────────

export function validatePinInput(
  input: CreatePinInput,
): { valid: true } | { valid: false; error: string } {
  if (input.budget_sats < PIN_MIN_BUDGET_SATS) {
    return { valid: false, error: `budget_sats must be >= ${PIN_MIN_BUDGET_SATS}` };
  }
  if (input.min_copies < 1 || input.min_copies > PIN_MAX_COPIES) {
    return { valid: false, error: `min_copies must be 1-${PIN_MAX_COPIES}` };
  }
  if (input.duration_epochs < 1) {
    return { valid: false, error: "duration_epochs must be >= 1" };
  }
  if (!/^[0-9a-f]{64}$/.test(input.asset_root)) {
    return { valid: false, error: "asset_root must be 64 hex chars" };
  }
  if (!/^[0-9a-f]{64}$/.test(input.client)) {
    return { valid: false, error: "client must be 64 hex chars" };
  }
  return { valid: true };
}

// ── Create ─────────────────────────────────────────────────────────

export async function createPin(
  prisma: PrismaClient,
  input: CreatePinInput,
): Promise<PinResult> {
  const drainRate = Math.floor(input.budget_sats / input.duration_epochs);
  const epoch = currentEpoch();

  // Deterministic ID from content
  const id = cidFromObject({
    version: 1,
    client: input.client,
    asset_root: input.asset_root,
    min_copies: input.min_copies,
    duration_epochs: input.duration_epochs,
    budget_sats: input.budget_sats,
    created_epoch: epoch,
  });

  // Persist pin contract
  const pin = await prisma.pinContract.create({
    data: {
      id,
      client: input.client,
      assetRoot: input.asset_root,
      minCopies: input.min_copies,
      durationEpochs: input.duration_epochs,
      budgetSats: BigInt(input.budget_sats),
      drainRate: BigInt(drainRate),
      remainingBudget: BigInt(input.budget_sats),
      status: "ACTIVE",
      createdEpoch: epoch,
      sig: input.sig,
    },
  });

  // Credit bounty pool (no protocol fee for pins)
  await creditBountyDirect(prisma, input.asset_root, input.budget_sats);

  // Log event
  await appendEvent(prisma, {
    type: PIN_CREATE_EVENT,
    timestamp: Date.now(),
    signer: input.client,
    sig: input.sig,
    payload: {
      pin_id: id,
      asset_root: input.asset_root,
      budget_sats: input.budget_sats,
      duration_epochs: input.duration_epochs,
      drain_rate: drainRate,
      min_copies: input.min_copies,
    },
  });

  return toPinResult(pin);
}

// ── Get Status ─────────────────────────────────────────────────────

export async function getPinStatus(
  prisma: PrismaClient,
  id: string,
): Promise<PinStatusResult | null> {
  const pin = await prisma.pinContract.findUnique({ where: { id } });
  if (!pin) return null;

  // Find recent epoch summaries for this asset_root (last 6 epochs = 24h)
  const current = currentEpoch();
  const recentEpochs = await prisma.epochSummaryRecord.findMany({
    where: {
      cid: pin.assetRoot,
      epoch: { gte: Math.max(0, current - 6) },
    },
    orderBy: { epoch: "desc" },
  });

  // Count distinct active hosts (hosts with summaries in recent epochs)
  const activeHostSet = new Set(recentEpochs.map((s) => s.hostPubkey));

  const recentProofs: EpochProof[] = recentEpochs.map((s) => ({
    epoch: s.epoch,
    host: s.hostPubkey,
    receipt_count: s.receiptCount,
    unique_clients: s.uniqueClients,
    reward_sats: Number(s.rewardSats),
  }));

  return {
    ...toPinResult(pin),
    active_hosts: activeHostSet.size,
    recent_epoch_proofs: recentProofs,
    copies_met: activeHostSet.size >= pin.minCopies,
  };
}

// ── Cancel ─────────────────────────────────────────────────────────

export async function cancelPin(
  prisma: PrismaClient,
  id: string,
  sig: string,
): Promise<{ refund: number; fee: number } | { error: string }> {
  const pin = await prisma.pinContract.findUnique({ where: { id } });
  if (!pin) return { error: "pin_not_found" };
  if (pin.status !== "ACTIVE") return { error: "pin_not_active" };

  const remaining = Number(pin.remainingBudget);
  const fee = Math.floor(remaining * PIN_CANCEL_FEE_PCT);
  const refund = remaining - fee;

  // Debit refund from bounty pool (may partially fail if pool was drained by tips too)
  if (refund > 0) {
    await debitPayout(prisma, pin.assetRoot, refund, currentEpoch());
  }

  // Update pin contract
  await prisma.pinContract.update({
    where: { id },
    data: {
      status: "CANCELLED",
      remainingBudget: 0n,
    },
  });

  // Log event
  await appendEvent(prisma, {
    type: PIN_CANCEL_EVENT,
    timestamp: Date.now(),
    signer: pin.client,
    sig,
    payload: {
      pin_id: id,
      refund,
      fee,
      remaining_before: remaining,
    },
  });

  return { refund, fee };
}

// ── Drain Pin Budgets (called after epoch settlement) ──────────────

/**
 * After epoch settlement drains a CID's bounty pool, update any active
 * pin contracts for that CID.
 *
 * Each pin's remainingBudget decreases by min(actualDrain, pin.drainRate).
 * If remainingBudget reaches 0, status → EXHAUSTED.
 */
export async function drainPinBudgets(
  prisma: PrismaClient,
  cid: string,
  actualDrain: number,
): Promise<number> {
  const activePins = await prisma.pinContract.findMany({
    where: { assetRoot: cid, status: "ACTIVE" },
  });

  let exhaustedCount = 0;

  for (const pin of activePins) {
    const drainRate = Number(pin.drainRate);
    const remaining = Number(pin.remainingBudget);
    const deduction = Math.min(actualDrain, drainRate, remaining);

    const newRemaining = remaining - deduction;

    if (newRemaining <= 0) {
      await prisma.pinContract.update({
        where: { id: pin.id },
        data: { remainingBudget: 0n, status: "EXHAUSTED" },
      });
      exhaustedCount++;
    } else {
      await prisma.pinContract.update({
        where: { id: pin.id },
        data: { remainingBudget: BigInt(newRemaining) },
      });
    }
  }

  return exhaustedCount;
}

// ── Helpers ────────────────────────────────────────────────────────

function toPinResult(pin: {
  id: string;
  client: string;
  assetRoot: string;
  minCopies: number;
  durationEpochs: number;
  budgetSats: bigint;
  drainRate: bigint;
  remainingBudget: bigint;
  status: string;
  createdEpoch: number;
}): PinResult {
  return {
    id: pin.id,
    client: pin.client,
    asset_root: pin.assetRoot,
    min_copies: pin.minCopies,
    duration_epochs: pin.durationEpochs,
    budget_sats: Number(pin.budgetSats),
    drain_rate: Number(pin.drainRate),
    remaining_budget: Number(pin.remainingBudget),
    status: pin.status,
    created_epoch: pin.createdEpoch,
  };
}
