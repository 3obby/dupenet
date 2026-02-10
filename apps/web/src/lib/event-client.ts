/**
 * Client-side event construction + API calls.
 * Events are signed locally and POSTed to the coordinator via API proxy.
 */

import { signEvent, encodeEventBody, computeEventId } from "./crypto";

// Event kind constants (from physics — duplicated to avoid importing physics)
const EVENT_KIND_FUND = 0x01;
const EVENT_KIND_POST = 0x03;

export interface SignedEvent {
  v: number;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
  sig: string;
}

export interface UnsignedEvent {
  v: number;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
}

export interface PostEventResult {
  ok: boolean;
  event_id?: string;
  pool_credit?: number;
  protocol_fee?: number;
  error?: string;
  detail?: string;
}

export interface PayreqResult {
  /** Dev mode: no payment needed, sats trusted. */
  dev_mode?: boolean;
  /** Lightning BOLT11 invoice string. */
  invoice?: string;
  /** Hex payment hash (for polling status). */
  payment_hash?: string;
  /** Unix timestamp when invoice expires. */
  expires_at?: number;
  /** Error from coordinator. */
  error?: string;
  detail?: string;
}

export interface PayreqStatusResult {
  settled: boolean;
  state: string;
  event_hash: string;
  sats: number;
  error?: string;
}

/** Build an unsigned FUND event (before payment). */
export function buildFundEvent(
  ref: string,
  sats: number,
  publicKeyHex: string,
): UnsignedEvent {
  return {
    v: 1,
    kind: EVENT_KIND_FUND,
    from: publicKeyHex,
    ref,
    body: "",
    sats,
    ts: Date.now(),
  };
}

/** Compute the event_hash for an unsigned event. */
export function getEventHash(event: UnsignedEvent): string {
  return computeEventId(event);
}

/** Sign an unsigned event. */
export async function signUnsignedEvent(
  event: UnsignedEvent,
  privateKey: Uint8Array,
): Promise<SignedEvent> {
  return signEvent(privateKey, event);
}

/** Create and sign a POST event (comment). */
export async function createPostEvent(
  ref: string,
  text: string,
  privateKey: Uint8Array,
  publicKeyHex: string,
): Promise<SignedEvent> {
  const body = encodeEventBody({ text });
  return signEvent(privateKey, {
    v: 1,
    kind: EVENT_KIND_POST,
    from: publicKeyHex,
    ref,
    body,
    sats: 0,
    ts: Date.now(),
  });
}

/** POST a signed event to the coordinator (via API proxy). */
export async function postEvent(
  event: SignedEvent,
): Promise<PostEventResult> {
  const res = await fetch("/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  return res.json();
}

/** Request a Lightning invoice for a funded event. */
export async function requestPayment(
  sats: number,
  eventHash: string,
): Promise<PayreqResult> {
  const res = await fetch("/api/payreq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sats, event_hash: eventHash }),
  });
  return res.json();
}

/** Poll payment status. */
export async function checkPaymentStatus(
  paymentHash: string,
): Promise<PayreqStatusResult> {
  const res = await fetch(`/api/payreq/${paymentHash}`, {
    cache: "no-store",
  });
  return res.json();
}
