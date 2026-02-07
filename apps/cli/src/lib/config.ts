/**
 * CLI configuration — loads from ~/.dupenet/config.json + env overrides.
 *
 * Priority: env vars > config file > defaults.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  gateway: string;
  coordinator: string;
  keyPath: string;
  /** Optional LND REST endpoint for L402 payments */
  lndHost?: string;
  lndMacaroonPath?: string;
  lndTlsCertPath?: string;
}

const CONFIG_DIR = join(homedir(), ".dupenet");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_KEY_PATH = join(CONFIG_DIR, "key.json");

const DEFAULTS: CliConfig = {
  gateway: "http://localhost:8080",
  coordinator: "http://localhost:8081",
  keyPath: DEFAULT_KEY_PATH,
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

/** Load config, merging env overrides on top. */
export async function loadConfig(): Promise<CliConfig> {
  let fileConfig: Partial<CliConfig> = {};

  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    fileConfig = JSON.parse(raw) as Partial<CliConfig>;
  } catch {
    // No config file yet — use defaults
  }

  const config: CliConfig = {
    gateway: process.env["DUPENET_GATEWAY"] ?? fileConfig.gateway ?? DEFAULTS.gateway,
    coordinator: process.env["DUPENET_COORDINATOR"] ?? fileConfig.coordinator ?? DEFAULTS.coordinator,
    keyPath: process.env["DUPENET_KEY_PATH"] ?? fileConfig.keyPath ?? DEFAULTS.keyPath,
    lndHost: process.env["DUPENET_LND_HOST"] ?? fileConfig.lndHost,
    lndMacaroonPath: process.env["DUPENET_LND_MACAROON"] ?? fileConfig.lndMacaroonPath,
    lndTlsCertPath: process.env["DUPENET_LND_TLS_CERT"] ?? fileConfig.lndTlsCertPath,
  };

  return config;
}

/** Save config to disk. */
export async function saveConfig(config: CliConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
