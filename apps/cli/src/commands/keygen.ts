/**
 * dupenet keygen
 *
 * Generate Ed25519 keypair → write to ~/.dupenet/key.json.
 * DocRef: MVP_PLAN:§User: pubkey identity
 */

import { existsSync } from "node:fs";
import type { CliConfig } from "../lib/config.js";
import { generateAndSaveKeys } from "../lib/keys.js";

interface KeygenOptions {
  force?: boolean;
}

export async function keygenCommand(
  config: CliConfig,
  opts: KeygenOptions,
): Promise<void> {
  const keyPath = config.keyPath;

  // Check for existing key
  if (existsSync(keyPath) && !opts.force) {
    console.error(`Key file already exists at ${keyPath}`);
    console.error(`Use --force to overwrite.`);
    process.exit(1);
  }

  console.log(`Generating Ed25519 keypair...`);
  const keyFile = await generateAndSaveKeys(keyPath);

  console.log(`  pubkey: ${keyFile.publicKey}`);
  console.log(`  saved:  ${keyPath}`);
}
