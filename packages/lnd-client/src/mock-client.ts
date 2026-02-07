/**
 * Mock LND client for testing.
 *
 * Generates deterministic invoices. Use settleInvoice() to simulate payment.
 * Share a single instance between gateway and mint in tests so both see
 * the same invoice state.
 */

import { createHash, randomBytes } from "node:crypto";
import type {
  LndClient,
  CreateInvoiceParams,
  Invoice,
  InvoiceInfo,
} from "./types.js";

interface MockInvoice {
  preimage: string;
  settled: boolean;
  valueSats: number;
}

export class MockLndClient implements LndClient {
  private readonly invoices = new Map<string, MockInvoice>();

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const preimageBytes = randomBytes(32);
    const preimage = preimageBytes.toString("hex");
    const paymentHash = createHash("sha256")
      .update(preimageBytes)
      .digest("hex");
    const bolt11 = `lnbcrt${params.valueSats}n1mock${paymentHash.slice(0, 20)}`;

    this.invoices.set(paymentHash, {
      preimage,
      settled: false,
      valueSats: params.valueSats,
    });

    return { paymentHash, bolt11 };
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceInfo> {
    const inv = this.invoices.get(paymentHash);
    if (!inv) {
      return { settled: false, valueSats: 0, amtPaidSats: 0, state: "OPEN" };
    }
    return {
      settled: inv.settled,
      valueSats: inv.valueSats,
      amtPaidSats: inv.settled ? inv.valueSats : 0,
      state: inv.settled ? "SETTLED" : "OPEN",
    };
  }

  /** Test helper: simulate payment settlement. Returns preimage hex. */
  settleInvoice(paymentHash: string): string {
    const inv = this.invoices.get(paymentHash);
    if (!inv) {
      throw new Error(`MockLndClient: unknown payment_hash ${paymentHash}`);
    }
    inv.settled = true;
    return inv.preimage;
  }

  /** Test helper: check if an invoice exists. */
  hasInvoice(paymentHash: string): boolean {
    return this.invoices.has(paymentHash);
  }
}
