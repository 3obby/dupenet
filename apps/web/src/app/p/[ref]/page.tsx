import {
  getPool,
  getDirectory,
  getEpochSummary,
  fmtSats,
  shortHex,
} from "@/lib/api";

export const revalidate = 30;

export default async function ProofPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return <p>invalid ref</p>;
  }

  // Fetch pool, hosts, and recent epoch proofs in parallel
  const [pool, hosts] = await Promise.all([
    getPool(ref),
    getDirectory(),
  ]);

  // Get recent epoch summaries (last 6 epochs ≈ 24h)
  // We'd need to know the current epoch — estimate from timestamp
  const nowMs = Date.now();
  const epochLengthMs = 4 * 60 * 60_000;
  const currentEpoch = Math.floor(nowMs / epochLengthMs);

  const epochProofs = [];
  for (let e = currentEpoch - 1; e >= Math.max(0, currentEpoch - 6); e--) {
    const summaries = await getEpochSummary(e);
    const matching = summaries.filter(
      (s) => s.cid === ref || s.host === ref,
    );
    for (const s of matching) {
      epochProofs.push({ ...s, epoch: e });
    }
  }

  // Find hosts that serve this ref
  // (We don't have a direct lookup — show all TRUSTED hosts)
  const trustedHosts = hosts.filter((h) => h.status === "TRUSTED");

  return (
    <>
      <a href="/">&larr;</a>
      {" | "}
      <a href={`/v/${ref}`}>view</a>
      <hr />
      <b>proof</b>
      <br />
      <pre>{ref}</pre>
      <span className="t">sha256 verified on ingest</span>
      <hr />
      {/* Pool */}
      <b>{fmtSats(pool.balance)}</b> sat in pool
      {pool.last_payout_epoch > 0 && (
        <span className="t"> | last payout epoch {pool.last_payout_epoch}</span>
      )}
      <hr />
      {/* Hosts */}
      <b>hosts</b> ({trustedHosts.length} trusted)
      {trustedHosts.length === 0 ? (
        <p className="t">no trusted hosts</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>endpoint</th>
              <th>pubkey</th>
              <th className="r">score</th>
            </tr>
          </thead>
          <tbody>
            {trustedHosts.map((h) => (
              <tr key={h.pubkey}>
                <td>{h.endpoint ?? "-"}</td>
                <td className="t">{shortHex(h.pubkey)}</td>
                <td className="r">{h.availability_score.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <hr />
      {/* Epoch Proofs */}
      <b>epoch proofs</b> ({epochProofs.length})
      {epochProofs.length === 0 ? (
        <p className="t">no epoch proofs found</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="r">epoch</th>
              <th>host</th>
              <th className="r">receipts</th>
              <th className="r">clients</th>
              <th className="r">reward sat</th>
            </tr>
          </thead>
          <tbody>
            {epochProofs.map((p, i) => (
              <tr key={i}>
                <td className="r">{p.epoch}</td>
                <td className="t">{shortHex(p.host)}</td>
                <td className="r">{p.receipt_count}</td>
                <td className="r">{p.unique_clients}</td>
                <td className="r">{fmtSats(p.reward_sats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
