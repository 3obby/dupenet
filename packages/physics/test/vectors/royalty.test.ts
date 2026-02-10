/**
 * Founder royalty formula tests.
 * DocRef: MVP_PLAN:§Founder Royalty
 *
 * r(v) = R0 × (1 + v / V_STAR)^(-ALPHA)
 * R0 = 0.15, V_STAR = 125_000_000, ALPHA = log(2)/log(9) ≈ 0.3155
 */

import { describe, it, expect } from "vitest";
import {
  founderRoyaltyRate,
  computeRoyalty,
  cumulativeFounderIncome,
  FOUNDER_ROYALTY_R0,
} from "../../src/index.js";

describe("founderRoyaltyRate", () => {
  it("returns R0 (15%) at genesis (v=0)", () => {
    expect(founderRoyaltyRate(0)).toBeCloseTo(0.15, 6);
  });

  it("decreases at 1 BTC cumulative volume", () => {
    // 1 BTC = 100M sats. V_STAR = 125M. Rate should be between 10-13%.
    const rate = founderRoyaltyRate(100_000_000);
    expect(rate).toBeLessThan(FOUNDER_ROYALTY_R0);
    expect(rate).toBeGreaterThan(0.10);
    expect(rate).toBeLessThan(0.13);
  });

  it("returns ~7.5% at 10 BTC cumulative", () => {
    // 10 BTC = 1B sats
    const rate = founderRoyaltyRate(1_000_000_000);
    expect(rate).toBeCloseTo(0.075, 2);
  });

  it("returns ~3.75% at 100 BTC cumulative", () => {
    // 100 BTC = 10B sats
    const rate = founderRoyaltyRate(10_000_000_000);
    expect(rate).toBeCloseTo(0.0375, 2);
  });

  it("returns ~1.82% at 1000 BTC cumulative", () => {
    // 1000 BTC = 100B sats
    const rate = founderRoyaltyRate(100_000_000_000);
    expect(rate).toBeCloseTo(0.0182, 2);
  });

  it("approaches zero at extreme volume", () => {
    const rate = founderRoyaltyRate(1e15); // 10M BTC worth
    expect(rate).toBeLessThan(0.005);
    expect(rate).toBeGreaterThan(0);
  });

  it("is monotonically decreasing", () => {
    const volumes = [0, 1000, 100_000, 10_000_000, 1_000_000_000, 100_000_000_000];
    for (let i = 1; i < volumes.length; i++) {
      expect(founderRoyaltyRate(volumes[i]!)).toBeLessThan(
        founderRoyaltyRate(volumes[i - 1]!),
      );
    }
  });

  it("never returns negative", () => {
    expect(founderRoyaltyRate(0)).toBeGreaterThanOrEqual(0);
    expect(founderRoyaltyRate(1e18)).toBeGreaterThanOrEqual(0);
  });
});

describe("computeRoyalty", () => {
  it("at genesis: 15% of 1000 sats = 150 royalty, 850 pool", () => {
    const { royalty, poolCredit } = computeRoyalty(1000, 0);
    expect(royalty).toBe(150); // floor(1000 * 0.15)
    expect(poolCredit).toBe(850);
    expect(royalty + poolCredit).toBe(1000);
  });

  it("royalty + poolCredit always equals amount", () => {
    const amounts = [1, 21, 100, 999, 10000, 1_000_000];
    const volumes = [0, 50_000_000, 500_000_000, 50_000_000_000];
    for (const amount of amounts) {
      for (const volume of volumes) {
        const { royalty, poolCredit } = computeRoyalty(amount, volume);
        expect(royalty + poolCredit).toBe(amount);
      }
    }
  });

  it("royalty is always non-negative", () => {
    const { royalty } = computeRoyalty(1, 0);
    expect(royalty).toBeGreaterThanOrEqual(0);
  });

  it("handles amount of 0 gracefully", () => {
    const { royalty, poolCredit } = computeRoyalty(0, 0);
    expect(royalty).toBe(0);
    expect(poolCredit).toBe(0);
  });

  it("royalty decreases as volume increases", () => {
    const r1 = computeRoyalty(10000, 0);
    const r2 = computeRoyalty(10000, 10_000_000_000);
    expect(r2.royalty).toBeLessThan(r1.royalty);
  });
});

describe("cumulativeFounderIncome", () => {
  it("returns 0 at genesis", () => {
    expect(cumulativeFounderIncome(0)).toBeCloseTo(0, 6);
  });

  it("is monotonically increasing", () => {
    const volumes = [0, 1000, 100_000, 10_000_000, 1_000_000_000];
    for (let i = 1; i < volumes.length; i++) {
      expect(cumulativeFounderIncome(volumes[i]!)).toBeGreaterThan(
        cumulativeFounderIncome(volumes[i - 1]!),
      );
    }
  });

  it("at 100 BTC cumulative: founder income ~5.27 BTC", () => {
    // Plan says: at 100 BTC (10B sats), cumulative founder income ≈ 5.27 BTC (527M sats)
    const income = cumulativeFounderIncome(10_000_000_000);
    expect(income / 100_000_000).toBeCloseTo(5.27, 0); // within ~1 BTC
  });
});
