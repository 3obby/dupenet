/**
 * Golden test vectors — epoch reward formula.
 * These vectors verify the log-scaled cap and score-weighted distribution.
 * DocRef: MVP_PLAN:§Reward Formula
 *
 * Economics rework (2026-02-10):
 *   - HostScore now has payoutWeight (not uniqueClients).
 *   - computeHostScore = payoutWeight × (W_UPTIME × uptime + W_DIVERSITY × diversity).
 */

import { describe, it, expect } from "vitest";
import { cidEpochCap, distributeRewards, computeHostScore } from "../../src/reward.js";

describe("epoch reward formula", () => {
  it("zero bounty → zero cap", () => {
    expect(cidEpochCap(0)).toBe(0);
  });

  it("small bounty: cap is 2% of pool", () => {
    // 100 sats bounty → 2% = 2 sats, log cap = 50 * (1 + floor(log2(100/50 + 1))) = 50 * 2 = 100
    // min(2, 100) = 2
    expect(cidEpochCap(100)).toBe(2);
  });

  it("medium bounty: cap scales logarithmically", () => {
    // 2500 sats → 2% = 50, log cap = 50 * (1 + floor(log2(2500/50 + 1))) = 50 * (1 + 5) = 300
    // min(50, 300) = 50
    expect(cidEpochCap(2500)).toBe(50);
  });

  it("large bounty: log cap becomes binding", () => {
    // 100000 sats → 2% = 2000, log cap = 50 * (1 + floor(log2(100000/50 + 1))) = 50 * (1 + 10) = 550
    // min(2000, 550) = 550
    const cap = cidEpochCap(100000);
    expect(cap).toBeLessThan(2000); // log cap is binding
    expect(cap).toBeGreaterThan(100); // still meaningful
  });

  it("massive bounty acts as endowment (slow drain)", () => {
    // 1M sats → 2% = 20000, log cap should be much smaller
    const cap = cidEpochCap(1_000_000);
    expect(cap).toBeLessThan(1000);
  });

  it("distribute rewards: single host gets full cap minus aggregator fee", () => {
    // payoutWeight = totalProvenSats * (1 + log2(uniqueClients))
    // For 5 clients, 15 sats: weight = 15 * (1 + log2(5)) ≈ 15 * 3.32 ≈ 49.8
    const hosts = [{ payoutWeight: 50, uptimeRatio: 1.0, diversityContribution: 1.0 }];
    const rewards = distributeRewards(2500, hosts);
    // Cap = 50, after 3% fee = 48.5 → floor = 48
    expect(rewards[0]).toBe(48);
  });

  it("distribute rewards: two equal hosts split evenly", () => {
    const hosts = [
      { payoutWeight: 50, uptimeRatio: 1.0, diversityContribution: 1.0 },
      { payoutWeight: 50, uptimeRatio: 1.0, diversityContribution: 1.0 },
    ];
    const rewards = distributeRewards(2500, hosts);
    expect(rewards[0]).toBe(rewards[1]);
  });

  it("distribute rewards: higher payoutWeight host gets more", () => {
    const hosts = [
      { payoutWeight: 200, uptimeRatio: 1.0, diversityContribution: 1.0 },
      { payoutWeight: 50, uptimeRatio: 0.7, diversityContribution: 0.5 },
    ];
    const rewards = distributeRewards(2500, hosts);
    expect(rewards[0]!).toBeGreaterThan(rewards[1]!);
  });

  it("distribute rewards: higher uptime gets more (equal payoutWeight)", () => {
    const hosts = [
      { payoutWeight: 100, uptimeRatio: 1.0, diversityContribution: 1.0 },
      { payoutWeight: 100, uptimeRatio: 0.5, diversityContribution: 1.0 },
    ];
    const rewards = distributeRewards(2500, hosts);
    expect(rewards[0]!).toBeGreaterThan(rewards[1]!);
  });

  it("distribute rewards: no hosts → empty array", () => {
    expect(distributeRewards(2500, [])).toEqual([]);
  });
});

describe("computeHostScore (multiplicative formula)", () => {
  it("zero payoutWeight → zero score regardless of quality", () => {
    expect(computeHostScore({ payoutWeight: 0, uptimeRatio: 1.0, diversityContribution: 1.0 })).toBe(0);
  });

  it("zero quality → zero score regardless of payoutWeight", () => {
    expect(computeHostScore({ payoutWeight: 100, uptimeRatio: 0, diversityContribution: 0 })).toBe(0);
  });

  it("perfect quality: score = payoutWeight × (0.6 + 0.4) = payoutWeight", () => {
    // W_UPTIME=0.6, W_DIVERSITY=0.4 → 0.6*1 + 0.4*1 = 1.0
    expect(computeHostScore({ payoutWeight: 100, uptimeRatio: 1.0, diversityContribution: 1.0 })).toBe(100);
  });

  it("half uptime: score = payoutWeight × (0.6×0.5 + 0.4×1.0) = payoutWeight × 0.7", () => {
    expect(computeHostScore({ payoutWeight: 100, uptimeRatio: 0.5, diversityContribution: 1.0 })).toBeCloseTo(70, 6);
  });

  it("score is proportional to payoutWeight", () => {
    const s1 = computeHostScore({ payoutWeight: 100, uptimeRatio: 1.0, diversityContribution: 1.0 });
    const s2 = computeHostScore({ payoutWeight: 200, uptimeRatio: 1.0, diversityContribution: 1.0 });
    expect(s2).toBeCloseTo(s1 * 2, 6);
  });

  it("score is continuous (no cliffs)", () => {
    const weights = [1, 2, 3, 5, 10, 50, 100];
    const scores = weights.map((w) =>
      computeHostScore({ payoutWeight: w, uptimeRatio: 0.8, diversityContribution: 0.9 }),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    }
  });
});
