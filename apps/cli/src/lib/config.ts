/**
 * CLI configuration — loads from ~/.dupenet/config.json + env overrides.
 *
 * Priority: env vars > config file > defaults.
 *
 * Multi-endpoint support:
 *   "gateways" and "coordinators" arrays enable retry-with-rotation.
 *   The singular "gateway"/"coordinator" fields are kept for backward compat
 *   and always point to the first entry in the respective array.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  /** Primary gateway URL (first entry of gateways[]). */
  gateway: string;
  /** Primary coordinator URL (first entry of coordinators[]). */
  coordinator: string;
  /** All gateway endpoints, ordered by preference. Enables retry-with-rotation. */
  gateways: string[];
  /** All coordinator endpoints, ordered by preference. Enables retry-with-rotation. */
  coordinators: string[];
  keyPath: string;
  /** Optional LND REST endpoint for L402 payments */
  lndHost?: string;
  lndMacaroonPath?: string;
  lndTlsCertPath?: string;
}

const CONFIG_DIR = join(homedir(), ".dupenet");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_KEY_PATH = join(CONFIG_DIR, "key.json");

const DEFAULT_GATEWAY = "http://localhost:8080";
const DEFAULT_COORDINATOR = "http://localhost:8081";

/** Hardcoded bootstrap endpoints — founder stack. */
const BOOTSTRAP_GATEWAYS = ["https://ocdn.is"];
const BOOTSTRAP_COORDINATORS = ["https://ocdn.is"];

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
  let fileConfig: Partial<CliConfig & {
    gateway?: string;
    coordinator?: string;
    gateways?: string[];
    coordinators?: string[];
  }> = {};

  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    fileConfig = JSON.parse(raw) as typeof fileConfig;
  } catch {
    // No config file yet — use defaults
  }

  // Resolve gateway list: env > config gateways[] > config gateway > bootstrap > default
  const envGateway = process.env["DUPENET_GATEWAY"];
  const envGateways = process.env["DUPENET_GATEWAYS"]?.split(",").map((s) => s.trim()).filter(Boolean);
  const gateways: string[] =
    envGateways ??
    (envGateway ? [envGateway] : null) ??
    fileConfig.gateways ??
    (fileConfig.gateway ? [fileConfig.gateway] : null) ??
    [DEFAULT_GATEWAY];

  // Resolve coordinator list: env > config coordinators[] > config coordinator > bootstrap > default
  const envCoordinator = process.env["DUPENET_COORDINATOR"];
  const envCoordinators = process.env["DUPENET_COORDINATORS"]?.split(",").map((s) => s.trim()).filter(Boolean);
  const coordinators: string[] =
    envCoordinators ??
    (envCoordinator ? [envCoordinator] : null) ??
    fileConfig.coordinators ??
    (fileConfig.coordinator ? [fileConfig.coordinator] : null) ??
    [DEFAULT_COORDINATOR];

  const config: CliConfig = {
    gateway: gateways[0] ?? DEFAULT_GATEWAY,
    coordinator: coordinators[0] ?? DEFAULT_COORDINATOR,
    gateways,
    coordinators,
    keyPath: process.env["DUPENET_KEY_PATH"] ?? fileConfig.keyPath ?? DEFAULT_KEY_PATH,
    lndHost: process.env["DUPENET_LND_HOST"] ?? fileConfig.lndHost,
    lndMacaroonPath: process.env["DUPENET_LND_MACAROON"] ?? fileConfig.lndMacaroonPath,
    lndTlsCertPath: process.env["DUPENET_LND_TLS_CERT"] ?? fileConfig.lndTlsCertPath,
  };

  return config;
}

/** Save config to disk. */
export async function saveConfig(config: CliConfig): Promise<void> {
  await ensureConfigDir();
  // Persist arrays; omit singular fields from disk (they're derived)
  const toSave = {
    gateways: config.gateways,
    coordinators: config.coordinators,
    keyPath: config.keyPath,
    ...(config.lndHost ? { lndHost: config.lndHost } : {}),
    ...(config.lndMacaroonPath ? { lndMacaroonPath: config.lndMacaroonPath } : {}),
    ...(config.lndTlsCertPath ? { lndTlsCertPath: config.lndTlsCertPath } : {}),
  };
  await writeFile(CONFIG_FILE, JSON.stringify(toSave, null, 2) + "\n", "utf-8");
}

/**
 * Get bootstrap endpoints (hardcoded founder stack).
 * These are appended to user-configured endpoints as fallback.
 */
export function getBootstrapEndpoints(): {
  gateways: string[];
  coordinators: string[];
} {
  return {
    gateways: BOOTSTRAP_GATEWAYS,
    coordinators: BOOTSTRAP_COORDINATORS,
  };
}
