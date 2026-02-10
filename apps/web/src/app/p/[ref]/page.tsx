import {
  getContentStats,
  getDirectory,
  getEpochSummary,
  fmtSats,
  shortHex,
} from "@/lib/api";
import { CopyButton } from "@/components/CopyButton";

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

  const [stats, hosts] = await Promise.all([
    getContentStats(ref),
    getDirectory(),
  ]);

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

  const trustedHosts = hosts.filter((h) => h.status === "TRUSTED");

  return (
    <>
      <a href="/">{"\u25c0"}</a>
      {" \u00b7 "}
      <a href={`/v/${ref}`}>{"\u25c0"}</a>
      <hr />

      <pre>{ref}</pre>
      <span className="t">sha256</span>
      {" \u00b7 "}
      <CopyButton text={ref} label="hash" />
      {" \u00b7 "}
      <CopyButton text={`/p/${ref}`} label="url" />
      {" \u00b7 "}
      <a href={`/api/evidence/${ref}`} download>{"\u2913"}json</a>

      <hr />

      <div className="cluster">
        <span>
          <b>{"\u0e3f"}{fmtSats(stats.balance)}</b>
        </span>
        {stats.funder_count > 0 && (
          <span>
            {"\ud80c\udc20"}{stats.funder_count}
          </span>
        )}
        <span>
          {"\ud83d\udcbf"}{stats.host_count}
        </span>
        {stats.last_payout_epoch > 0 && (
          <span className="t">
            {"\u21bb"}{stats.last_payout_epoch}
          </span>
        )}
      </div>

      <hr />

      <span className="t">{"\ud83d\udcbf"}{trustedHosts.length}</span>
      {trustedHosts.length === 0 ? (
        <p className="t">-</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>endpoint</th>
              <th>pk</th>
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

      <span className="t">{"\u2713"}{epochProofs.length}</span>
      {epochProofs.length === 0 ? (
        <p className="t">-</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="r">epoch</th>
              <th>host</th>
              <th className="r">rcpt</th>
              <th className="r">clt</th>
              <th className="r">{"\u0e3f"}</th>
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
