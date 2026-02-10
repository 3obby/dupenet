/**
 * GET /api/widget/:ref — embeddable content card for a single ref.
 * Returns self-contained HTML with inline styles. Embed via iframe.
 * Usage: <iframe src="https://ocdn.is/api/widget/abc123..." width="320" height="100"></iframe>
 *
 * Shows: title, ฿ balance, 𓀠 funders, 💿 copies, ◷ runway, +฿ link.
 */

import { NextRequest, NextResponse } from "next/server";

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200";

interface ContentStats {
  balance: number;
  total_funded: number;
  funder_count: number;
  host_count: number;
  last_payout_epoch: number;
}

interface ProtocolEvent {
  event_id: string;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
}

function fmtBtc(sats: number): string {
  const s = String(Math.abs(Math.round(sats)));
  const padded = s.padStart(9, "0");
  const i = padded.length - 8;
  return padded.slice(0, i) + "." + padded.slice(i);
}

function estRunway(balance: number, hosts: number): string {
  if (hosts === 0 || balance === 0) return "-";
  const drain = balance * 0.02 * 6 * 30;
  if (drain === 0) return "-";
  const mo = Math.floor(balance / drain);
  return mo > 99 ? "99+" : String(mo);
}

async function fetchJson<T>(path: string): Promise<T | null> {
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return new NextResponse("invalid ref", { status: 422 });
  }

  // Fetch stats + announce metadata in parallel
  const [stats, eventsData] = await Promise.all([
    fetchJson<ContentStats>(`/content/${ref}/stats`),
    fetchJson<{ events: ProtocolEvent[] }>(`/events?ref=${ref}&kind=2&limit=1`),
  ]);

  const bal = stats?.balance ?? 0;
  const funders = stats?.funder_count ?? 0;
  const copies = stats?.host_count ?? 0;
  const runway = estRunway(bal, Math.max(copies, 1));

  // Decode title from ANNOUNCE body
  let title = ref.slice(0, 12) + "..";
  const announce = eventsData?.events?.[0];
  if (announce?.body) {
    try {
      // Body is hex-encoded CBOR — we can't decode CBOR here easily,
      // so fall back to a simple approach: check if the coordinator
      // already decoded it (some endpoints return decoded body as object)
      const bodyObj = announce.body as unknown;
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const t = (bodyObj as Record<string, unknown>).title;
        if (typeof t === "string") title = t;
      }
    } catch { /* keep short hex */ }
  }

  const viewUrl = `${SITE_URL}/v/${ref}`;
  const proofUrl = `${SITE_URL}/p/${ref}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:12px/1.5 monospace;background:#fff;color:#000;padding:6px}
a{color:#00e;text-decoration:none}a:hover{text-decoration:underline}
.title{font-weight:bold;margin-bottom:2px}
.title a{color:#000}
.cluster{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0}
.cluster span{white-space:nowrap}
.t{color:#666}
.actions{margin-top:4px}
.actions a{margin-right:8px}
hr{border:0;border-top:1px solid #ccc;margin:4px 0}
</style></head><body>
<div class="title"><a href="${viewUrl}" target="_blank" rel="noopener">${esc(title)}</a></div>
<div class="cluster">
  <span><b>\u0e3f${fmtBtc(bal)}</b></span>
  ${funders > 0 ? `<span>\ud80c\udc20${funders}</span>` : ""}
  <span>\ud83d\udcbf${copies}</span>
  <span class="t">\u25f7~${runway}mo</span>
</div>
<hr>
<div class="actions">
  <a href="${viewUrl}" target="_blank" rel="noopener">+\u0e3f</a>
  <a href="${proofUrl}" target="_blank" rel="noopener" class="t">\ud83d\udd0d</a>
</div>
</body></html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=30",
    },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
