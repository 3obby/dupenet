/**
 * Epoch utilities.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards
 *
 * EPOCH_LENGTH = 4h. 6 payout cycles/day.
 */

import { EPOCH_LENGTH_MS } from "./constants.js";

/** Protocol genesis timestamp (set on first deploy). */
let genesisTimestamp = 0;

export function setGenesisTimestamp(ts: number): void {
  genesisTimestamp = ts;
}

export function getGenesisTimestamp(): number {
  return genesisTimestamp;
}

/** Compute epoch number from a timestamp. */
export function epochFromTimestamp(
  timestampMs: number,
  genesis: number = genesisTimestamp,
): number {
  if (timestampMs < genesis) return 0;
  return Math.floor((timestampMs - genesis) / EPOCH_LENGTH_MS);
}

/** Get the current epoch number. */
export function currentEpoch(genesis: number = genesisTimestamp): number {
  return epochFromTimestamp(Date.now(), genesis);
}

/** Get epoch start timestamp in ms. */
export function epochStartMs(
  epoch: number,
  genesis: number = genesisTimestamp,
): number {
  return genesis + epoch * EPOCH_LENGTH_MS;
}

/** Get epoch end timestamp in ms. */
export function epochEndMs(
  epoch: number,
  genesis: number = genesisTimestamp,
): number {
  return genesis + (epoch + 1) * EPOCH_LENGTH_MS;
}
