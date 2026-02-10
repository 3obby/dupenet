import { getFeedFunded, fmtSats, shortHex } from "@/lib/api";

export const revalidate = 30;

export default async function Leaderboard() {
  const items = await getFeedFunded(0, 100);

  return (
    <>
      <header>
        <b>dupenet</b> &mdash; content ranked by economic commitment
      </header>
      <hr />
      {items.length === 0 ? (
        <p className="t">no funded content yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="r">#</th>
              <th className="r">sat</th>
              <th className="r">hosts</th>
              <th>title</th>
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
                  <td className="r t">{i + 1}</td>
                  <td className="r">{fmtSats(item.balance)}</td>
                  <td className="r">{item.host_count}</td>
                  <td className="w">
                    <a href={`/v/${item.pool_key}`}>{title}</a>
                  </td>
                  <td>
                    <a href={`/p/${item.pool_key}`} className="t">
                      proof
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
