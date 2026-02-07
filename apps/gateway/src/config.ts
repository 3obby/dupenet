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
  lndHost: env("LND_HOST", "localhost:10009"),
  lndMacaroonPath: env("LND_MACAROON_PATH", ""),
  lndTlsCertPath: env("LND_TLS_CERT_PATH", ""),
  mintUrl: env("MINT_URL", "http://localhost:3101"),
  minRequestSats: parseInt(env("MIN_REQUEST_SATS", "3"), 10),
  satsPerGb: parseInt(env("SATS_PER_GB", "500"), 10),
} as const;
