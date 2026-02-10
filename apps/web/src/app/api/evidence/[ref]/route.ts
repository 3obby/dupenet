/**
 * GET /api/evidence/:ref — downloadable evidence bundle.
 * Packages: ref hash, pool stats, trusted hosts, epoch proofs into JSON.
 * For journalists, lawyers, institutions — verifiable proof of content integrity.
 */

import { NextRequest, NextResponse } from "next/server";

const COORDINATOR = process.env.COORDINATOR_URL ?? "http://localhost:3102";

interface Pool {
  balance: number;
  last_payout_epoch: number;
}

interface ContentStats {
  balance: number;
  total_funded: number;
  funder_count: number;
  host_count: number;
  last_payout_epoch: number;
}

interface Host {
  pubkey: string;
  endpoint: string | null;
  status: string;
  availability_score: number;
}

interface EpochProof {
  epoch: number;
  host: string;
  cid: string;
  receipt_count: number;
  unique_clients: number;
  reward_sats: number;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${COORDINATOR}${path}`);
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
    return NextResponse.json({ error: "invalid_ref" }, { status: 422 });
  }

  // Fetch all proof data in parallel
  const [stats, hostsData] = await Promise.all([
    fetchJson<ContentStats>(`/content/${ref}/stats`),
    fetchJson<{ hosts: Host[] }>("/directory"),
  ]);

  // Epoch proofs (last 6 epochs)
  const nowMs = Date.now();
  const epochLengthMs = 4 * 60 * 60_000;
  const currentEpoch = Math.floor(nowMs / epochLengthMs);

  const epochProofs: (EpochProof & { epoch: number })[] = [];
  for (let e = currentEpoch - 1; e >= Math.max(0, currentEpoch - 6); e--) {
    const data = await fetchJson<{ settled: boolean; summaries: EpochProof[] }>(
      `/epoch/summary/${e}`,
    );
    if (data?.summaries) {
      for (const s of data.summaries) {
        if (s.cid === ref || s.host === ref) {
          epochProofs.push({ ...s, epoch: e });
        }
      }
    }
  }

  const trustedHosts = (hostsData?.hosts ?? []).filter(
    (h) => h.status === "TRUSTED",
  );

  // Assemble evidence bundle
  const bundle = {
    version: 1,
    type: "evidence_bundle",
    ref,
    generated_at: new Date().toISOString(),
    generated_epoch: currentEpoch,
    integrity: {
      algorithm: "sha256",
      hash: ref,
      note: "content hash verified on ingest — bytes match this hash",
    },
    pool: {
      balance_sats: stats?.balance ?? 0,
      total_funded_sats: stats?.total_funded ?? 0,
      unique_funders: stats?.funder_count ?? 0,
      last_payout_epoch: stats?.last_payout_epoch ?? 0,
    },
    hosts: {
      serving_count: stats?.host_count ?? 0,
      trusted: trustedHosts.map((h) => ({
        pubkey: h.pubkey,
        endpoint: h.endpoint,
        availability_score: h.availability_score,
      })),
    },
    epoch_proofs: epochProofs.map((p) => ({
      epoch: p.epoch,
      host: p.host,
      receipt_count: p.receipt_count,
      unique_clients: p.unique_clients,
      reward_sats: p.reward_sats,
    })),
  };

  // Return as downloadable JSON
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="evidence-${ref.slice(0, 12)}.json"`,
    },
  });
}
