/**
 * In-memory payment request store with TTL.
 * Maps event_hash → pending payment request.
 * DocRef: MVP_PLAN:§Client Interaction Model (payment-intent binding)
 *
 * Flow:
 *   1. Client computes event_hash = SHA256(canonical(EventV1 minus sig))
 *   2. POST /payreq { sats, event_hash } → coordinator creates LN invoice
 *   3. Client pays invoice (WebLN or manually)
 *   4. Client signs event → POST /event
 *   5. Coordinator verifies payment via lookupInvoice() before crediting pool
 *
 * In-memory: coordinator restart invalidates outstanding requests (acceptable for MVP).
 */

export interface PendingPayment {
  eventHash: string;
  paymentHash: string;
  bolt11: string;
  sats: number;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class PaymentStore {
  private readonly byEventHash = new Map<string, PendingPayment>();
  private readonly byPaymentHash = new Map<string, PendingPayment>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  set(
    eventHash: string,
    paymentHash: string,
    bolt11: string,
    sats: number,
  ): PendingPayment {
    const now = Date.now();
    const record: PendingPayment = {
      eventHash,
      paymentHash,
      bolt11,
      sats,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.byEventHash.set(eventHash, record);
    this.byPaymentHash.set(paymentHash, record);
    return record;
  }

  getByEventHash(eventHash: string): PendingPayment | undefined {
    const record = this.byEventHash.get(eventHash);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      this.delete(record.paymentHash);
      return undefined;
    }
    return record;
  }

  getByPaymentHash(paymentHash: string): PendingPayment | undefined {
    const record = this.byPaymentHash.get(paymentHash);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      this.delete(record.paymentHash);
      return undefined;
    }
    return record;
  }

  delete(paymentHash: string): void {
    const record = this.byPaymentHash.get(paymentHash);
    if (record) {
      this.byEventHash.delete(record.eventHash);
      this.byPaymentHash.delete(paymentHash);
    }
  }

  /** Evict expired entries. Call periodically. */
  cleanup(): void {
    const now = Date.now();
    for (const [hash, record] of this.byPaymentHash) {
      if (now > record.expiresAt) {
        this.byEventHash.delete(record.eventHash);
        this.byPaymentHash.delete(hash);
      }
    }
  }
}
