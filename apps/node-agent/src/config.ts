/**
 * Node agent configuration.
 */

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  gatewayUrl: env("AGENT_GATEWAY_URL", "http://localhost:3100"),
  coordinatorUrl: env("AGENT_COORDINATOR_URL", "http://localhost:3102"),
  hostPubkey: env("AGENT_HOST_PUBKEY", ""),
  /** How often to check for new profitable CIDs (ms). */
  pollIntervalMs: parseInt(env("AGENT_POLL_INTERVAL_MS", "60000"), 10),
  /** Minimum bounty balance to consider mirroring. */
  minBountyForMirror: parseInt(env("AGENT_MIN_BOUNTY", "100"), 10),
} as const;
