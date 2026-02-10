/**
 * dupenet fund <ref> <sats>
 *
 * Sign EventV1 kind=FUND → POST /event → print pool_credit.
 * Replaces `dupenet tip` with EventV1 envelope.
 * Works for any ref: CID, event_id, topic hash.
 * DocRef: MVP_PLAN:§Event Layer, §Bounty Pool Mechanics
 */

import {
  signEvent,
  EVENT_KIND_FUND,
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

export async function fundCommand(
  ref: string,
  satsStr: string,
  config: CliConfig,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    throw new Error(`Invalid ref: must be 64-char hex. Got: ${ref}`);
  }

  const sats = parseInt(satsStr, 10);
  if (isNaN(sats) || sats <= 0) {
    throw new Error(`Invalid amount: must be a positive integer. Got: ${satsStr}`);
  }

  const keys = await loadKeys(config.keyPath);
  console.log(`Funding ${sats} sat → ${ref.slice(0, 8)}..${ref.slice(-4)}`);

  const signed = await signEvent(keys.privateKey, {
    v: 1,
    kind: EVENT_KIND_FUND,
    from: keys.publicKeyHex,
    ref,
    body: "",
    sats,
    ts: Date.now(),
  });

  const result = await httpPost<EventResponse>(
    `${config.coordinator}/event`,
    signed,
  );

  console.log(`  event_id:   ${result.event_id}`);
  if (result.pool_credit !== undefined) {
    console.log(`  pool_credit: ${result.pool_credit} sat`);
    console.log(`  royalty:     ${result.protocol_fee} sat`);
  }
}
