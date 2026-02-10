"use client";

/**
 * Fortify button — fund a pool with sats.
 * Signs a FUND event client-side and POSTs via API proxy.
 *
 * MVP: sats are trusted (no payment verification).
 * TODO: Add payment-intent binding (POST /payreq → LN invoice → verify settlement).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./KeyProvider";
import { createFundEvent, postEvent } from "@/lib/event-client";

const AMOUNTS = [21, 210, 2100];

export function FortifyButton({ poolRef }: { poolRef: string }) {
  const router = useRouter();
  const { publicKeyHex, generate, getPrivateKey } = useIdentity();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!publicKeyHex) {
    return (
      <span>
        <button onClick={generate} className="link-btn">
          [fortify]
        </button>{" "}
        <span className="t">(create key first)</span>
      </span>
    );
  }

  async function send(sats: number) {
    if (sats <= 0 || !Number.isInteger(sats)) return;
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
      const event = await createFundEvent(poolRef, sats, pk, pkHex);
      const result = await postEvent(event);
      if (result.ok) {
        setStatus("sent");
        setOpen(false);
        setTimeout(() => {
          setStatus("idle");
          router.refresh();
        }, 1500);
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

  if (status === "sending") return <span className="t">sending...</span>;
  if (status === "sent") return <span>+ funded</span>;
  if (status === "error")
    return (
      <span>
        failed{errorMsg ? `: ${errorMsg}` : ""} &mdash;{" "}
        <button onClick={() => setStatus("idle")} className="link-btn">
          retry
        </button>
      </span>
    );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="link-btn">
        [fortify]
      </button>
    );
  }

  return (
    <span className="fortify-row">
      {AMOUNTS.map((a) => (
        <button key={a} onClick={() => send(a)} className="link-btn">
          {a}
        </button>
      ))}{" "}
      <input
        type="number"
        min="1"
        placeholder="custom"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        className="inline-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") send(parseInt(custom, 10));
        }}
      />
      <button
        onClick={() => send(parseInt(custom, 10))}
        className="link-btn"
      >
        go
      </button>{" "}
      <span className="t">sat</span>{" "}
      <button onClick={() => setOpen(false)} className="link-btn t">
        x
      </button>
    </span>
  );
}
