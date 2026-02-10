"use client";

/**
 * Fortify button — fund a pool with sats via Lightning payment.
 *
 * Payment flow:
 *   1. User picks amount → build unsigned FUND event → compute event_hash
 *   2. POST /api/payreq { sats, event_hash } → get invoice (or dev_mode)
 *   3a. Dev mode: sign event → POST /api/event → done
 *   3b. WebLN available: auto-pay → sign event → POST → done
 *   3c. No WebLN: show invoice string → user pays externally → poll status → sign + POST
 *
 * DocRef: MVP_PLAN:§New User Journey (Fortify conversion)
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

const AMOUNTS = [21, 210, 2100];

type FortifyState =
  | { step: "idle" }
  | { step: "picking" }
  | { step: "requesting" }
  | { step: "paying"; invoice: string; paymentHash: string; event: UnsignedEvent }
  | { step: "confirming"; event: UnsignedEvent }
  | { step: "done" }
  | { step: "error"; message: string };

export function FortifyButton({ poolRef }: { poolRef: string }) {
  const router = useRouter();
  const { publicKeyHex, generate, getPrivateKey } = useIdentity();
  const [state, setState] = useState<FortifyState>({ step: "idle" });
  const [custom, setCustom] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setState({ step: "idle" });
  }, []);

  // No identity yet
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

  async function startFortify(sats: number) {
    if (sats <= 0 || !Number.isInteger(sats)) return;
    const pkHex = publicKeyHex;
    if (!pkHex) return;

    setState({ step: "requesting" });

    try {
      // 1. Build unsigned event + compute hash
      const unsignedEvent = buildFundEvent(poolRef, sats, pkHex);
      const eventHash = getEventHash(unsignedEvent);

      // 2. Request payment
      const payreq = await requestPayment(sats, eventHash);

      if (payreq.error) {
        setState({ step: "error", message: payreq.error });
        return;
      }

      // 3a. Dev mode — no payment needed
      if (payreq.dev_mode) {
        setState({ step: "confirming", event: unsignedEvent });
        await signAndPost(unsignedEvent);
        return;
      }

      // 3b. Try WebLN auto-pay
      if (payreq.invoice && hasWebLN()) {
        setState({ step: "confirming", event: unsignedEvent });
        const preimage = await payWithWebLN(payreq.invoice);
        if (preimage) {
          // Payment succeeded via WebLN
          await signAndPost(unsignedEvent);
          return;
        }
        // WebLN failed (user cancelled or error) — fall through to manual
      }

      // 3c. Show invoice for manual payment
      if (payreq.invoice && payreq.payment_hash) {
        setState({
          step: "paying",
          invoice: payreq.invoice,
          paymentHash: payreq.payment_hash,
          event: unsignedEvent,
        });

        // Start polling for payment
        pollRef.current = setInterval(async () => {
          try {
            const status = await checkPaymentStatus(payreq.payment_hash!);
            if (status.settled) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setState({ step: "confirming", event: unsignedEvent });
              await signAndPost(unsignedEvent);
            }
          } catch {
            // Ignore poll errors, keep trying
          }
        }, 3000);
        return;
      }

      setState({ step: "error", message: "unexpected payreq response" });
    } catch (e) {
      setState({ step: "error", message: String(e) });
    }
  }

  async function signAndPost(unsignedEvent: UnsignedEvent) {
    try {
      const pk = await getPrivateKey();
      if (!pk) {
        setState({ step: "error", message: "key not found" });
        return;
      }
      const signed = await signUnsignedEvent(unsignedEvent, pk);
      const result = await postEvent(signed);
      if (result.ok) {
        setState({ step: "done" });
        setTimeout(() => {
          reset();
          router.refresh();
        }, 1500);
      } else {
        setState({ step: "error", message: result.error ?? "event rejected" });
      }
    } catch (e) {
      setState({ step: "error", message: String(e) });
    }
  }

  function copyInvoice(invoice: string) {
    navigator.clipboard.writeText(invoice).catch(() => {});
  }

  // ── Render ────────────────────────────────────────────────

  if (state.step === "idle") {
    return (
      <button onClick={() => setState({ step: "picking" })} className="link-btn">
        [fortify]
      </button>
    );
  }

  if (state.step === "picking") {
    return (
      <span className="fortify-row">
        {AMOUNTS.map((a) => (
          <button key={a} onClick={() => startFortify(a)} className="link-btn">
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
            if (e.key === "Enter") startFortify(parseInt(custom, 10));
          }}
        />
        <button
          onClick={() => startFortify(parseInt(custom, 10))}
          className="link-btn"
        >
          go
        </button>{" "}
        <span className="t">sat</span>{" "}
        <button onClick={reset} className="link-btn t">
          x
        </button>
      </span>
    );
  }

  if (state.step === "requesting" || state.step === "confirming") {
    return <span className="t">
      {state.step === "requesting" ? "creating invoice..." : "confirming..."}
    </span>;
  }

  if (state.step === "paying") {
    const shortInvoice = state.invoice.slice(0, 40) + "...";
    return (
      <div className="invoice-box">
        <span className="t">pay this invoice to fortify:</span>
        <br />
        <a
          href={`lightning:${state.invoice}`}
          className="invoice-link"
          title="Open in Lightning wallet"
        >
          {shortInvoice}
        </a>{" "}
        <button
          onClick={() => copyInvoice(state.invoice)}
          className="link-btn"
          title="Copy full invoice"
        >
          copy
        </button>
        <br />
        <span className="t">waiting for payment...</span>{" "}
        <button onClick={reset} className="link-btn t">
          cancel
        </button>
      </div>
    );
  }

  if (state.step === "done") {
    return <span>+ funded</span>;
  }

  if (state.step === "error") {
    return (
      <span>
        failed: {state.message} &mdash;{" "}
        <button onClick={reset} className="link-btn">
          retry
        </button>
      </span>
    );
  }

  return null;
}
