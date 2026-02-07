/**
 * dupenet config [--gateway url] [--coordinator url]
 *
 * Show or update CLI configuration.
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
    config.gateway = opts.gateway;
    changed = true;
  }
  if (opts.coordinator) {
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
  console.log(`  gateway:     ${config.gateway}`);
  console.log(`  coordinator: ${config.coordinator}`);
  console.log(`  keyPath:     ${config.keyPath}`);
  if (config.lndHost) console.log(`  lndHost:     ${config.lndHost}`);
  if (config.lndMacaroonPath) console.log(`  lndMacaroon: ${config.lndMacaroonPath}`);
}
