/**
 * Availability monitoring — spot-checks, scoring, status lifecycle.
 * DocRef: MVP_PLAN:§Enforcement: Earning Decay, §Availability Score
 *
 * Coordinator periodically probes registered hosts:
 *   1. Pick a random CID the host claims to serve
 *   2. Fetch GET /spot-check/:cid from host endpoint
 *   3. Record pass/fail
 *   4. Recompute rolling score (last 6 epochs)
 *   5. Apply status transitions via updateAvailability()
 */

import type { PrismaClient } from "@prisma/client";
import {
  computeAvailabilityScore,
  currentEpoch,
  type CheckResult,
} from "@dupenet/physics";
import { updateAvailability } from "./host-registry.js";

// ── Types ──────────────────────────────────────────────────────────

export interface SpotCheckResult {
  hostPubkey: string;
  cid: string;
  passed: boolean;
  latencyMs?: number;
  error?: string;
}

export interface CheckSummary {
  totalHosts: number;
  checkedHosts: number;
  passedHosts: number;
  failedHosts: number;
  skippedHosts: number;
  results: SpotCheckResult[];
}

/**
 * Fetch function type — injectable for testing.
 * Takes a URL, returns { verified: boolean, size: number } or throws.
 */
export type SpotCheckFetcher = (
  url: string,
  timeoutMs?: number,
) => Promise<{ verified: boolean; size: number }>;

// ── Default fetcher (real HTTP) ────────────────────────────────────

const SPOT_CHECK_TIMEOUT_MS = 30_000;

export const defaultFetcher: SpotCheckFetcher = async (
  url: string,
  timeoutMs = SPOT_CHECK_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { verified: boolean; size: number };
    return body;
  } finally {
    clearTimeout(timer);
  }
};

// ── Record a check result ──────────────────────────────────────────

export async function recordCheck(
  prisma: PrismaClient,
  result: SpotCheckResult,
  epoch: number,
): Promise<void> {
  await prisma.spotCheck.create({
    data: {
      hostPubkey: result.hostPubkey,
      cid: result.cid,
      epoch,
      passed: result.passed,
      latencyMs: result.latencyMs ?? null,
      error: result.error ?? null,
    },
  });
}

// ── Get check history for a host ───────────────────────────────────

export async function getHostChecks(
  prisma: PrismaClient,
  hostPubkey: string,
  windowEpochs: number = 6,
): Promise<CheckResult[]> {
  const epoch = currentEpoch();
  const windowStart = Math.max(0, epoch - windowEpochs);

  const checks = await prisma.spotCheck.findMany({
    where: {
      hostPubkey,
      epoch: { gte: windowStart },
    },
    orderBy: { checkedAt: "desc" },
    select: { passed: true, epoch: true },
  });

  return checks;
}

// ── Spot-check a single host ───────────────────────────────────────

export async function spotCheckHost(
  prisma: PrismaClient,
  hostPubkey: string,
  fetcher: SpotCheckFetcher = defaultFetcher,
): Promise<SpotCheckResult | null> {
  // Get host endpoint
  const host = await prisma.host.findUnique({
    where: { pubkey: hostPubkey },
    select: { endpoint: true, status: true },
  });
  if (!host?.endpoint) return null;
  if (host.status === "UNBONDING" || host.status === "SLASHED") return null;

  // Pick a random CID the host serves
  const servedCids = await prisma.hostServe.findMany({
    where: { hostPubkey },
    select: { cid: true },
  });
  if (servedCids.length === 0) return null;

  const randomIdx = Math.floor(Math.random() * servedCids.length);
  const cid = servedCids[randomIdx]!.cid;

  // Probe the host
  const start = Date.now();
  try {
    const result = await fetcher(
      `${host.endpoint}/spot-check/${cid}`,
    );
    const latencyMs = Date.now() - start;

    return {
      hostPubkey,
      cid,
      passed: result.verified === true,
      latencyMs,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    return {
      hostPubkey,
      cid,
      passed: false,
      latencyMs,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

// ── Run spot-checks for all active hosts ───────────────────────────

export async function runAllChecks(
  prisma: PrismaClient,
  fetcher: SpotCheckFetcher = defaultFetcher,
): Promise<CheckSummary> {
  const epoch = currentEpoch();

  // Get all hosts that should be checked
  const hosts = await prisma.host.findMany({
    where: {
      status: { notIn: ["UNBONDING", "SLASHED"] },
      endpoint: { not: null },
    },
    select: { pubkey: true },
  });

  const results: SpotCheckResult[] = [];
  let checkedHosts = 0;
  let passedHosts = 0;
  let failedHosts = 0;
  let skippedHosts = 0;

  for (const host of hosts) {
    const result = await spotCheckHost(prisma, host.pubkey, fetcher);

    if (!result) {
      skippedHosts++;
      continue;
    }

    checkedHosts++;
    if (result.passed) passedHosts++;
    else failedHosts++;

    // Record the check
    await recordCheck(prisma, result, epoch);
    results.push(result);
  }

  // Update scores and statuses for all checked hosts
  await updateAllScores(prisma);

  return {
    totalHosts: hosts.length,
    checkedHosts,
    passedHosts,
    failedHosts,
    skippedHosts,
    results,
  };
}

// ── Recompute scores and apply status transitions ──────────────────

export async function updateAllScores(
  prisma: PrismaClient,
): Promise<void> {
  const epoch = currentEpoch();

  // Get all non-UNBONDING/SLASHED hosts
  const hosts = await prisma.host.findMany({
    where: {
      status: { notIn: ["UNBONDING", "SLASHED"] },
    },
    select: { pubkey: true },
  });

  for (const host of hosts) {
    const checks = await getHostChecks(prisma, host.pubkey);

    const assessment = computeAvailabilityScore(checks, epoch);

    // updateAvailability handles status transitions
    await updateAvailability(prisma, host.pubkey, assessment.score);
  }
}
