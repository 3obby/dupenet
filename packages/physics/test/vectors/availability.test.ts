/**
 * Golden test vectors — availability score computation.
 * DocRef: MVP_PLAN:§Availability Score
 */

import { describe, it, expect } from "vitest";
import {
  computeAvailabilityScore,
  AVAILABILITY_TRUSTED_THRESHOLD,
  type CheckResult,
} from "../../src/availability.js";

describe("computeAvailabilityScore", () => {
  it("no checks → score 0, INACTIVE", () => {
    const result = computeAvailabilityScore([], 10);
    expect(result.score).toBe(0);
    expect(result.totalChecks).toBe(0);
    expect(result.recommendedStatus).toBe("INACTIVE");
  });

  it("all checks pass → score 1.0, TRUSTED", () => {
    const checks: CheckResult[] = [
      { passed: true, epoch: 8 },
      { passed: true, epoch: 9 },
      { passed: true, epoch: 10 },
    ];
    const result = computeAvailabilityScore(checks, 10);
    expect(result.score).toBe(1.0);
    expect(result.passedChecks).toBe(3);
    expect(result.recommendedStatus).toBe("TRUSTED");
  });

  it("all checks fail → score 0, INACTIVE", () => {
    const checks: CheckResult[] = [
      { passed: false, epoch: 8 },
      { passed: false, epoch: 9 },
    ];
    const result = computeAvailabilityScore(checks, 10);
    expect(result.score).toBe(0);
    expect(result.recommendedStatus).toBe("INACTIVE");
  });

  it("3/5 checks pass → score 0.6, TRUSTED (at threshold)", () => {
    const checks: CheckResult[] = [
      { passed: true, epoch: 6 },
      { passed: false, epoch: 7 },
      { passed: true, epoch: 8 },
      { passed: false, epoch: 9 },
      { passed: true, epoch: 10 },
    ];
    const result = computeAvailabilityScore(checks, 10);
    expect(result.score).toBe(0.6);
    expect(result.recommendedStatus).toBe("TRUSTED");
  });

  it("2/5 checks pass → score 0.4, DEGRADED", () => {
    const checks: CheckResult[] = [
      { passed: true, epoch: 6 },
      { passed: false, epoch: 7 },
      { passed: false, epoch: 8 },
      { passed: false, epoch: 9 },
      { passed: true, epoch: 10 },
    ];
    const result = computeAvailabilityScore(checks, 10);
    expect(result.score).toBe(0.4);
    expect(result.recommendedStatus).toBe("DEGRADED");
  });

  it("filters to 6-epoch window only", () => {
    const checks: CheckResult[] = [
      { passed: false, epoch: 1 }, // outside window
      { passed: false, epoch: 2 }, // outside window
      { passed: false, epoch: 3 }, // outside window
      { passed: true, epoch: 5 },  // inside window (10-6=4, epoch 5 >= 4)
      { passed: true, epoch: 8 },
      { passed: true, epoch: 10 },
    ];
    const result = computeAvailabilityScore(checks, 10);
    // Only epochs 5, 8, 10 are in window (>= 4)
    expect(result.totalChecks).toBe(3);
    expect(result.score).toBe(1.0);
  });

  it("threshold is exactly 0.6", () => {
    expect(AVAILABILITY_TRUSTED_THRESHOLD).toBe(0.6);
  });

  it("single pass → score 1.0, TRUSTED", () => {
    const result = computeAvailabilityScore(
      [{ passed: true, epoch: 10 }],
      10,
    );
    expect(result.score).toBe(1.0);
    expect(result.recommendedStatus).toBe("TRUSTED");
  });

  it("single fail → score 0, INACTIVE", () => {
    const result = computeAvailabilityScore(
      [{ passed: false, epoch: 10 }],
      10,
    );
    expect(result.score).toBe(0);
    expect(result.recommendedStatus).toBe("INACTIVE");
  });
});
