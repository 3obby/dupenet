/**
 * Frozen protocol constants.
 * DocRef: MVP_PLAN:§Constants (Tunable), SPEC:§Freeze Layers
 *
 * FROZEN constants never change — breaking change = hard fork.
 * TUNABLE constants change at epoch boundaries via coordinator config.
 */

// ── Frozen (never change) ──────────────────────────────────────────
export const CHUNK_SIZE_DEFAULT = 262_144; // 256 KiB
export const MAX_MANIFEST_BLOCKS = 32_768; // ~8GB max file at 256KiB chunks
export const MAX_ASSET_VARIANTS = 8;
export const RECEIPT_VERSION = 2; // "R2" prefix in token signing

// ── Tunable (epoch-boundary changes) ───────────────────────────────
export const EPOCH_LENGTH_MS = 4 * 60 * 60_000; // 4h
export const OPERATOR_STAKE_SATS = 2_100;
export const UNBONDING_PERIOD_DAYS = 7;

export const RECEIPT_MIN_COUNT = 5;
export const RECEIPT_MIN_UNIQUE_CLIENTS = 3;

export const POW_TARGET_BASE = 2n ** 240n; // ~200ms on mobile
export const POW_ESCALATION_THRESHOLD = 8; // receipts/day before difficulty ramps

export const EPOCH_REWARD_PCT = 0.02; // 2% of bounty per CID per epoch
export const EPOCH_REWARD_BASE_SATS = 50;
export const AGGREGATOR_FEE_PCT = 0.03; // 3%
export const TIP_PROTOCOL_FEE_PCT = 0.05; // 5%

export const MIN_REQUEST_SATS = 3;
export const SATS_PER_GB_DEFAULT = 500;

export const PIN_MIN_BUDGET_SATS = 210;
export const PIN_MAX_COPIES = 20;
export const PIN_CANCEL_FEE_PCT = 0.05; // 5%

export const AUDIT_REWARD_PCT = 0.30; // 30%

// Score weights for epoch reward distribution
export const W_CLIENTS = 0.5;
export const W_UPTIME = 0.3;
export const W_DIVERSITY = 0.2;

// Protocol fee decay
export const PROTOCOL_FEE_HALVING_YEARS = 4;
export const PROTOCOL_FEE_SUNSET_YEARS = 20;
