/**
 * Coordinator API client — server-side fetches for the web surface.
 * All functions run on the server (Next.js server components).
 */

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";
const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:3100";

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

// ── Content stats (instrument cluster) ─────────────────────────

export interface ContentStats {
  balance: number;
  total_funded: number;
  funder_count: number;
  host_count: number;
  last_payout_epoch: number;
  recent: { from: string; sats: number; ts: number; kind: number }[];
}

export async function getContentStats(ref: string): Promise<ContentStats> {
  const data = await get<ContentStats>(`/content/${ref}/stats`);
  return data ?? {
    balance: 0,
    total_funded: 0,
    funder_count: 0,
    host_count: 0,
    last_payout_epoch: 0,
    recent: [],
  };
}

// ── Content bytes (server-side gateway fetch) ─────────────────────

/** Max bytes to inline-render (128 KiB — covers all text, small images). */
const INLINE_MAX = 128 * 1024;

/**
 * Fetch content bytes for inline rendering.
 * Returns { bytes, mime } for single-block assets,
 * or null if content is too large, behind L402, or not found.
 *
 * For multi-block assets: resolves asset → manifest → concatenate blocks.
 * Only fetches open-access content that fits within INLINE_MAX.
 */
export async function fetchContentForRender(
  ref: string,
  declaredMime?: string,
  declaredSize?: number,
): Promise<{ text: string; mime: string } | null> {
  // Skip if declared size exceeds inline limit
  if (declaredSize && declaredSize > INLINE_MAX) return null;

  try {
    // Try GET /asset/:ref first to get the asset root (manifest pointer)
    const assetRes = await fetch(`${GATEWAY}/asset/${ref}`, {
      cache: "no-store",
    });
    if (!assetRes.ok) {
      // Might be a raw block — try direct fetch
      return fetchRawBlock(ref, declaredMime);
    }

    const asset = (await assetRes.json()) as {
      kind: string;
      original: {
        file_root: string;
        mime?: string;
        size: number;
      };
    };

    const mime = asset.original.mime ?? declaredMime ?? "application/octet-stream";
    const size = asset.original.size;

    // Skip binary types that are too large or non-renderable
    if (size > INLINE_MAX) return null;

    // Get file manifest
    const fileRes = await fetch(`${GATEWAY}/file/${asset.original.file_root}`, {
      cache: "no-store",
    });
    if (!fileRes.ok) return null;

    const manifest = (await fileRes.json()) as { blocks: string[] };

    // Fetch all blocks and concatenate
    const chunks: Uint8Array[] = [];
    for (const blockCid of manifest.blocks) {
      const blockRes = await fetch(`${GATEWAY}/block/${blockCid}`, {
        cache: "no-store",
      });
      if (!blockRes.ok) return null; // L402 or missing
      chunks.push(new Uint8Array(await blockRes.arrayBuffer()));
    }

    const totalSize = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    // For text-based MIME types, decode as UTF-8
    if (isTextMime(mime)) {
      return { text: new TextDecoder().decode(combined), mime };
    }

    // For images, encode as base64 data URI
    if (mime.startsWith("image/")) {
      const b64 = Buffer.from(combined).toString("base64");
      return { text: `data:${mime};base64,${b64}`, mime };
    }

    // For other types (PDF etc.), skip inline rendering for now
    return null;
  } catch {
    return null;
  }
}

async function fetchRawBlock(
  cid: string,
  declaredMime?: string,
): Promise<{ text: string; mime: string } | null> {
  try {
    const res = await fetch(`${GATEWAY}/block/${cid}`, { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > INLINE_MAX) return null;
    const mime = declaredMime ?? "application/octet-stream";
    if (isTextMime(mime)) {
      return { text: new TextDecoder().decode(bytes), mime };
    }
    if (mime.startsWith("image/")) {
      const b64 = Buffer.from(bytes).toString("base64");
      return { text: `data:${mime};base64,${b64}`, mime };
    }
    return null;
  } catch {
    return null;
  }
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript"
  );
}

// ── Helpers ────────────────────────────────────────────────────────

/** Shorten a hex pubkey: first 4 + last 4 chars. */
export function shortHex(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 4)}..${hex.slice(-4)}`;
}

/** Format sats as full BTC decimal — all 8 places, no condensing.
 *  1234 → "0.00001234"   210 → "0.00000210"   100000000 → "1.00000000" */
export function fmtSats(n: number): string {
  const s = String(Math.abs(Math.round(n)));
  const padded = s.padStart(9, "0"); // at least 9 chars: 1 integer + 8 decimal
  const i = padded.length - 8;
  return padded.slice(0, i) + "." + padded.slice(i);
}

/** Format timestamp as YYYY-MM-DD. */
export function fmtDate(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

/** Relative time: "3m" "2h" "1d" "5w" */
export function timeAgo(tsMs: number): string {
  const s = Math.floor((Date.now() - tsMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
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
