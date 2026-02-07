/**
 * Mint configuration.
 * Minimal — this service is intentionally tiny.
 */

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  port: parseInt(env("MINT_PORT", "3101"), 10),
  host: env("MINT_HOST", "0.0.0.0"),
  /** Ed25519 private key, 32 bytes hex-encoded. */
  privateKeyHex: env("MINT_PRIVATE_KEY_HEX", ""),
  /** LND gRPC for settlement verification. */
  lndHost: env("LND_HOST", "localhost:10009"),
  lndMacaroonPath: env("LND_MACAROON_PATH", ""),
  lndTlsCertPath: env("LND_TLS_CERT_PATH", ""),
} as const;
