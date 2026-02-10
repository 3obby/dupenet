/**
 * WebLN type declarations and helpers.
 * WebLN is a browser API for Lightning wallets (Alby, etc.).
 * https://www.webln.dev/
 */

export interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
  makeInvoice(args: { amount: number; defaultMemo?: string }): Promise<{ paymentRequest: string }>;
  getInfo(): Promise<{ node: { alias: string; pubkey: string } }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

/** Check if WebLN is available in the browser. */
export function hasWebLN(): boolean {
  return typeof window !== "undefined" && !!window.webln;
}

/** Try to enable and pay via WebLN. Returns preimage on success, null on failure. */
export async function payWithWebLN(bolt11: string): Promise<string | null> {
  if (!hasWebLN()) return null;
  try {
    await window.webln!.enable();
    const result = await window.webln!.sendPayment(bolt11);
    return result.preimage;
  } catch {
    return null;
  }
}
