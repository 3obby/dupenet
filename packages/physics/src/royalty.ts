/**
 * Founder royalty — volume-tapering protocol fee.
 * DocRef: MVP_PLAN:§Founder Royalty
 *
 * r(v) = R0 × (1 + v / V_STAR)^(-ALPHA)
 *
 * Rate halves every ~10× of cumulative volume. Volume-based, not time-based.
 * Deducted at pool credit time: when event.sats > 0, royalty is subtracted
 * before crediting pool[ref]. 100% to founder pubkey.
 */

import {
  FOUNDER_ROYALTY_R0,
  FOUNDER_ROYALTY_V_STAR,
  FOUNDER_ROYALTY_ALPHA,
} from "./constants.js";

/**
 * Compute the current royalty rate given cumulative volume.
 * @param cumulativeVolume - total sats credited to all pools since genesis
 * @returns royalty rate in [0, R0] (e.g. 0.15 = 15%)
 */
export function founderRoyaltyRate(cumulativeVolume: number): number {
  if (cumulativeVolume < 0) cumulativeVolume = 0;
  return (
    FOUNDER_ROYALTY_R0 *
    Math.pow(1 + cumulativeVolume / FOUNDER_ROYALTY_V_STAR, -FOUNDER_ROYALTY_ALPHA)
  );
}

/**
 * Compute royalty amount for a given tip/fund amount.
 * @param amount - sats being credited
 * @param cumulativeVolume - total sats credited to all pools since genesis
 * @returns { royalty, poolCredit } — royalty goes to founder, remainder to pool
 */
export function computeRoyalty(
  amount: number,
  cumulativeVolume: number,
): { royalty: number; poolCredit: number } {
  if (amount <= 0) return { royalty: 0, poolCredit: 0 };
  const rate = founderRoyaltyRate(cumulativeVolume);
  const royalty = Math.floor(amount * rate);
  const poolCredit = amount - royalty;
  return { royalty, poolCredit };
}

/**
 * Compute cumulative founder income at a given volume.
 * I(V) = (R0 × V_STAR) / (1 - ALPHA) × [(1 + V/V_STAR)^(1 - ALPHA) - 1]
 */
export function cumulativeFounderIncome(cumulativeVolume: number): number {
  const exp = 1 - FOUNDER_ROYALTY_ALPHA;
  return (
    ((FOUNDER_ROYALTY_R0 * FOUNDER_ROYALTY_V_STAR) / exp) *
    (Math.pow(1 + cumulativeVolume / FOUNDER_ROYALTY_V_STAR, exp) - 1)
  );
}
