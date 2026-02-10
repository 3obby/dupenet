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

// ── Founder Royalty (volume-tapering, frozen in genesis config) ─────
// DocRef: MVP_PLAN:§Founder Royalty
// r(v) = R0 × (1 + v / V_STAR)^(-ALPHA)
// Rate halves every ~10× cumulative volume. Volume-based, not time-based.
export const FOUNDER_ROYALTY_R0 = 0.15; // 15% at genesis
export const FOUNDER_ROYALTY_V_STAR = 125_000_000; // 1.25 BTC — scale constant
export const FOUNDER_ROYALTY_ALPHA = Math.log(2) / Math.log(9); // ≈ 0.3155

// ── Tunable (epoch-boundary changes) ───────────────────────────────
export const EPOCH_LENGTH_MS = 4 * 60 * 60_000; // 4h
export const OPERATOR_STAKE_SATS = 2_100;
export const UNBONDING_PERIOD_DAYS = 7;

export const RECEIPT_MIN_COUNT = 5;
export const RECEIPT_MIN_UNIQUE_CLIENTS = 3;

export const POW_TARGET_BASE = 2n ** 240n; // ~200ms on mobile (receipt PoW)
export const POW_ESCALATION_THRESHOLD = 8; // receipts/day before difficulty ramps
export const EVENT_POW_TARGET = 2n ** 240n; // ~200ms on mobile (event PoW, prefix "EV1_POW")

export const EPOCH_REWARD_PCT = 0.02; // 2% of bounty per CID per epoch
export const EPOCH_REWARD_BASE_SATS = 50;
export const AGGREGATOR_FEE_PCT = 0.03; // 3% — MVP default, market-determined post-MVP

export const MIN_REQUEST_SATS = 3;
export const SATS_PER_GB_DEFAULT = 500;
export const BURST_SATS_PER_GB = 2_000; // 4× surge pricing
export const MIN_BOUNTY_SATS_DEFAULT = 50; // default host profitability threshold
export const OPEN_MIN_POOL_SATS_DEFAULT = 500; // default open-access serving threshold

export const PIN_MIN_BUDGET_SATS = 210;
export const PIN_MAX_COPIES = 20;
export const PIN_CANCEL_FEE_PCT = 0.05; // 5%

export const AUDIT_REWARD_PCT = 0.30; // 30%

// ── EventV1 Kind Bytes ─────────────────────────────────────────────
export const EVENT_KIND_FUND = 0x01; // Fund a pool (replaces TipV1)
export const EVENT_KIND_ANNOUNCE = 0x02; // Announce asset with metadata
export const EVENT_KIND_POST = 0x03; // Threaded text (reply/root)
export const EVENT_KIND_HOST = 0x04; // Host registration/update
export const EVENT_KIND_REFUSAL = 0x05; // Operator content refusal
export const EVENT_KIND_ATTEST = 0x06; // Operator attestation
export const EVENT_KIND_LIST = 0x07; // Collection of refs
export const EVENT_KIND_PIN_POLICY = 0x08; // Pin policy (durability SLA)
export const EVENT_KIND_MATERIALIZER = 0x09; // Materializer registration

export const FREE_PREVIEW_MAX_BYTES = 16_384; // 16 KiB — max block served without L402
export const EVENT_MAX_BODY = 16_384; // 16 KiB — max EventV1.body size
export const MAX_LIST_ITEMS = 1_000; // cap items per kind=LIST event

// Score weights for epoch reward distribution
export const W_CLIENTS = 0.5;
export const W_UPTIME = 0.3;
export const W_DIVERSITY = 0.2;
