/**
 * Epoch boundary scheduler — auto-settles closed epochs.
 * DocRef: MVP_PLAN:§Epoch-Based Rewards
 *
 * Checks every `checkIntervalMs` whether a new epoch has started.
 * When the epoch advances, settles the previous epoch automatically.
 *
 * Design:
 *   - Tracks `lastSettledEpoch` to avoid redundant work
 *   - settleEpoch() is already idempotent, so double-calls are safe
 *   - Logs settlement results
 *   - Optionally runs spot-checks after settlement
 */

import type { PrismaClient } from "@prisma/client";
import { currentEpoch } from "@dupenet/physics";
import { settleEpoch, type SettlementResult } from "./views/epoch-settlement.js";
import { runAllChecks, type SpotCheckFetcher } from "./views/availability.js";

export interface SchedulerOptions {
  /** How often to check for epoch boundary (ms). Default: 60_000 (1 min). */
  checkIntervalMs?: number;
  /** Run spot-checks after epoch settlement. Default: true. */
  runSpotChecks?: boolean;
  /** Injectable fetcher for spot-checks. */
  spotCheckFetcher?: SpotCheckFetcher;
  /** Callback for settlement events (for logging/monitoring). */
  onSettle?: (result: SettlementResult) => void;
  /** Callback for errors. */
  onError?: (error: unknown) => void;
}

export interface EpochScheduler {
  /** Start the scheduler. */
  start(): void;
  /** Stop the scheduler. */
  stop(): void;
  /** Get the last settled epoch. */
  lastSettledEpoch(): number;
  /** Manually trigger a check (useful for testing). */
  tick(): Promise<SettlementResult | null>;
}

const DEFAULT_CHECK_INTERVAL_MS = 60_000; // 1 minute

/**
 * Create an epoch boundary scheduler.
 *
 * Checks periodically whether the epoch has advanced.
 * When it detects a new epoch, settles the previous one.
 */
export function createEpochScheduler(
  prisma: PrismaClient,
  options: SchedulerOptions = {},
): EpochScheduler {
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const runSpotChecks = options.runSpotChecks ?? true;
  const onSettle = options.onSettle;
  const onError = options.onError ?? ((err) => console.error("[scheduler] error:", err));

  let timer: ReturnType<typeof setInterval> | null = null;
  let _lastSettledEpoch = -1;

  /**
   * Single tick: check if epoch advanced, settle if needed.
   */
  async function tick(): Promise<SettlementResult | null> {
    const epoch = currentEpoch();

    // The epoch to settle is (current - 1), since current is still open
    const epochToSettle = epoch - 1;

    if (epochToSettle < 0) return null;
    if (epochToSettle <= _lastSettledEpoch) return null;

    try {
      const result = await settleEpoch(prisma, epochToSettle);
      _lastSettledEpoch = epochToSettle;

      if (onSettle) onSettle(result);

      // Optionally run spot-checks after settlement
      if (runSpotChecks) {
        try {
          await runAllChecks(prisma, options.spotCheckFetcher);
        } catch (err) {
          onError(err);
        }
      }

      return result;
    } catch (err) {
      onError(err);
      return null;
    }
  }

  return {
    start() {
      if (timer) return; // already running

      // Initialize lastSettledEpoch to current-1 to avoid settling old epochs on startup
      // (they should already be settled; settleEpoch is idempotent anyway)
      const epoch = currentEpoch();
      if (_lastSettledEpoch < 0) {
        _lastSettledEpoch = epoch - 2; // settle the most recent closed epoch on first tick
      }

      timer = setInterval(async () => {
        await tick();
      }, checkIntervalMs);

      // Immediate first tick
      void tick();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    lastSettledEpoch() {
      return _lastSettledEpoch;
    },

    tick,
  };
}
