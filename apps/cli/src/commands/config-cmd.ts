/**
 * dupenet config [--gateway url] [--coordinator url]
 *
 * Show or update CLI configuration.
 * Supports multi-endpoint arrays for retry-with-rotation.
 */

import {
  loadConfig,
  saveConfig,
  getConfigPath,
} from "../lib/config.js";

interface ConfigOptions {
  gateway?: string;
  coordinator?: string;
  keyPath?: string;
  lndHost?: string;
}

export async function configCommand(opts: ConfigOptions): Promise<void> {
  const config = await loadConfig();
  let changed = false;

  if (opts.gateway) {
    // Add as primary (first) gateway, preserving others
    const existing = config.gateways.filter((g) => g !== opts.gateway);
    config.gateways = [opts.gateway, ...existing];
    config.gateway = opts.gateway;
    changed = true;
  }
  if (opts.coordinator) {
    // Add as primary (first) coordinator, preserving others
    const existing = config.coordinators.filter((c) => c !== opts.coordinator);
    config.coordinators = [opts.coordinator, ...existing];
    config.coordinator = opts.coordinator;
    changed = true;
  }
  if (opts.keyPath) {
    config.keyPath = opts.keyPath;
    changed = true;
  }
  if (opts.lndHost) {
    config.lndHost = opts.lndHost;
    changed = true;
  }

  if (changed) {
    await saveConfig(config);
    console.log(`Config saved to ${getConfigPath()}`);
  }

  console.log(`\nCurrent config:`);
  console.log(`  gateways:     ${config.gateways.join(", ") || "(none)"}`);
  console.log(`  coordinators: ${config.coordinators.join(", ") || "(none)"}`);
  console.log(`  keyPath:      ${config.keyPath}`);
  if (config.lndHost) console.log(`  lndHost:      ${config.lndHost}`);
  if (config.lndMacaroonPath) console.log(`  lndMacaroon:  ${config.lndMacaroonPath}`);
}
