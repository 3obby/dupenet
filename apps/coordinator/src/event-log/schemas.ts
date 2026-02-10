/**
 * Event log schemas — signed append-only events.
 * DocRef: MVP_PLAN:§Longevity L4
 *
 * Every mutation is a signed event. The bounty ledger, host registry,
 * and pin contracts are materialized views over this log.
 * Anyone can replay the log and reconstruct state.
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

/** Base envelope for all protocol events. */
export const EventEnvelope = Type.Object({
  /** Event type discriminator. */
  type: Type.String(),
  /** Monotonic sequence number within the log. */
  seq: Type.Integer({ minimum: 0 }),
  /** Event timestamp (ms since epoch). */
  timestamp: Type.Integer({ minimum: 0 }),
  /** Signer's public key. */
  signer: Hex32,
  /** Ed25519 signature over canonical(payload). */
  sig: Type.String(),
  /** Event-specific payload. */
  payload: Type.Unknown(),
});

export type EventEnvelope = Static<typeof EventEnvelope>;

// ── Event types ────────────────────────────────────────────────────

export const TIP_EVENT = "tip.v1" as const;
export const PIN_CREATE_EVENT = "pin.create.v1" as const;
export const PIN_CANCEL_EVENT = "pin.cancel.v1" as const;
export const HOST_REGISTER_EVENT = "host.register.v1" as const;
export const HOST_UNBOND_EVENT = "host.unbond.v1" as const;
export const RECEIPT_SUBMIT_EVENT = "receipt.submit.v1" as const;
export const EPOCH_SUMMARY_EVENT = "epoch.summary.v1" as const;
export const REFUSAL_EVENT = "refusal.v1" as const;
export const PROTOCOL_EVENT = "event.v1" as const;
