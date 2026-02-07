/**
 * Coordinator configuration.
 */

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  port: parseInt(env("COORDINATOR_PORT", "3102"), 10),
  host: env("COORDINATOR_HOST", "0.0.0.0"),
  databaseUrl: env("DATABASE_URL", "postgresql://dupenet:dupenet@localhost:5432/dupenet"),
  /** Comma-separated hex Ed25519 public keys of trusted receipt mints. */
  mintPubkeys: env("MINT_PUBKEYS", "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  /** Epoch scheduler check interval (ms). 0 = disabled. Default: 60000. */
  epochSchedulerIntervalMs: parseInt(env("EPOCH_SCHEDULER_INTERVAL_MS", "60000"), 10),
  /** Run spot-checks after epoch settlement. Default: true. */
  epochSchedulerSpotChecks: env("EPOCH_SCHEDULER_SPOT_CHECKS", "true") === "true",
} as const;
