"use client";

/**
 * 💬 — post a threaded reply.
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
    "idle" | "mining" | "sending" | "sent" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!publicKeyHex) {
    return (
      <button onClick={generate} className="link-btn" title="create key to comment">
        {"\ud83d\udcac"}
      </button>
    );
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const pkHex = publicKeyHex;
    if (!pkHex) return;

    setStatus("mining");
    setErrorMsg("");
    try {
      const pk = await getPrivateKey();
      if (!pk) { setStatus("error"); setErrorMsg("key not found"); return; }
      const event = await createPostEvent(parentRef, trimmed, pk, pkHex, () => {
        setStatus("mining");
      });
      setStatus("sending");
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
        setErrorMsg(result.error ?? "rejected");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  if (status === "mining") return <span className="t">{"\ud83d\udcac"}mining...</span>;
  if (status === "sending") return <span className="t">{"\ud83d\udcac"}sending...</span>;
  if (status === "sent") return <span>{"\ud83d\udcac"}{"\u2713"}</span>;
  if (status === "error")
    return (
      <span>
        <span className="t">{errorMsg}</span>
        {" "}
        <button onClick={() => setStatus("idle")} className="link-btn">
          {"\ud83d\udcac"}
        </button>
      </span>
    );

  return (
    <div className="comment-box">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="comment-input"
      />
      <br />
      <button onClick={submit} className="link-btn" disabled={!text.trim()}>
        {"\ud83d\udcac"}
      </button>
    </div>
  );
}
