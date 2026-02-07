/**
 * LND client interface — abstraction over REST/gRPC for testability.
 * DocRef: MVP_PLAN:§Phase 1 Step 2
 *
 * Gateway uses createInvoice(). Mint uses lookupInvoice().
 * Wire behind this interface from day 1 so the impl can swap.
 */

export interface CreateInvoiceParams {
  valueSats: number;
  memo?: string;
  expirySecs?: number;
}

export interface Invoice {
  /** Hex-encoded SHA256 payment hash (32 bytes). */
  paymentHash: string;
  /** BOLT11 encoded invoice string. */
  bolt11: string;
}

export type InvoiceState = "OPEN" | "SETTLED" | "CANCELED" | "ACCEPTED";

export interface InvoiceInfo {
  settled: boolean;
  valueSats: number;
  amtPaidSats: number;
  state: InvoiceState;
}

export interface LndClient {
  createInvoice(params: CreateInvoiceParams): Promise<Invoice>;
  lookupInvoice(paymentHash: string): Promise<InvoiceInfo>;
}

export interface LndRestClientOptions {
  /** LND REST host:port (e.g. "localhost:8080"). */
  host: string;
  /** Path to macaroon file. Empty = no auth (regtest only). */
  macaroonPath: string;
  /** Path to tls.cert file. Empty = skip TLS verification (regtest only). */
  tlsCertPath: string;
}
