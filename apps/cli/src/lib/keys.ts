/**
 * Key management — load/save Ed25519 keypair from ~/.dupenet/key.json.
 *
 * Key file format:
 * {
 *   "publicKey": "hex64",
 *   "privateKey": "hex64"
 * }
 */

import { readFile, writeFile } from "node:fs/promises";
import { toHex, fromHex, generateKeypair } from "@dupenet/physics";
import { ensureConfigDir } from "./config.js";

export interface KeyFile {
  publicKey: string; // 64-char hex
  privateKey: string; // 64-char hex (seed)
}

/** Load keypair from disk. Throws if not found. */
export async function loadKeys(keyPath: string): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyHex: string;
}> {
  let raw: string;
  try {
    raw = await readFile(keyPath, "utf-8");
  } catch {
    throw new Error(
      `No key file at ${keyPath}\nRun 'dupenet keygen' to generate one.`,
    );
  }

  const data = JSON.parse(raw) as KeyFile;

  if (!data.publicKey || !data.privateKey) {
    throw new Error(`Invalid key file at ${keyPath} — missing publicKey or privateKey`);
  }
  if (!/^[0-9a-f]{64}$/.test(data.publicKey) || !/^[0-9a-f]{64}$/.test(data.privateKey)) {
    throw new Error(`Invalid key file at ${keyPath} — keys must be 64-char hex`);
  }

  return {
    publicKey: fromHex(data.publicKey),
    privateKey: fromHex(data.privateKey),
    publicKeyHex: data.publicKey,
  };
}

/** Generate and save a new keypair. Returns hex strings. */
export async function generateAndSaveKeys(keyPath: string): Promise<KeyFile> {
  await ensureConfigDir();

  const kp = await generateKeypair();
  const keyFile: KeyFile = {
    publicKey: toHex(kp.publicKey),
    privateKey: toHex(kp.privateKey),
  };

  await writeFile(keyPath, JSON.stringify(keyFile, null, 2) + "\n", "utf-8");
  return keyFile;
}
