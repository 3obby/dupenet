"use client";

/**
 * QR code renderer for Lightning BOLT11 invoices.
 * Generates a data-URL PNG and renders as <img>.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function LightningQR({
  invoice,
  size = 200,
}: {
  /** BOLT11 invoice string. */
  invoice: string;
  /** QR code pixel size (default 200). */
  size?: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(invoice.toUpperCase(), {
      width: size,
      margin: 1,
      color: { dark: "#000", light: "#fff" },
      errorCorrectionLevel: "L",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [invoice, size]);

  if (!dataUrl) return null;

  return (
    <a href={`lightning:${invoice}`} title="open in wallet">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="Lightning QR"
        width={size}
        height={size}
        style={{ imageRendering: "pixelated", display: "block", margin: "4px 0" }}
      />
    </a>
  );
}
