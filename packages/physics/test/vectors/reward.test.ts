/**
 * Golden test vectors — epoch reward formula.
 * These vectors verify the log-scaled cap and score-weighted distribution.
 * DocRef: MVP_PLAN:§Reward Formula
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
    const hosts = [{ uniqueClients: 5, uptimeRatio: 1.0, diversityContribution: 1.0 }];
    const rewards = distributeRewards(2500, hosts);
    // Cap = 50, after 3% fee = 48.5 → floor = 48
    expect(rewards[0]).toBe(48);
  });

  it("distribute rewards: two equal hosts split evenly", () => {
    const hosts = [
      { uniqueClients: 5, uptimeRatio: 1.0, diversityContribution: 1.0 },
      { uniqueClients: 5, uptimeRatio: 1.0, diversityContribution: 1.0 },
    ];
    const rewards = distributeRewards(2500, hosts);
    expect(rewards[0]).toBe(rewards[1]);
  });

  it("distribute rewards: higher-scoring host gets more", () => {
    const hosts = [
      { uniqueClients: 10, uptimeRatio: 1.0, diversityContribution: 1.0 },
      { uniqueClients: 3, uptimeRatio: 0.7, diversityContribution: 0.5 },
    ];
    const rewards = distributeRewards(2500, hosts);
    expect(rewards[0]!).toBeGreaterThan(rewards[1]!);
  });

  it("distribute rewards: no hosts → empty array", () => {
    expect(distributeRewards(2500, [])).toEqual([]);
  });
});
