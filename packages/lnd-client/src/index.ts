/**
 * @dupenet/lnd-client — LND Lightning client abstraction.
 *
 * Gateway imports createInvoice(). Mint imports lookupInvoice().
 * Both go through the same LndClient interface.
 * Swap LndRestClient for MockLndClient in tests.
 */

export type {
  LndClient,
  CreateInvoiceParams,
  Invoice,
  InvoiceInfo,
  InvoiceState,
  LndRestClientOptions,
} from "./types.js";

export { LndRestClient } from "./rest-client.js";
export { MockLndClient } from "./mock-client.js";
