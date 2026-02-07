/**
 * Availability score computation — pure functions.
 * DocRef: MVP_PLAN:§Enforcement: Earning Decay, §Availability Score
 *
 * availability_score(host, epoch) =
 *   successful_checks / total_checks   (rolling window: last 6 epochs)
 *
 * TRUSTED threshold:  score >= 0.6
 * DEGRADED threshold: score < 0.6
 * INACTIVE threshold: score == 0.0 for 6 consecutive epochs
 */

// ── Types ──────────────────────────────────────────────────────────

export interface CheckResult {
  passed: boolean;
  epoch: number;
}

export interface AvailabilityAssessment {
  score: number;
  totalChecks: number;
  passedChecks: number;
  /** Recommended status based on score. */
  recommendedStatus: "TRUSTED" | "DEGRADED" | "INACTIVE";
}

// ── Constants ──────────────────────────────────────────────────────

/** Rolling window for availability score (6 epochs = 24h). */
export const AVAILABILITY_WINDOW_EPOCHS = 6;

/** Score threshold for TRUSTED status (payout eligible). */
export const AVAILABILITY_TRUSTED_THRESHOLD = 0.6;

/** Consecutive zero-score epochs before INACTIVE. */
export const INACTIVE_ZERO_EPOCHS = 6;

// ── Score Computation ──────────────────────────────────────────────

/**
 * Compute availability score from check results within the window.
 *
 * @param checks - All check results (will be filtered to window)
 * @param currentEpoch - The current epoch number
 * @returns Assessment with score, counts, and recommended status
 */
export function computeAvailabilityScore(
  checks: readonly CheckResult[],
  currentEpoch: number,
): AvailabilityAssessment {
  const windowStart = Math.max(0, currentEpoch - AVAILABILITY_WINDOW_EPOCHS);

  const windowChecks = checks.filter(
    (c) => c.epoch >= windowStart && c.epoch <= currentEpoch,
  );

  if (windowChecks.length === 0) {
    return {
      score: 0,
      totalChecks: 0,
      passedChecks: 0,
      recommendedStatus: "INACTIVE",
    };
  }

  const passed = windowChecks.filter((c) => c.passed).length;
  const score = passed / windowChecks.length;

  let recommendedStatus: "TRUSTED" | "DEGRADED" | "INACTIVE";
  if (score >= AVAILABILITY_TRUSTED_THRESHOLD) {
    recommendedStatus = "TRUSTED";
  } else if (score > 0) {
    recommendedStatus = "DEGRADED";
  } else {
    recommendedStatus = "INACTIVE";
  }

  return {
    score,
    totalChecks: windowChecks.length,
    passedChecks: passed,
    recommendedStatus,
  };
}
