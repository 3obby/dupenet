"use client";

/**
 * Buy button — purchase paid content via L402 / Lightning.
 *
 * Shows price from cheapest TRUSTED host. Three tiers:
 *   1. Free content (all blocks served): just shows download link
 *   2. WebLN: auto-pay per-block invoices (future)
 *   3. Fallback: show price + CLI instructions
 *
 * For MVP: download link for free content, price display + CLI for paid content.
 */

import { useState } from "react";

interface BuyButtonProps {
  /** The asset ref (SHA256 hex). */
  assetRef: string;
  /** MIME type of the content. */
  mime?: string;
  /** Total file size in bytes. */
  size?: number;
  /** Total block count. */
  totalBlocks: number;
  /** Price per block fetch (sats) from cheapest host. 0 = no hosts / free. */
  pricePerBlock: number;
  /** Number of TRUSTED hosts serving this content. */
  hostCount: number;
  /** True if content is fully available (all blocks free). */
  isFree: boolean;
}

export function BuyButton({
  assetRef,
  mime,
  size,
  totalBlocks,
  pricePerBlock,
  hostCount,
  isFree,
}: BuyButtonProps) {
  const [showDetails, setShowDetails] = useState(false);

  const totalPrice = pricePerBlock * totalBlocks;
  const shortRef = assetRef.slice(0, 12);

  // Free content: simple download link
  if (isFree) {
    return (
      <a
        href={`/api/download/${assetRef}`}
        title={`download ${mime ?? "file"}${size ? ` (${fmtSize(size)})` : ""}`}
        className="link-btn"
      >
        {"\u2913"}
      </a>
    );
  }

  // Paid content: show price + buy/download options
  return (
    <span className="buy-row">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="link-btn"
        title="buy content"
      >
        {"\u2913"}{"\u0e3f"}{fmtSatsCompact(totalPrice)}
      </button>
      {showDetails && (
        <span className="buy-details">
          {" \u00b7 "}
          <span className="t">
            {fmtSatsCompact(pricePerBlock)}/block \u00d7 {totalBlocks}
            {hostCount > 0 && <> \u00b7 {hostCount} host{hostCount !== 1 ? "s" : ""}</>}
          </span>
          <br />
          <span className="t" style={{ fontSize: "11px" }}>
            <code>dupenet fetch {shortRef}...</code>
          </span>
          {" "}
          <button
            onClick={() => {
              navigator.clipboard.writeText(`dupenet fetch ${assetRef}`).catch(() => {});
            }}
            className="link-btn t"
            style={{ fontSize: "11px" }}
          >
            copy
          </button>
        </span>
      )}
    </span>
  );
}

function fmtSatsCompact(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
