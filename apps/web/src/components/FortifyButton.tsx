"use client";

/**
 * +฿ button — fund a pool via Lightning.
 *
 * Opens a bottom-sheet/modal with tier presets (Gold/Silver/Bronze) and
 * custom amount. Payment state shows QR code + auto-poll spinner.
 * On success, cycles through the 4-pack (฿ 𓀠 💿 ◷) showing impact.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./KeyProvider";
import { LightningQR } from "./QRCode";
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

/* ── Tier presets (mapped to FUND events; real PRESERVE in Sprint F) ── */

interface Tier {
  label: string;
  sats: number;
  desc: string;
}

const TIERS: Tier[] = [
  { label: "Gold",   sats: 21_000_000, desc: "~10 replicas · 6+ mo" },
  { label: "Silver", sats: 21_000,     desc: "~5 replicas · 3 mo" },
  { label: "Bronze", sats: 210,        desc: "~3 replicas · 1 mo" },
];

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
  | { step: "requesting"; sats: number }
  | { step: "paying"; invoice: string; paymentHash: string; event: UnsignedEvent; sats: number }
  | { step: "confirming"; event: UnsignedEvent }
  | { step: "cycling"; idx: number }
  | { step: "error"; message: string };

export function FortifyButton({
  poolRef,
  stats,
  inline,
}: {
  poolRef: string;
  stats?: ContentStats;
  /** Compact mode for leaderboard rows (no modal, just link). */
  inline?: boolean;
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

  // ── Inline mode (for leaderboard rows) ──────────────────────────

  if (inline) {
    return (
      <a href={`/v/${poolRef}#fortify`} className="link-btn" title="fortify">
        {"+\u0e3f"}
      </a>
    );
  }

  // ── No key yet ──────────────────────────────────────────────────

  if (!publicKeyHex) {
    return (
      <button onClick={generate} className="link-btn" title="create key to fund">
        {"+\u0e3f"}
      </button>
    );
  }

  // ── Payment logic ───────────────────────────────────────────────

  async function startFortify(sats: number) {
    if (sats <= 0 || !Number.isInteger(sats)) return;
    const pkHex = publicKeyHex;
    if (!pkHex) return;

    setState({ step: "requesting", sats });

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
          sats,
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

  // ── Render ────────────────────────────────────────────────────

  // Idle: just the +฿ trigger
  if (state.step === "idle") {
    return (
      <button
        id="fortify"
        onClick={() => setState({ step: "picking" })}
        className="link-btn"
      >
        {"+\u0e3f"}
      </button>
    );
  }

  // Cycling: success animation
  if (state.step === "cycling") {
    return <span className="cycle-icon">{CYCLE_ICONS[state.idx]}</span>;
  }

  // Error: message + retry
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

  // ── Bottom-sheet modal (picking / requesting / paying / confirming) ──

  return (
    <>
      <button onClick={reset} className="link-btn">
        {"+\u0e3f"}
      </button>

      {/* Backdrop */}
      <div className="fortify-backdrop" onClick={reset} />

      {/* Bottom sheet */}
      <div className="fortify-sheet">
        <div className="fortify-sheet-header">
          <b>{"+\u0e3f"} Fortify</b>
          <button onClick={reset} className="link-btn t">
            {"×"}
          </button>
        </div>

        {state.step === "picking" && (
          <div className="fortify-sheet-body">
            {/* Tier presets */}
            {TIERS.map((tier) => (
              <button
                key={tier.label}
                onClick={() => startFortify(tier.sats)}
                className="fortify-tier"
              >
                <span className="fortify-tier-label">{tier.label}</span>
                <span className="fortify-tier-sats">{"\u0e3f"}{fmtCompact(tier.sats)}</span>
                <span className="fortify-tier-desc t">{tier.desc}</span>
              </button>
            ))}

            {/* Custom amount */}
            <div className="fortify-custom">
              <input
                type="number"
                min="1"
                placeholder="custom sats"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="inline-input"
                style={{ width: "100px" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = parseInt(custom, 10);
                    if (v > 0) startFortify(v);
                  }
                }}
              />
              <button
                onClick={() => {
                  const v = parseInt(custom, 10);
                  if (v > 0) startFortify(v);
                }}
                className="link-btn"
              >
                {"\u0e3f"} send
              </button>
            </div>

            <div className="fortify-hint t">
              no wallet?{" "}
              <a href="/wallet-guide" target="_blank">get one →</a>
            </div>
          </div>
        )}

        {state.step === "requesting" && (
          <div className="fortify-sheet-body fortify-center">
            <div className="fortify-spinner" />
            <span className="t">requesting invoice for {"\u0e3f"}{fmtCompact(state.sats)}...</span>
          </div>
        )}

        {state.step === "confirming" && (
          <div className="fortify-sheet-body fortify-center">
            <div className="fortify-spinner" />
            <span className="t">confirming...</span>
          </div>
        )}

        {state.step === "paying" && (
          <div className="fortify-sheet-body fortify-center">
            <LightningQR invoice={state.invoice} size={200} />
            <a
              href={`lightning:${state.invoice}`}
              className="link-btn"
              style={{ wordBreak: "break-all", fontSize: "11px" }}
            >
              {state.invoice.slice(0, 30)}...
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(state.invoice).catch(() => {})}
              className="link-btn t"
              style={{ fontSize: "11px" }}
            >
              copy invoice
            </button>
            <div className="fortify-poll-status">
              <div className="fortify-spinner" />
              <span className="t">
                waiting for payment {"\u0e3f"}{fmtCompact(state.sats)}...
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function fmtCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
}
