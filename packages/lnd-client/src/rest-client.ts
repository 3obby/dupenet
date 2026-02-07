/**
 * LND REST client — uses HTTPS + macaroon auth.
 * DocRef: MVP_PLAN:§Phase 1 Step 2
 *
 * Wraps LND's REST API (typically port 8080).
 * TLS cert + macaroon pushed into headers.
 */

import { Agent, request } from "node:https";
import { readFileSync } from "node:fs";
import type {
  LndClient,
  CreateInvoiceParams,
  Invoice,
  InvoiceInfo,
  InvoiceState,
  LndRestClientOptions,
} from "./types.js";

export class LndRestClient implements LndClient {
  private readonly baseUrl: string;
  private readonly macaroonHex: string;
  private readonly agent: Agent;

  constructor(opts: LndRestClientOptions) {
    this.baseUrl = `https://${opts.host}`;
    this.macaroonHex = opts.macaroonPath
      ? readFileSync(opts.macaroonPath).toString("hex")
      : "";
    this.agent = opts.tlsCertPath
      ? new Agent({ ca: readFileSync(opts.tlsCertPath) })
      : new Agent({ rejectUnauthorized: false });
  }

  /** Generic HTTPS JSON request helper. */
  private httpRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const req = request(
        url,
        {
          method,
          agent: this.agent,
          headers: {
            ...(this.macaroonHex
              ? { "Grpc-Metadata-macaroon": this.macaroonHex }
              : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `LND REST ${method} ${path}: ${String(res.statusCode)} ${data}`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`LND REST: invalid JSON response`));
            }
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
    const res = (await this.httpRequest("POST", "/v1/invoices", {
      value: String(params.valueSats),
      memo: params.memo ?? "",
      expiry: String(params.expirySecs ?? 600),
    })) as { r_hash: string; payment_request: string };

    return {
      paymentHash: Buffer.from(res.r_hash, "base64").toString("hex"),
      bolt11: res.payment_request,
    };
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceInfo> {
    // LND REST: /v1/invoice/{r_hash_str} expects hex-encoded payment hash
    const res = (await this.httpRequest(
      "GET",
      `/v1/invoice/${paymentHash}`,
    )) as {
      state?: string;
      value?: string;
      amt_paid_sat?: string;
    };

    return {
      settled: res.state === "SETTLED",
      valueSats: parseInt(res.value ?? "0", 10),
      amtPaidSats: parseInt(res.amt_paid_sat ?? "0", 10),
      state: (res.state as InvoiceState) ?? "OPEN",
    };
  }
}
