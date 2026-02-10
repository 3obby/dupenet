/**
 * EventV1 operations — construct, sign, verify, compute event_id.
 * DocRef: MVP_PLAN:§Event Layer, §Protocol vs Materializer Boundary
 *
 * EventV1 is the universal event envelope. This module provides:
 *   - eventSigningPayload(): extract the fields that get signed (everything minus sig)
 *   - computeEventId(): SHA256(canonical(signing_payload)) → hex
 *   - signEvent(): sign an unsigned event → EventV1 with sig
 *   - verifyEvent(): verify sig + recompute event_id
 *   - encodeEventBody(): CBOR-encode a kind-specific payload → hex body
 *   - decodeEventBody(): hex body → decoded object
 */

import type { EventV1 } from "./schemas/event.js";
import { canonicalEncode, canonicalDecode } from "./canonical.js";
import { cidFromObject, toHex, fromHex } from "./cid.js";
import { signEventPayload, verifyEventSignature } from "./event-signature.js";
import { EVENT_MAX_BODY } from "./constants.js";

// ── Zero ref (no reference) ────────────────────────────────────────

/** 64-char zero hex — used as ref when no reference applies. */
export const ZERO_REF = "0".repeat(64);

// ── Signing payload ────────────────────────────────────────────────

/**
 * Extract the signing payload from an EventV1 (everything except sig).
 * This is what gets canonical-encoded for signing and event_id computation.
 */
export function eventSigningPayload(
  event: EventV1 | Omit<EventV1, "sig">,
): Record<string, unknown> {
  return {
    v: event.v,
    kind: event.kind,
    from: event.from,
    ref: event.ref,
    body: event.body,
    sats: event.sats,
    ts: event.ts,
  };
}

// ── Event ID ───────────────────────────────────────────────────────

/**
 * Compute event_id = SHA256(canonical(EventV1 minus sig)).
 * Returns 64-char hex string.
 */
export function computeEventId(event: EventV1 | Omit<EventV1, "sig">): string {
  return cidFromObject(eventSigningPayload(event));
}

// ── Sign ───────────────────────────────────────────────────────────

/**
 * Sign an unsigned event, producing a complete EventV1.
 *
 * @param privateKey - 32-byte Ed25519 seed
 * @param event - Event without sig field
 * @returns Complete EventV1 with base64 sig
 */
export async function signEvent(
  privateKey: Uint8Array,
  event: Omit<EventV1, "sig">,
): Promise<EventV1> {
  const payload = eventSigningPayload(event);
  const sig = await signEventPayload(privateKey, payload);
  return { ...event, sig };
}

// ── Verify ─────────────────────────────────────────────────────────

/**
 * Verify an EventV1 signature.
 * Checks: Ed25519(event.from, event.sig, canonical(EventV1 minus sig)).
 *
 * @returns true if signature is valid
 */
export async function verifyEvent(event: EventV1): Promise<boolean> {
  const payload = eventSigningPayload(event);
  return verifyEventSignature(event.from, event.sig, payload);
}

// ── Body encode/decode ─────────────────────────────────────────────

/**
 * Encode a kind-specific payload into a hex body string.
 * Uses canonical CBOR encoding (same deterministic encoding used everywhere).
 *
 * @param payload - The structured payload object (e.g., AnnouncePayload)
 * @returns Hex-encoded CBOR bytes
 * @throws If encoded body exceeds EVENT_MAX_BODY bytes
 */
export function encodeEventBody(payload: unknown): string {
  const bytes = canonicalEncode(payload);
  if (bytes.length > EVENT_MAX_BODY) {
    throw new Error(
      `Event body too large: ${bytes.length} bytes (max ${EVENT_MAX_BODY})`,
    );
  }
  return toHex(bytes);
}

/**
 * Decode a hex body string into the kind-specific payload.
 * Returns the decoded object — caller should validate against the kind schema.
 *
 * @param bodyHex - Hex-encoded CBOR bytes from EventV1.body
 * @returns Decoded payload object (or empty object if body is empty)
 */
export function decodeEventBody(bodyHex: string): unknown {
  if (!bodyHex || bodyHex.length === 0) return {};
  const bytes = fromHex(bodyHex);
  return canonicalDecode(bytes);
}
