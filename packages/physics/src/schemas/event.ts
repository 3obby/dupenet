/**
 * EventV1 — the universal event envelope.
 * DocRef: MVP_PLAN:§Event Layer, §Protocol vs Materializer Boundary
 *
 * Every non-blob, non-receipt protocol action is an EventV1.
 * Kind byte determines payload interpretation (materializer convention).
 * Protocol rule: if event.sats > 0, credit pool[event.ref] += sats (minus royalty).
 *
 * event_id = SHA256(canonical(EventV1 minus sig))
 * sig = Ed25519(private_key, canonical(EventV1 minus sig))
 */

import { Type, type Static } from "@sinclair/typebox";
import {
  EVENT_MAX_BODY,
  MAX_LIST_ITEMS,
} from "../constants.js";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

// ── EventV1 Envelope ───────────────────────────────────────────────

export const EventV1 = Type.Object(
  {
    /** Version byte. Always 1. */
    v: Type.Literal(1),
    /** Kind byte (0x00–0xFF). Determines body interpretation. */
    kind: Type.Integer({ minimum: 0, maximum: 255 }),
    /** Signer's Ed25519 public key (32 bytes, hex). */
    from: Hex32,
    /** Reference — CID, event_id, or topic hash. Zero-filled if none. */
    ref: Hex32,
    /** Inline body — hex-encoded bytes, kind-specific payload. ≤ EVENT_MAX_BODY bytes. */
    body: Type.String({ maxLength: EVENT_MAX_BODY * 2 }),
    /** Economic weight in sats. 0 = free statement, >0 = pool credit. */
    sats: Type.Integer({ minimum: 0 }),
    /** Timestamp in milliseconds since Unix epoch. */
    ts: Type.Integer({ minimum: 0 }),
    /** Ed25519 signature (base64) over canonical(EventV1 minus sig). */
    sig: Type.String(),
  },
  { additionalProperties: false },
);

export type EventV1 = Static<typeof EventV1>;

// ── Kind Payload Schemas (materializer conventions) ────────────────
// These define the structured payload inside EventV1.body (CBOR-encoded).
// Protocol treats body as opaque bytes — these are materializer conventions.

/** Access mode for announced content. */
export const AccessMode = Type.Union([
  Type.Literal("open"),
  Type.Literal("paid"),
]);

export type AccessMode = Static<typeof AccessMode>;

/**
 * AnnouncePayload — kind=ANNOUNCE (0x02).
 * Announce an asset with human-readable metadata.
 * ref = asset_root CID.
 *
 * Author attribution:
 *   author_pubkey — Ed25519 pubkey (hex) of the content creator.
 *     Distinct from `from` (which is the event signer / uploader).
 *     Allows: A uploads content on behalf of B (B = author, A = publisher).
 *     If omitted, `from` is assumed to be the author.
 *
 *   revshare_bps — basis points (0–10000) of third-party revenue shared with author.
 *     Only third-party payments qualify (events where from != author_pubkey).
 *     Materializer-enforced convention, not protocol.
 *     Default 0 = no revenue share.
 *     DocRef: MVP_PLAN:§Author Revenue, §Dual-Mode Host Economics
 */
export const AnnouncePayload = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })),
    mime: Type.Optional(Type.String({ maxLength: 128 })),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    /** "open" = serve without L402 (hosts earn from pool only). "paid" = L402 required. */
    access: Type.Optional(AccessMode),
    /** Content author's Ed25519 pubkey (hex). If omitted, `from` is the author. */
    author_pubkey: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    /** Revenue share in basis points (0–10000). Third-party payments only. */
    revshare_bps: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
  },
  { additionalProperties: false },
);

export type AnnouncePayload = Static<typeof AnnouncePayload>;

/**
 * HostPayload — kind=HOST (0x04).
 * Host registration or update.
 * ref = zero-filled (self-referential).
 * from = host pubkey.
 */
export const HostPayload = Type.Object(
  {
    endpoint: Type.Union([Type.String(), Type.Null()]),
    pricing: Type.Object({
      min_request_sats: Type.Integer({ minimum: 1 }),
      sats_per_gb: Type.Integer({ minimum: 1 }),
      burst_sats_per_gb: Type.Optional(Type.Integer({ minimum: 1 })),
      min_bounty_sats: Type.Optional(Type.Integer({ minimum: 0 })),
      sats_per_gb_month: Type.Optional(Type.Integer({ minimum: 0 })),
      open_min_pool_sats: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  },
  { additionalProperties: false },
);

export type HostPayload = Static<typeof HostPayload>;

/**
 * ListPayload — kind=LIST (0x07).
 * Group multiple refs into a named collection.
 * ref = topic hash or zero-filled.
 */
export const ListPayload = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    items: Type.Array(Hex32, { minItems: 1, maxItems: MAX_LIST_ITEMS }),
  },
  { additionalProperties: false },
);

export type ListPayload = Static<typeof ListPayload>;

/**
 * PinPayload — kind=PIN_POLICY (0x08).
 * Pin policy declaring durability requirements.
 * ref = asset_root CID. sats = budget.
 * Materializer enforces SLA from this policy.
 */
export const PinPayload = Type.Object(
  {
    min_copies: Type.Integer({ minimum: 1, maximum: 20 }),
    duration_epochs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type PinPayload = Static<typeof PinPayload>;
