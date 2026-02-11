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

export interface ContentPreview {
  /** Rendered text (UTF-8 text or base64 data URI for images). null if no blocks fetched. */
  text: string | null;
  /** MIME type of the content. */
  mime: string;
  /** True if not all blocks could be fetched (L402-gated). */
  truncated: boolean;
  /** Total file size in bytes. */
  totalSize: number;
  /** Total block count in manifest. */
  totalBlocks: number;
  /** How many blocks were successfully fetched. */
  blocksFetched: number;
}

/**
 * Fetch content for inline rendering — works for both open and paid content.
 *
 * For open/free-preview content: fetches all blocks, returns full content.
 * For paid content: fetches whatever blocks the gateway serves for free
 * (≤16 KiB via free preview tier), flags as truncated if any blocks fail.
 *
 * Images are only returned if ALL blocks are fetched (partial images are useless).
 * Text is returned even if truncated (first N bytes of the document).
 */
export async function fetchContentPreview(
  ref: string,
  declaredMime?: string,
  declaredSize?: number,
): Promise<ContentPreview | null> {
  try {
    // Try GET /asset/:ref first to get the asset root (manifest pointer)
    const assetRes = await fetch(`${GATEWAY}/asset/${ref}`, {
      cache: "no-store",
    });
    if (!assetRes.ok) {
      // Might be a raw block — try direct fetch
      return fetchRawBlockPreview(ref, declaredMime);
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

    // Get file manifest (free — manifests are never L402-gated)
    const fileRes = await fetch(`${GATEWAY}/file/${asset.original.file_root}`, {
      cache: "no-store",
    });
    if (!fileRes.ok) {
      return { text: null, mime, truncated: true, totalSize: size, totalBlocks: 1, blocksFetched: 0 };
    }

    const manifest = (await fileRes.json()) as { blocks: string[] };
    const totalBlocks = manifest.blocks.length;

    // Skip rendering for very large open-access content (>128 KiB)
    // But still attempt for paid content to get a preview
    if (size > INLINE_MAX && !isTextMime(mime) && !mime.startsWith("image/")) {
      return { text: null, mime, truncated: true, totalSize: size, totalBlocks, blocksFetched: 0 };
    }

    // Fetch blocks — stop at first L402 (402 response)
    const chunks: Uint8Array[] = [];
    let truncated = false;
    for (const blockCid of manifest.blocks) {
      const blockRes = await fetch(`${GATEWAY}/block/${blockCid}`, {
        cache: "no-store",
      });
      if (!blockRes.ok) {
        truncated = true;
        break; // L402 or missing — stop fetching
      }
      const bytes = new Uint8Array(await blockRes.arrayBuffer());
      chunks.push(bytes);

      // Stop fetching if we have enough for inline render
      const soFar = chunks.reduce((s, c) => s + c.length, 0);
      if (soFar > INLINE_MAX) break;
    }

    const blocksFetched = chunks.length;

    if (chunks.length === 0) {
      // No blocks fetched — content is fully behind L402
      return { text: null, mime, truncated: true, totalSize: size, totalBlocks, blocksFetched: 0 };
    }

    // Assemble fetched blocks
    const totalFetched = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalFetched);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    // Images: only show if ALL blocks were fetched (partial image is useless)
    if (mime.startsWith("image/")) {
      if (truncated || blocksFetched < totalBlocks) {
        return { text: null, mime, truncated: true, totalSize: size, totalBlocks, blocksFetched };
      }
      if (totalFetched > INLINE_MAX) {
        return { text: null, mime, truncated: false, totalSize: size, totalBlocks, blocksFetched };
      }
      const b64 = Buffer.from(combined).toString("base64");
      return { text: `data:${mime};base64,${b64}`, mime, truncated: false, totalSize: size, totalBlocks, blocksFetched };
    }

    // Text: return what we have, flag if truncated
    if (isTextMime(mime)) {
      const isFullContent = !truncated && blocksFetched >= totalBlocks;
      if (!isFullContent && totalFetched > INLINE_MAX) {
        // Truncate very long previews
        const decoder = new TextDecoder();
        const text = decoder.decode(combined.slice(0, INLINE_MAX));
        return { text, mime, truncated: true, totalSize: size, totalBlocks, blocksFetched };
      }
      const text = new TextDecoder().decode(combined);
      return { text, mime, truncated: !isFullContent, totalSize: size, totalBlocks, blocksFetched };
    }

    // Other MIME types (PDF, etc.): metadata only for now
    return { text: null, mime, truncated, totalSize: size, totalBlocks, blocksFetched };
  } catch {
    return null;
  }
}

/** Legacy wrapper — returns simple { text, mime } for backward compat (widgets, etc.). */
export async function fetchContentForRender(
  ref: string,
  declaredMime?: string,
  declaredSize?: number,
): Promise<{ text: string; mime: string } | null> {
  const preview = await fetchContentPreview(ref, declaredMime, declaredSize);
  if (!preview || !preview.text || preview.truncated) return null;
  return { text: preview.text, mime: preview.mime };
}

async function fetchRawBlockPreview(
  cid: string,
  declaredMime?: string,
): Promise<ContentPreview | null> {
  try {
    const res = await fetch(`${GATEWAY}/block/${cid}`, { cache: "no-store" });
    const mime = declaredMime ?? "application/octet-stream";
    if (!res.ok) {
      // L402-gated block — no preview available
      return { text: null, mime, truncated: true, totalSize: 0, totalBlocks: 1, blocksFetched: 0 };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const size = bytes.length;
    if (isTextMime(mime)) {
      const text = size > INLINE_MAX
        ? new TextDecoder().decode(bytes.slice(0, INLINE_MAX))
        : new TextDecoder().decode(bytes);
      return { text, mime, truncated: size > INLINE_MAX, totalSize: size, totalBlocks: 1, blocksFetched: 1 };
    }
    if (mime.startsWith("image/") && size <= INLINE_MAX) {
      const b64 = Buffer.from(bytes).toString("base64");
      return { text: `data:${mime};base64,${b64}`, mime, truncated: false, totalSize: size, totalBlocks: 1, blocksFetched: 1 };
    }
    return { text: null, mime, truncated: false, totalSize: size, totalBlocks: 1, blocksFetched: 1 };
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

// ── Host pricing ──────────────────────────────────────────────────

/** Get the cheapest TRUSTED host's min_request_sats. Returns null if no hosts. */
export async function getCheapestHostPrice(): Promise<{
  price: number;
  endpoint: string | null;
  hostCount: number;
} | null> {
  const hosts = await getDirectory();
  const trusted = hosts.filter((h) => h.status === "TRUSTED");
  if (trusted.length === 0) return null;
  const cheapest = trusted.reduce((min, h) =>
    h.pricing.min_request_sats < min.pricing.min_request_sats ? h : min,
  );
  return {
    price: cheapest.pricing.min_request_sats,
    endpoint: cheapest.endpoint,
    hostCount: trusted.length,
  };
}

/** Format byte sizes: "1.2 KB", "3.4 MB", etc. */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
