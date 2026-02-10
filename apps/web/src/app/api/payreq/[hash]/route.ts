/**
 * API proxy: GET /api/payreq/:hash → coordinator GET /payreq/:payment_hash.
 * Client polls this to check if the Lightning invoice has been paid.
 */

import { NextRequest, NextResponse } from "next/server";

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  try {
    const { hash } = await params;
    const res = await fetch(`${COORDINATOR}/payreq/${hash}`, {
      cache: "no-store",
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
