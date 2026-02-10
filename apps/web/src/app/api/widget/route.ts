/**
 * GET /api/widget — embeddable mini leaderboard (top 5).
 * Returns self-contained HTML with inline styles. Embed via iframe.
 * Usage: <iframe src="https://ocdn.is/api/widget" width="320" height="240"></iframe>
 */

import { NextRequest, NextResponse } from "next/server";

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200";

interface FundedItem {
  pool_key: string;
  balance: number;
  host_count: number;
  metadata: { title?: string } | null;
}

function fmtBtc(sats: number): string {
  const s = String(Math.abs(Math.round(sats)));
  const padded = s.padStart(9, "0");
  const i = padded.length - 8;
  return padded.slice(0, i) + "." + padded.slice(i);
}

function shortHex(hex: string): string {
  return hex.length <= 12 ? hex : hex.slice(0, 6) + "..";
}

export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("n") ?? "5", 10),
    10,
  );

  let items: FundedItem[] = [];
  try {
    const res = await fetch(
      `${COORDINATOR}/feed/funded?min_balance=0&limit=${limit}`,
      { next: { revalidate: 30 } },
    );
    if (res.ok) {
      const data = (await res.json()) as { items: FundedItem[] };
      items = data.items ?? [];
    }
  } catch { /* empty leaderboard */ }

  const totalSats = items.reduce((s, i) => s + i.balance, 0);

  const rows = items
    .map((item, i) => {
      const title = item.metadata?.title ?? shortHex(item.pool_key);
      const href = `${SITE_URL}/v/${item.pool_key}`;
      return `<tr>
        <td class="r t">${i + 1}</td>
        <td class="r">฿${fmtBtc(item.balance)}</td>
        <td class="r">${item.host_count}</td>
        <td class="w"><a href="${href}" target="_blank" rel="noopener">${esc(title)}</a></td>
      </tr>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font:12px/1.5 monospace;background:#fff;color:#000;padding:6px}
a{color:#00e;text-decoration:none}a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%}
td,th{text-align:left;padding:1px 6px 1px 0;white-space:nowrap}
th{border-bottom:1px solid #000;font-size:11px}
.r{text-align:right}.t{color:#666}
.w{white-space:normal;max-width:160px;overflow:hidden;text-overflow:ellipsis}
.hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}
.hdr a{font-weight:bold}
hr{border:0;border-top:1px solid #ccc;margin:4px 0}
</style></head><body>
<div class="hdr">
  <a href="${SITE_URL}" target="_blank" rel="noopener">dupenet</a>
  <span class="t">\u0e3f${fmtBtc(totalSats)}</span>
</div>
<hr>
${items.length === 0 ? '<span class="t">-</span>' : `<table>
<thead><tr><th class="r">#</th><th class="r">\u0e3f</th><th class="r">\ud83d\udcbf</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>`}
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
