/**
 * Host registry — Prisma-backed.
 * DocRef: MVP_PLAN:§Node Operator Model, §Enforcement
 *
 * Materialized from host register/unbond events.
 * Tracks status lifecycle: PENDING → TRUSTED → DEGRADED → INACTIVE → UNBONDING
 */

import type { PrismaClient } from "@prisma/client";
import { OPERATOR_STAKE_SATS } from "@dupenet/physics";

export interface HostRecord {
  pubkey: string;
  endpoint: string | null;
  stake: number;
  status: string;
  pricing: { min_request_sats: number; sats_per_gb: number };
  availability_score: number;
  registered_epoch: number;
  unbond_epoch?: number;
}

export async function registerHost(
  prisma: PrismaClient,
  pubkey: string,
  endpoint: string | null,
  pricing: { min_request_sats: number; sats_per_gb: number },
  epoch: number,
): Promise<HostRecord> {
  const host = await prisma.host.upsert({
    where: { pubkey },
    create: {
      pubkey,
      endpoint,
      stake: BigInt(OPERATOR_STAKE_SATS),
      status: "PENDING",
      minRequestSats: pricing.min_request_sats,
      satsPerGb: pricing.sats_per_gb,
      availabilityScore: 0,
      registeredEpoch: epoch,
    },
    update: {
      endpoint,
      minRequestSats: pricing.min_request_sats,
      satsPerGb: pricing.sats_per_gb,
    },
  });

  return toHostRecord(host);
}

export async function getHost(
  prisma: PrismaClient,
  pubkey: string,
): Promise<HostRecord | null> {
  const host = await prisma.host.findUnique({ where: { pubkey } });
  if (!host) return null;
  return toHostRecord(host);
}

export async function getAllHosts(
  prisma: PrismaClient,
): Promise<HostRecord[]> {
  const hosts = await prisma.host.findMany();
  return hosts.map(toHostRecord);
}

export async function updateStatus(
  prisma: PrismaClient,
  pubkey: string,
  status: string,
): Promise<boolean> {
  try {
    await prisma.host.update({
      where: { pubkey },
      data: { status },
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateAvailability(
  prisma: PrismaClient,
  pubkey: string,
  score: number,
): Promise<void> {
  const host = await prisma.host.findUnique({ where: { pubkey } });
  if (!host) return;

  let newStatus = host.status;

  // Status transitions based on score
  // DocRef: MVP_PLAN:§Protocol Enforcement — Lifecycle
  if (score >= 0.6 && (host.status === "PENDING" || host.status === "DEGRADED" || host.status === "INACTIVE")) {
    newStatus = "TRUSTED";
  } else if (score < 0.6 && score > 0 && host.status === "TRUSTED") {
    newStatus = "DEGRADED";
  } else if (score === 0 && host.status !== "UNBONDING" && host.status !== "SLASHED") {
    newStatus = "INACTIVE";
  }

  await prisma.host.update({
    where: { pubkey },
    data: { availabilityScore: score, status: newStatus },
  });
}

export async function addServedCid(
  prisma: PrismaClient,
  pubkey: string,
  cid: string,
  epoch: number,
): Promise<void> {
  await prisma.hostServe.upsert({
    where: { hostPubkey_cid: { hostPubkey: pubkey, cid } },
    create: { hostPubkey: pubkey, cid, registeredEpoch: epoch },
    update: {},
  });
}

function toHostRecord(host: {
  pubkey: string;
  endpoint: string | null;
  stake: bigint;
  status: string;
  minRequestSats: number;
  satsPerGb: number;
  availabilityScore: number;
  registeredEpoch: number;
  unbondEpoch: number | null;
}): HostRecord {
  return {
    pubkey: host.pubkey,
    endpoint: host.endpoint,
    stake: Number(host.stake),
    status: host.status,
    pricing: {
      min_request_sats: host.minRequestSats,
      sats_per_gb: host.satsPerGb,
    },
    availability_score: host.availabilityScore,
    registered_epoch: host.registeredEpoch,
    ...(host.unbondEpoch != null ? { unbond_epoch: host.unbondEpoch } : {}),
  };
}
