"use client";

/**
 * Comment box — post a threaded reply.
 * Signs a POST event client-side and POSTs via API proxy.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./KeyProvider";
import { createPostEvent, postEvent } from "@/lib/event-client";

export function CommentBox({ parentRef }: { parentRef: string }) {
  const router = useRouter();
  const { publicKeyHex, generate, getPrivateKey } = useIdentity();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!publicKeyHex) {
    return (
      <span className="t">
        <button onClick={generate} className="link-btn">
          [create key to comment]
        </button>
      </span>
    );
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const pkHex = publicKeyHex;
    if (!pkHex) return;

    setStatus("sending");
    setErrorMsg("");
    try {
      const pk = await getPrivateKey();
      if (!pk) {
        setStatus("error");
        setErrorMsg("key not found");
        return;
      }
      const event = await createPostEvent(parentRef, trimmed, pk, pkHex);
      const result = await postEvent(event);
      if (result.ok) {
        setStatus("sent");
        setText("");
        setTimeout(() => {
          setStatus("idle");
          router.refresh();
        }, 1000);
      } else {
        setStatus("error");
        setErrorMsg(result.error ?? "unknown error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  if (status === "sending") return <span className="t">posting...</span>;
  if (status === "sent") return <span>+ posted</span>;
  if (status === "error")
    return (
      <span>
        failed{errorMsg ? `: ${errorMsg}` : ""} &mdash;{" "}
        <button onClick={() => setStatus("idle")} className="link-btn">
          retry
        </button>
      </span>
    );

  return (
    <div className="comment-box">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="comment..."
        rows={3}
        className="comment-input"
      />
      <br />
      <button
        onClick={submit}
        className="link-btn"
        disabled={!text.trim()}
      >
        [post]
      </button>
    </div>
  );
}
