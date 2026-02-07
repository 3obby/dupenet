/**
 * Epoch reward computation.
 * DocRef: MVP_PLAN:§Reward Formula, §Epoch-Based Rewards
 *
 * Per-CID per-epoch cap scales logarithmically with bounty,
 * then splits among eligible hosts by score.
 */

import {
  EPOCH_REWARD_PCT,
  EPOCH_REWARD_BASE_SATS,
  W_CLIENTS,
  W_UPTIME,
  W_DIVERSITY,
  AGGREGATOR_FEE_PCT,
} from "./constants.js";

/**
 * Compute the per-CID epoch cap.
 * Large bounties act as endowments: log-scaled cap prevents fast drain.
 */
export function cidEpochCap(bountyBalance: number): number {
  const pctCap = bountyBalance * EPOCH_REWARD_PCT;
  const logCap =
    EPOCH_REWARD_BASE_SATS *
    (1 + Math.floor(Math.log2(bountyBalance / EPOCH_REWARD_BASE_SATS + 1)));
  return Math.min(pctCap, logCap);
}

export interface HostScore {
  uniqueClients: number;
  uptimeRatio: number; // 0.0 - 1.0
  diversityContribution: number; // 0.0 - 1.0
}

/**
 * Compute a host's weighted score for reward distribution.
 */
export function computeHostScore(s: HostScore): number {
  return (
    W_CLIENTS * s.uniqueClients +
    W_UPTIME * s.uptimeRatio +
    W_DIVERSITY * s.diversityContribution
  );
}

/**
 * Compute reward for each host for a given CID in an epoch.
 * Returns per-host payout in sats (after aggregator fee).
 */
export function distributeRewards(
  bountyBalance: number,
  hosts: readonly HostScore[],
): number[] {
  if (hosts.length === 0) return [];

  const cap = cidEpochCap(bountyBalance);
  if (cap <= 0) return hosts.map(() => 0);

  const scores = hosts.map(computeHostScore);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);

  if (totalScore <= 0) return hosts.map(() => 0);

  const afterFee = cap * (1 - AGGREGATOR_FEE_PCT);

  return scores.map((s) => Math.floor((afterFee * s) / totalScore));
}
