/**
 * dupenet post <ref> <text>
 *
 * Sign EventV1 kind=POST → POST /event → print event_id.
 * Creates a threaded reply (ref = parent event_id) or root post (ref = topic hash).
 * DocRef: MVP_PLAN:§Event Layer
 */

import {
  signEvent,
  encodeEventBody,
  EVENT_KIND_POST,
} from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { loadKeys } from "../lib/keys.js";
import { httpPost } from "../lib/http.js";

interface EventResponse {
  ok: boolean;
  event_id: string;
  pool_credit?: number;
  protocol_fee?: number;
}

export async function postCommand(
  ref: string,
  text: string,
  config: CliConfig,
  opts: { sats?: number } = {},
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    throw new Error(`Invalid ref: must be 64-char hex. Got: ${ref}`);
  }

  if (!text || text.length === 0) {
    throw new Error("Text cannot be empty");
  }

  const sats = opts.sats ?? 0;
  const keys = await loadKeys(config.keyPath);

  const body = encodeEventBody({ text });

  console.log(`Posting → ${ref.slice(0, 8)}..${ref.slice(-4)}${sats > 0 ? ` (${sats} sat)` : ""}`);

  const signed = await signEvent(keys.privateKey, {
    v: 1,
    kind: EVENT_KIND_POST,
    from: keys.publicKeyHex,
    ref,
    body,
    sats,
    ts: Date.now(),
  });

  const result = await httpPost<EventResponse>(
    `${config.coordinator}/event`,
    signed,
  );

  console.log(`  event_id: ${result.event_id}`);
  if (result.pool_credit !== undefined && result.pool_credit > 0) {
    console.log(`  pool_credit: ${result.pool_credit} sat`);
  }
}
