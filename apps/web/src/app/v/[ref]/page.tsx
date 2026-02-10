import {
  getContentStats,
  getEvents,
  getThread,
  fmtSats,
  fmtDate,
  shortHex,
  estRunway,
  timeAgo,
  GATEWAY,
  type ThreadNode,
} from "@/lib/api";
import { FortifyButton } from "@/components/FortifyButton";
import { CommentBox } from "@/components/CommentBox";

export const revalidate = 30;

const KIND_ANNOUNCE = 0x02;
const KIND_LIST = 0x07;
const KIND_FUND = 0x01;
const KIND_POST = 0x03;

export default async function ContentPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  if (!/^[0-9a-f]{64}$/.test(ref)) {
    return <p>invalid ref</p>;
  }

  const [stats, announceEvents, listEvents] = await Promise.all([
    getContentStats(ref),
    getEvents({ ref, kind: KIND_ANNOUNCE, limit: 1 }),
    getEvents({ ref, kind: KIND_LIST, limit: 1 }),
  ]);

  const announce = announceEvents[0];
  const list = listEvents[0];
  const rootEventId = announce?.event_id ?? list?.event_id;
  const thread = rootEventId ? await getThread(rootEventId) : null;

  let meta: Record<string, unknown> = {};
  if (announce) {
    try {
      meta = (typeof announce.body === "string" ? {} : announce.body) as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  const title = (meta.title as string) ?? shortHex(ref);
  const description = meta.description as string | undefined;
  const tags = meta.tags as string[] | undefined;
  const access = (meta.access as string) ?? "paid";
  const from = announce?.from ?? list?.from;
  const ts = announce?.ts ?? list?.ts;
  const threadCount = thread ? countReplies(thread) : 0;

  return (
    <>
      <a href="/">{"\u25c0"}</a>
      {list && (
        <>
          {" \u00b7 "}
          <a href={`/c/${list.ref}`} title="collection">{"\u25c0"}</a>
        </>
      )}
      <hr />

      <b>{title}</b>
      {from && (
        <>
          <br />
          <span className="t">
            {shortHex(from)}{ts ? ` \u00b7 ${fmtDate(ts)}` : ""}
          </span>
        </>
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

      {/* Instrument cluster */}
      <div className="cluster">
        <span title="sats in pool">
          <b>{"\u0e3f"}{fmtSats(stats.balance)}</b>
        </span>
        {stats.funder_count > 0 && (
          <span title="unique funders">
            {"\ud80c\udc20"}{stats.funder_count}
          </span>
        )}
        <span title="copies">
          {"\ud83d\udcbf"}{stats.host_count}
        </span>
        <span className="t" title="runway">
          {"\u25f7"}~{estRunway(stats.balance, Math.max(stats.host_count, 1))}mo
        </span>
        <span className="t">
          {access === "open" ? "\u25cb" : "\u25cf"}
        </span>
      </div>

      <hr />

      {/* Actions */}
      <FortifyButton poolRef={ref} stats={stats} />
      {" \u00b7 "}
      <a href={`${GATEWAY}/cid/${ref}`} title="download">{"\u2913"}</a>
      {" \u00b7 "}
      <a href={`/p/${ref}`} title="proof">{"\ud83d\udd0d"}</a>

      {/* Activity pulse */}
      {stats.recent.length > 0 && (
        <>
          <hr />
          <div className="activity">
            {stats.recent.slice(0, 5).map((e, i) => (
              <span key={i} className="t">
                {i > 0 && " \u00b7 "}
                {e.kind === KIND_FUND && <>{"+\u0e3f"}{fmtSats(e.sats)}</>}
                {e.kind === KIND_POST && <>{"\ud83d\udcac"}</>}
                {e.kind !== KIND_FUND && e.kind !== KIND_POST && <>{"\u2022"}</>}
                {" "}{shortHex(e.from)}
                {" "}{timeAgo(e.ts)}
              </span>
            ))}
          </div>
        </>
      )}

      <hr />

      {/* Thread */}
      {threadCount > 0 ? (
        <>
          <span className="t">{"\ud83d\udcac"}{threadCount}</span>
          <br />
          <ThreadTree nodes={thread!.replies} depth={0} />
        </>
      ) : (
        <span className="t">{"\ud83d\udcac"}0</span>
      )}

      <hr />

      <CommentBox parentRef={rootEventId ?? ref} />
    </>
  );
}

function ThreadTree({ nodes, depth }: { nodes: ThreadNode[]; depth: number }) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.event_id} style={{ paddingLeft: depth * 16 }}>
          <span className="t">
            {shortHex(node.from)}
            {node.sats > 0 && <> \u00b7 {"\u0e3f"}{fmtSats(node.sats)}</>}
            {" \u00b7 "}{timeAgo(node.ts)}
          </span>
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
