/**
 * In-memory invoice store with TTL.
 * Maps payment_hash → pending invoice metadata.
 *
 * Gateway restart invalidates outstanding invoices (acceptable for MVP).
 * DocRef: MVP_PLAN:§Phase 1 Step 2
 */

export interface PendingInvoice {
  blockCid: string;
  priceSats: number;
  hostPubkey: string;
  epoch: number;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class InvoiceStore {
  private readonly store = new Map<string, PendingInvoice>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  set(
    paymentHash: string,
    invoice: Omit<PendingInvoice, "createdAt" | "expiresAt">,
  ): PendingInvoice {
    const now = Date.now();
    const record: PendingInvoice = {
      ...invoice,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.store.set(paymentHash, record);
    return record;
  }

  get(paymentHash: string): PendingInvoice | undefined {
    const record = this.store.get(paymentHash);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      this.store.delete(paymentHash);
      return undefined;
    }
    return record;
  }

  delete(paymentHash: string): void {
    this.store.delete(paymentHash);
  }

  /** Evict expired entries. Call periodically if needed. */
  cleanup(): void {
    const now = Date.now();
    for (const [hash, record] of this.store) {
      if (now > record.expiresAt) {
        this.store.delete(hash);
      }
    }
  }
}
