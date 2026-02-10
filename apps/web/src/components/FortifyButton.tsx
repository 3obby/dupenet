"use client";

/**
 * +฿ button — fund a pool via Lightning.
 * On success, cycles through the 4-pack (฿ 𓀠 💿 ◷) showing impact.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./KeyProvider";
import {
  buildFundEvent,
  getEventHash,
  signUnsignedEvent,
  postEvent,
  requestPayment,
  checkPaymentStatus,
  type UnsignedEvent,
} from "@/lib/event-client";
import { hasWebLN, payWithWebLN } from "@/lib/webln";

const AMOUNTS = [210, 21_000, 21_000_000];
const AMOUNT_LABELS: Record<number, string> = { 210: "210", 21000: "21k", 21000000: "21m" };
function amtLabel(n: number): string { return AMOUNT_LABELS[n] ?? String(n); }

// The 4-pack icons for the success cycle
const CYCLE_ICONS = ["\u0e3f", "\ud80c\udc20", "\ud83d\udcbf", "\u25f7"];

interface ContentStats {
  balance: number;
  funder_count: number;
  host_count: number;
}

type FortifyState =
  | { step: "idle" }
  | { step: "picking" }
  | { step: "requesting" }
  | { step: "paying"; invoice: string; paymentHash: string; event: UnsignedEvent }
  | { step: "confirming"; event: UnsignedEvent }
  | { step: "cycling"; idx: number }
  | { step: "error"; message: string };

export function FortifyButton({
  poolRef,
  stats,
}: {
  poolRef: string;
  stats?: ContentStats;
}) {
  const router = useRouter();
  const { publicKeyHex, generate, getPrivateKey } = useIdentity();
  const [state, setState] = useState<FortifyState>({ step: "idle" });
  const [custom, setCustom] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (cycleRef.current) clearInterval(cycleRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null; }
    setState({ step: "idle" });
  }, []);

  // Start the 4-pack cycle animation, then refresh
  const startCycle = useCallback(() => {
    let idx = 0;
    setState({ step: "cycling", idx: 0 });
    cycleRef.current = setInterval(() => {
      idx++;
      if (idx >= CYCLE_ICONS.length) {
        if (cycleRef.current) clearInterval(cycleRef.current);
        cycleRef.current = null;
        setState({ step: "idle" });
        router.refresh();
      } else {
        setState({ step: "cycling", idx });
      }
    }, 350);
  }, [router]);

  if (!publicKeyHex) {
    return (
      <button onClick={generate} className="link-btn" title="create key to fund">
        {"+\u0e3f"}
      </button>
    );
  }

  async function startFortify(sats: number) {
    if (sats <= 0 || !Number.isInteger(sats)) return;
    const pkHex = publicKeyHex;
    if (!pkHex) return;

    setState({ step: "requesting" });

    try {
      const unsignedEvent = buildFundEvent(poolRef, sats, pkHex);
      const eventHash = getEventHash(unsignedEvent);
      const payreq = await requestPayment(sats, eventHash);

      if (payreq.error) {
        setState({ step: "error", message: payreq.error });
        return;
      }

      if (payreq.dev_mode) {
        setState({ step: "confirming", event: unsignedEvent });
        await signAndPost(unsignedEvent);
        return;
      }

      if (payreq.invoice && hasWebLN()) {
        setState({ step: "confirming", event: unsignedEvent });
        const preimage = await payWithWebLN(payreq.invoice);
        if (preimage) {
          await signAndPost(unsignedEvent);
          return;
        }
      }

      if (payreq.invoice && payreq.payment_hash) {
        setState({
          step: "paying",
          invoice: payreq.invoice,
          paymentHash: payreq.payment_hash,
          event: unsignedEvent,
        });
        pollRef.current = setInterval(async () => {
          try {
            const status = await checkPaymentStatus(payreq.payment_hash!);
            if (status.settled) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setState({ step: "confirming", event: unsignedEvent });
              await signAndPost(unsignedEvent);
            }
          } catch { /* keep polling */ }
        }, 3000);
        return;
      }

      setState({ step: "error", message: "unexpected response" });
    } catch (e) {
      setState({ step: "error", message: String(e) });
    }
  }

  async function signAndPost(unsignedEvent: UnsignedEvent) {
    try {
      const pk = await getPrivateKey();
      if (!pk) { setState({ step: "error", message: "key not found" }); return; }
      const signed = await signUnsignedEvent(unsignedEvent, pk);
      const result = await postEvent(signed);
      if (result.ok) {
        startCycle();
      } else {
        setState({ step: "error", message: result.error ?? "rejected" });
      }
    } catch (e) {
      setState({ step: "error", message: String(e) });
    }
  }

  // ── Render ────────────────────────────────────────────────

  if (state.step === "idle") {
    return (
      <button onClick={() => setState({ step: "picking" })} className="link-btn">
        {"+\u0e3f"}
      </button>
    );
  }

  if (state.step === "picking") {
    return (
      <span className="fortify-row">
        {AMOUNTS.map((a) => (
          <button key={a} onClick={() => startFortify(a)} className="link-btn">
            {amtLabel(a)}
          </button>
        ))}{" "}
        <input
          type="number"
          min="1"
          placeholder="_"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="inline-input"
          onKeyDown={(e) => { if (e.key === "Enter") startFortify(parseInt(custom, 10)); }}
        />
        <button onClick={() => startFortify(parseInt(custom, 10))} className="link-btn">
          {"\u0e3f"}
        </button>
        {" "}
        <button onClick={reset} className="link-btn t">x</button>
      </span>
    );
  }

  if (state.step === "requesting" || state.step === "confirming") {
    return <span className="t">{"\u0e3f"}...</span>;
  }

  if (state.step === "cycling") {
    return <span className="cycle-icon">{CYCLE_ICONS[state.idx]}</span>;
  }

  if (state.step === "paying") {
    const shortInv = state.invoice.slice(0, 36) + "...";
    return (
      <div className="invoice-box">
        <a href={`lightning:${state.invoice}`} className="invoice-link">{shortInv}</a>
        {" "}
        <button onClick={() => navigator.clipboard.writeText(state.invoice).catch(() => {})} className="link-btn">
          copy
        </button>
        <br />
        <span className="t">{"\u0e3f"}...</span>
        {" "}
        <button onClick={reset} className="link-btn t">x</button>
      </div>
    );
  }

  if (state.step === "error") {
    return (
      <span>
        <span className="t">{state.message}</span>
        {" "}
        <button onClick={reset} className="link-btn">
          {"+\u0e3f"}
        </button>
      </span>
    );
  }

  return null;
}
