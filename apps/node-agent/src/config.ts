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
  /** Hex-encoded Ed25519 private key (32-byte seed) for signing. */
  hostPrivateKeyHex: env("AGENT_HOST_PRIVATE_KEY_HEX", ""),
  /** Public endpoint URL for this host (how clients reach us). */
  hostEndpoint: env("AGENT_HOST_ENDPOINT", ""),
  /** Pricing: min sats per request. */
  minRequestSats: parseInt(env("AGENT_MIN_REQUEST_SATS", "3"), 10),
  /** Pricing: sats per GB. */
  satsPerGb: parseInt(env("AGENT_SATS_PER_GB", "500"), 10),
  /** How often to check for new profitable CIDs (ms). */
  pollIntervalMs: parseInt(env("AGENT_POLL_INTERVAL_MS", "60000"), 10),
  /** Minimum bounty balance to consider mirroring. */
  minBountyForMirror: parseInt(env("AGENT_MIN_BOUNTY", "100"), 10),
  /** Maximum CIDs to mirror per poll cycle. */
  maxMirrorsPerCycle: parseInt(env("AGENT_MAX_MIRRORS_PER_CYCLE", "5"), 10),
} as const;
