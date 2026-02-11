/**
 * dupenet tip <cid> <sats>
 *
 * Sign tip → POST /tip → print bounty balance.
 * DocRef: MVP_PLAN:§Interface: Client → Protocol (tip)
 */

import { signEventPayload } from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { loadKeys } from "../lib/keys.js";
import { httpPostRotate } from "../lib/http.js";

interface TipResponse {
  ok: boolean;
  pool_credit: number;
  protocol_fee: number; // founder royalty (volume-tapering)
}

export async function tipCommand(
  cid: string,
  satsStr: string,
  config: CliConfig,
): Promise<void> {
  // Validate inputs
  if (!/^[0-9a-f]{64}$/.test(cid)) {
    throw new Error(`Invalid CID: must be 64-char hex. Got: ${cid}`);
  }

  const amount = parseInt(satsStr, 10);
  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid amount: must be a positive integer. Got: ${satsStr}`);
  }

  // Load keys
  const keys = await loadKeys(config.keyPath);
  console.log(`Tipping ${amount} sats on ${cid}`);
  console.log(`  from: ${keys.publicKeyHex}`);

  // Build tip payload (what gets signed)
  const tipPayload = {
    cid,
    amount,
    payment_proof: "0".repeat(64), // Stub for now — real proof requires LN payment
  };

  // Sign
  const sig = await signEventPayload(keys.privateKey, tipPayload);

  // POST /tip — with multi-endpoint rotation
  const coordinators = config.coordinators.length > 0
    ? config.coordinators
    : [config.coordinator];

  const result = await httpPostRotate<TipResponse>(coordinators, "/tip", {
    ...tipPayload,
    from: keys.publicKeyHex,
    sig,
  });

  console.log();
  console.log(`  pool_credit:     ${result.pool_credit} sats`);
  console.log(`  founder_royalty: ${result.protocol_fee} sats`);
  console.log(`  ok: ${result.ok}`);
}
