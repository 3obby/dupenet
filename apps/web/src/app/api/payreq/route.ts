/**
 * API proxy: POST /api/payreq → coordinator POST /payreq.
 * Creates a Lightning invoice bound to an event_hash.
 */

import { NextRequest, NextResponse } from "next/server";

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${COORDINATOR}/payreq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: "proxy_error", detail: String(e) },
      { status: 502 },
    );
  }
}
