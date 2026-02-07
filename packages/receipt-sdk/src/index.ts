/**
 * @dupenet/receipt-sdk — Zero-dependency receipt verification.
 *
 * Single function: verifyReceiptV2(receipt, mintPubkeys) → {valid, error?}
 *
 * Works in: browser, Node 20+, Deno, Bun.
 * No LN state. No network calls. No protocol context.
 */

export { verifyReceiptV2, type ReceiptV2Input, type VerifyResult } from "./verify.js";
export { ed25519Verify } from "./ed25519.js";
