/**
 * Gateway configuration.
 * All env access centralized here — no direct process.env elsewhere.
 */

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  port: parseInt(env("GATEWAY_PORT", "3100"), 10),
  host: env("GATEWAY_HOST", "0.0.0.0"),
  blockStorePath: env("BLOCK_STORE_PATH", "./data/blocks"),
  /** LND REST endpoint (host:port). Typically port 8080. */
  lndHost: env("LND_HOST", "localhost:8080"),
  lndMacaroonPath: env("LND_MACAROON_PATH", ""),
  lndTlsCertPath: env("LND_TLS_CERT_PATH", ""),
  mintUrl: env("MINT_URL", "http://localhost:3101"),
  /** This gateway operator's Ed25519 public key (hex). */
  hostPubkey: env("HOST_PUBKEY", ""),
  minRequestSats: parseInt(env("MIN_REQUEST_SATS", "3"), 10),
  satsPerGb: parseInt(env("SATS_PER_GB", "500"), 10),
  /** Protocol genesis timestamp (ms). 0 = Unix epoch. Override for testing. */
  genesisTimestampMs: parseInt(env("GENESIS_TIMESTAMP_MS", "0"), 10),
  /** Enable free preview tier for blocks ≤ 16 KiB. Set "false" to disable. */
  freePreviewEnabled: env("FREE_PREVIEW_ENABLED", "true") !== "false",
} as const;
