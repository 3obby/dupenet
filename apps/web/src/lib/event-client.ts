/**
 * Client-side event construction + API calls.
 * Events are signed locally and POSTed to the coordinator via API proxy.
 */

import { signEvent, encodeEventBody } from "./crypto";

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

export interface PostEventResult {
  ok: boolean;
  event_id?: string;
  pool_credit?: number;
  protocol_fee?: number;
  error?: string;
  detail?: string;
}

/** Create and sign a FUND event (Fortify). */
export async function createFundEvent(
  ref: string,
  sats: number,
  privateKey: Uint8Array,
  publicKeyHex: string,
): Promise<SignedEvent> {
  return signEvent(privateKey, {
    v: 1,
    kind: EVENT_KIND_FUND,
    from: publicKeyHex,
    ref,
    body: "",
    sats,
    ts: Date.now(),
  });
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
