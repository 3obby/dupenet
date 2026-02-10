import { getFeedFunded, getDirectory, fmtSats, shortHex } from "@/lib/api";
import { IdentityChip } from "@/components/KeyProvider";

export const revalidate = 30;

export default async function Leaderboard() {
  const [items, hosts] = await Promise.all([
    getFeedFunded(0, 100),
    getDirectory(),
  ]);

  const totalSats = items.reduce((s, i) => s + i.balance, 0);
  const activeHosts = hosts.filter((h) => h.status === "TRUSTED").length;

  return (
    <>
      <header>
        <b>dupenet</b>
        <span style={{ float: "right" }}>
          <IdentityChip />
        </span>
      </header>
      <hr />

      {items.length === 0 ? (
        <p className="t">-</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="r">
                {"\u0e3f"}
                <span className="t th-stat"> {fmtSats(totalSats)}</span>
              </th>
              <th className="r">#</th>
              <th className="r">
                {"\ud83d\udcbf"}
                <span className="t th-stat"> {activeHosts}</span>
              </th>
              <th>
                <span className="t th-stat">{items.length} items</span>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const title =
                item.metadata?.title ??
                shortHex(item.pool_key);
              return (
                <tr key={item.pool_key}>
                  <td className="r">{fmtSats(item.balance)}</td>
                  <td className="r t">{i + 1}</td>
                  <td className="r">{item.host_count}</td>
                  <td className="w">
                    <a href={`/v/${item.pool_key}`}>{title}</a>
                  </td>
                  <td>
                    <a href={`/p/${item.pool_key}`} className="t">
                      {"\ud83d\udd0d"}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
