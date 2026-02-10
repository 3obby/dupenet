import {
  getEvents,
  getPool,
  fmtSats,
  fmtDate,
  shortHex,
} from "@/lib/api";

export const revalidate = 30;

const KIND_LIST = 0x07;

interface ListBody {
  title?: string;
  description?: string;
  items?: string[];
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return <p>invalid ref</p>;
  }

  // Find the LIST event that created this collection
  // ref could be the list event_id itself — query events whose event_id matches
  const events = await getEvents({ ref, kind: KIND_LIST, limit: 1 });
  const listEvent = events[0];

  if (!listEvent) {
    return (
      <>
        <a href="/">&larr;</a>
        <hr />
        <p>collection not found: {shortHex(ref)}</p>
      </>
    );
  }

  // Decode list body
  let body: ListBody = {};
  try {
    body = (typeof listEvent.body === "string" ? {} : listEvent.body) as ListBody;
  } catch { /* ignore */ }

  const items = body.items ?? [];
  const title = body.title ?? `collection ${shortHex(ref)}`;

  // Fetch pool balance for each item
  const itemData = await Promise.all(
    items.map(async (itemRef) => {
      const pool = await getPool(itemRef);
      return { ref: itemRef, balance: pool.balance };
    }),
  );

  return (
    <>
      <a href="/">&larr;</a>
      <hr />
      <b>{title}</b>
      <br />
      <span className="t">
        {items.length} items | by {shortHex(listEvent.from)} | {fmtDate(listEvent.ts)}
      </span>
      {body.description && (
        <>
          <br />
          <span className="t">{body.description}</span>
        </>
      )}
      <hr />
      {items.length === 0 ? (
        <span className="t">empty collection</span>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="r">sat</th>
              <th>ref</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {itemData.map((item) => (
              <tr key={item.ref}>
                <td className="r">{fmtSats(item.balance)}</td>
                <td>
                  <a href={`/v/${item.ref}`}>{shortHex(item.ref)}</a>
                </td>
                <td>
                  <a href={`/p/${item.ref}`} className="t">
                    proof
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
