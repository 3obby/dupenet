/**
 * Coordinator API client — server-side fetches for the web surface.
 * All functions run on the server (Next.js server components).
 */

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:3100";

export { GATEWAY };

// ── Types ──────────────────────────────────────────────────────────

export interface FundedItem {
  pool_key: string;
  balance: number;
  host_count: number;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    mime?: string;
    access?: string;
    announced_by?: string;
  } | null;
}

export interface RecentItem {
  event_id: string;
  from: string;
  ref: string;
  sats: number;
  ts: number;
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    mime?: string;
    size?: number;
    access?: string;
  };
}

export interface ProtocolEvent {
  event_id: string;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
  sig: string;
}

export interface ThreadNode {
  event_id: string;
  from: string;
  ref: string;
  body: Record<string, unknown>;
  sats: number;
  ts: number;
  replies: ThreadNode[];
}

export interface Pool {
  balance: number;
  last_payout_epoch: number;
}

export interface HostEntry {
  pubkey: string;
  endpoint: string | null;
  pricing: { min_request_sats: number; sats_per_gb: number };
  status: string;
  availability_score: number;
}

export interface EpochProof {
  epoch: number;
  host: string;
  cid: string;
  receipt_count: number;
  unique_clients: number;
  reward_sats: number;
}

// ── Fetchers ───────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${COORDINATOR}${path}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getFeedFunded(
  minBalance = 0,
  limit = 100,
): Promise<FundedItem[]> {
  const data = await get<{ items: FundedItem[] }>(
    `/feed/funded?min_balance=${minBalance}&limit=${limit}`,
  );
  return data?.items ?? [];
}

export async function getFeedRecent(
  limit = 50,
  offset = 0,
): Promise<RecentItem[]> {
  const data = await get<{ items: RecentItem[] }>(
    `/feed/recent?limit=${limit}&offset=${offset}`,
  );
  return data?.items ?? [];
}

export async function getEvents(params: {
  ref?: string;
  kind?: number;
  from?: string;
  limit?: number;
}): Promise<ProtocolEvent[]> {
  const q = new URLSearchParams();
  if (params.ref) q.set("ref", params.ref);
  if (params.kind !== undefined) q.set("kind", String(params.kind));
  if (params.from) q.set("from", params.from);
  if (params.limit) q.set("limit", String(params.limit));
  const data = await get<{ events: ProtocolEvent[] }>(`/events?${q}`);
  return data?.events ?? [];
}

export async function getThread(eventId: string): Promise<ThreadNode | null> {
  return get<ThreadNode>(`/thread/${eventId}`);
}

export async function getPool(ref: string): Promise<Pool> {
  const data = await get<Pool>(`/bounty/${ref}`);
  return data ?? { balance: 0, last_payout_epoch: 0 };
}

export async function getDirectory(): Promise<HostEntry[]> {
  const data = await get<{ hosts: HostEntry[] }>("/directory");
  return data?.hosts ?? [];
}

export async function getEpochSummary(
  epoch: number,
): Promise<EpochProof[]> {
  const data = await get<{
    settled: boolean;
    summaries: EpochProof[];
  }>(`/epoch/summary/${epoch}`);
  return data?.summaries ?? [];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Shorten a hex pubkey: first 4 + last 4 chars. */
export function shortHex(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 4)}..${hex.slice(-4)}`;
}

/** Format sats with commas. */
export function fmtSats(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format timestamp as YYYY-MM-DD. */
export function fmtDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/** Estimate runway in months: balance / (drain_rate_per_epoch * 6 * 30). */
export function estRunway(balance: number, hostCount: number): string {
  if (hostCount === 0 || balance === 0) return "-";
  // Rough: 2% drain per epoch, 6 epochs/day, 30 days/month
  const drainPerMonth = balance * 0.02 * 6 * 30;
  if (drainPerMonth === 0) return "-";
  const months = Math.floor(balance / drainPerMonth);
  return months > 99 ? "99+" : String(months);
}
