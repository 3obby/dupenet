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
} as const;
