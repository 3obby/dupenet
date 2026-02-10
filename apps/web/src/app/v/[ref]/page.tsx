import {
  getPool,
  getEvents,
  getThread,
  fmtSats,
  fmtDate,
  shortHex,
  estRunway,
  GATEWAY,
  type ThreadNode,
} from "@/lib/api";

export const revalidate = 30;

// Event kind constants (duplicated to avoid importing physics in browser)
const KIND_ANNOUNCE = 0x02;
const KIND_LIST = 0x07;

export default async function ContentPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return <p>invalid ref</p>;
  }

  // Fetch pool balance, announce events, and thread in parallel
  const [pool, announceEvents, listEvents] = await Promise.all([
    getPool(ref),
    getEvents({ ref, kind: KIND_ANNOUNCE, limit: 1 }),
    getEvents({ ref, kind: KIND_LIST, limit: 1 }),
  ]);

  const announce = announceEvents[0];
  const list = listEvents[0];

  // Try to load thread from the first announce or list event
  const rootEventId = announce?.event_id ?? list?.event_id;
  const thread = rootEventId ? await getThread(rootEventId) : null;

  // Parse announce body for metadata
  let meta: Record<string, unknown> = {};
  if (announce) {
    try {
      meta = (typeof announce.body === "string" ? {} : announce.body) as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  const title = (meta.title as string) ?? shortHex(ref);
  const description = meta.description as string | undefined;
  const tags = meta.tags as string[] | undefined;
  const mime = meta.mime as string | undefined;
  const access = (meta.access as string) ?? "paid";
  const from = announce?.from ?? list?.from;
  const ts = announce?.ts ?? list?.ts;
  const hostCount = 0; // would need directory cross-ref; shown on leaderboard

  return (
    <>
      <a href="/">&larr;</a>
      <hr />
      <b>{title}</b>
      <br />
      {from && (
        <span className="t">
          {shortHex(from)} {ts ? `| ${fmtDate(ts)}` : ""}
        </span>
      )}
      {description && (
        <>
          <br />
          <span className="t">{description}</span>
        </>
      )}
      {tags && tags.length > 0 && (
        <>
          <br />
          <span className="t">[{tags.join(", ")}]</span>
        </>
      )}
      <hr />
      {/* Stats row */}
      <table>
        <tbody>
          <tr>
            <td className="r"><b>{fmtSats(pool.balance)}</b> sat</td>
            <td className="r">{access === "open" ? "open" : "paid"}</td>
            <td className="r">~{estRunway(pool.balance, 1)} mo</td>
            <td>
              {mime ?? ""}
            </td>
          </tr>
        </tbody>
      </table>
      <hr />
      {/* Download link */}
      <a href={`${GATEWAY}/cid/${ref}`}>download</a>
      {" | "}
      <a href={`/p/${ref}`}>proof</a>
      <hr />
      {/* Thread */}
      {thread && thread.replies.length > 0 ? (
        <>
          <b>thread</b> ({countReplies(thread)})
          <br />
          <ThreadTree nodes={thread.replies} depth={0} />
        </>
      ) : (
        <span className="t">no comments</span>
      )}
    </>
  );
}

function ThreadTree({ nodes, depth }: { nodes: ThreadNode[]; depth: number }) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.event_id} style={{ paddingLeft: depth * 16 }}>
          <span className="t">{shortHex(node.from)}</span>
          {node.sats > 0 && <> | {fmtSats(node.sats)} sat</>}
          {" | "}
          <span className="t">{fmtDate(node.ts)}</span>
          <br />
          {(node.body as Record<string, unknown>)?.text as string ?? ""}
          {node.replies.length > 0 && (
            <ThreadTree nodes={node.replies} depth={depth + 1} />
          )}
          <br />
        </div>
      ))}
    </>
  );
}

function countReplies(node: ThreadNode): number {
  let count = node.replies.length;
  for (const r of node.replies) count += countReplies(r);
  return count;
}
