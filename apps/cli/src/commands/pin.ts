/**
 * dupenet pin <asset_root> [opts]
 * dupenet pin status <pin_id>
 * dupenet pin cancel <pin_id>
 *
 * DocRef: MVP_PLAN:§Pin Contract API
 */

import { signEventPayload } from "@dupenet/physics";
import type { CliConfig } from "../lib/config.js";
import { loadKeys } from "../lib/keys.js";
import { httpGet, httpPost } from "../lib/http.js";

interface PinCreateResponse {
  ok: boolean;
  pin_id: string;
  drain_rate: number;
  budget_sats: number;
  duration_epochs: number;
}

interface PinStatusResponse {
  id: string;
  status: string;
  asset_root: string;
  budget_sats: number;
  remaining_budget: number;
  drain_rate: number;
  min_copies: number;
  copies_met: boolean;
  active_hosts: number;
}

interface PinCancelResponse {
  ok: boolean;
  refund: number;
  fee: number;
}

export interface PinOptions {
  budget?: string;
  duration?: string;
  copies?: string;
}

export async function pinCreateCommand(
  assetRoot: string,
  config: CliConfig,
  opts: PinOptions,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(assetRoot)) {
    throw new Error(`Invalid asset_root: must be 64-char hex`);
  }

  const keys = await loadKeys(config.keyPath);

  const budgetSats = parseInt(opts.budget ?? "1000", 10);
  const durationEpochs = parseInt(opts.duration ?? "100", 10);
  const minCopies = parseInt(opts.copies ?? "3", 10);

  console.log(`Creating pin contract for ${assetRoot}`);
  console.log(`  budget: ${budgetSats} sats, duration: ${durationEpochs} epochs, copies: ${minCopies}`);

  const pinPayload = {
    asset_root: assetRoot,
    budget_sats: budgetSats,
    duration_epochs: durationEpochs,
    min_copies: minCopies,
    client: keys.publicKeyHex,
  };

  const sig = await signEventPayload(keys.privateKey, pinPayload);

  const result = await httpPost<PinCreateResponse>(`${config.coordinator}/pin`, {
    ...pinPayload,
    sig,
  });

  console.log(`\n  pin_id:     ${result.pin_id}`);
  console.log(`  drain_rate: ${result.drain_rate} sats/epoch`);
  console.log(`  ok: ${result.ok}`);
}

export async function pinStatusCommand(
  pinId: string,
  config: CliConfig,
): Promise<void> {
  const status = await httpGet<PinStatusResponse>(
    `${config.coordinator}/pin/${pinId}`,
  );

  console.log(`Pin ${status.id}:`);
  console.log(`  status:     ${status.status}`);
  console.log(`  asset:      ${status.asset_root}`);
  console.log(`  budget:     ${status.remaining_budget}/${status.budget_sats} sats`);
  console.log(`  drain_rate: ${status.drain_rate} sats/epoch`);
  console.log(`  copies:     ${status.active_hosts}/${status.min_copies} (met: ${status.copies_met})`);
}

export async function pinCancelCommand(
  pinId: string,
  config: CliConfig,
): Promise<void> {
  const keys = await loadKeys(config.keyPath);

  const cancelPayload = { pin_id: pinId, client: keys.publicKeyHex };
  const sig = await signEventPayload(keys.privateKey, cancelPayload);

  const result = await httpPost<PinCancelResponse>(
    `${config.coordinator}/pin/${pinId}/cancel`,
    { ...cancelPayload, sig },
  );

  console.log(`Pin ${pinId} cancelled.`);
  console.log(`  refund: ${result.refund} sats`);
  console.log(`  fee:    ${result.fee} sats`);
}
