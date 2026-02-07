/**
 * L402 integration test — paid block fetch with mock LND.
 * DocRef: MVP_PLAN:§Phase 1 Step 2
 *
 * Flow: GET /block → 402 + invoice → "pay" → retry with preimage → bytes + receipt_token
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { cidFromBytes, type CID } from "@dupenet/physics";
import { MockLndClient } from "@dupenet/lnd-client";
import type { MintClient, SignReceiptParams } from "../../src/l402/mint-client.js";

/** Mock mint client — records sign requests, returns deterministic token. */
class TestMintClient implements MintClient {
  readonly signed: SignReceiptParams[] = [];
  async signReceipt(params: SignReceiptParams): Promise<string> {
    this.signed.push(params);
    return Buffer.from(`mock-token:${params.payment_hash}`).toString("base64");
  }
}

let app: FastifyInstance;
let tmpDir: string;
let mockLnd: MockLndClient;
let mockMint: TestMintClient;

describe("L402 gated block fetch", () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gateway-l402-test-"));
    process.env.BLOCK_STORE_PATH = tmpDir;
    process.env.HOST_PUBKEY = "aa".repeat(32);

    mockLnd = new MockLndClient();
    mockMint = new TestMintClient();

    const { buildApp } = await import("../../src/server.js");
    app = await buildApp({ lndClient: mockLnd, mintClient: mockMint });
  });

  afterAll(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Helper: upload a block and return its CID. */
  async function uploadBlock(content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content);
    const cid = cidFromBytes(bytes);
    const res = await app.inject({
      method: "PUT",
      url: `/block/${cid}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });
    expect(res.statusCode).toBe(201);
    return cid;
  }

  // ── 402 challenge ────────────────────────────────────────────

  it("returns 402 with invoice when no auth header", async () => {
    const cid = await uploadBlock("l402 challenge test");

    const res = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
    });

    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.invoice).toMatch(/^lnbcrt/);
    expect(body.payment_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.price_sats).toBeGreaterThanOrEqual(1);
    expect(body.expires_at).toBeGreaterThan(0);
    expect(res.headers["www-authenticate"]).toBe("L402");
  });

  it("returns 404 before 402 for missing block", async () => {
    const missingCid = "dd".repeat(32);
    const res = await app.inject({
      method: "GET",
      url: `/block/${missingCid}`,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── paid fetch ───────────────────────────────────────────────

  it("returns block + receipt token with valid preimage", async () => {
    const content = "l402 paid fetch test";
    const bytes = new TextEncoder().encode(content);
    const cid = await uploadBlock(content);

    // Step 1: GET → 402
    const challenge = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
    });
    expect(challenge.statusCode).toBe(402);
    const { payment_hash } = challenge.json();

    // Step 2: simulate payment
    const preimage = mockLnd.settleInvoice(payment_hash);

    // Step 3: retry with preimage → 200
    const paid = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
      headers: { authorization: `L402 ${preimage}` },
    });

    expect(paid.statusCode).toBe(200);
    expect(paid.headers["content-type"]).toBe("application/octet-stream");
    expect(paid.headers["x-receipt-token"]).toBeDefined();
    expect(paid.headers["x-payment-hash"]).toBe(payment_hash);
    expect(paid.headers["x-price-sats"]).toBeDefined();
    expect(new Uint8Array(paid.rawPayload)).toEqual(bytes);

    // Verify mint was called with correct params
    const lastSign = mockMint.signed[mockMint.signed.length - 1]!;
    expect(lastSign.block_cid).toBe(cid);
    expect(lastSign.payment_hash).toBe(payment_hash);
    expect(lastSign.response_hash).toBe(cid); // response_hash == block_cid for honest host
    expect(lastSign.price_sats).toBeGreaterThanOrEqual(1);
  });

  // ── error cases ──────────────────────────────────────────────

  it("rejects invalid preimage format", async () => {
    const cid = await uploadBlock("bad preimage format");

    const res = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
      headers: { authorization: "L402 not-valid-hex-string" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_preimage");
  });

  it("rejects preimage for unknown payment", async () => {
    const cid = await uploadBlock("unknown payment test");

    const fakePreimage = "ff".repeat(32);
    const res = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
      headers: { authorization: `L402 ${fakePreimage}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unknown_payment");
  });

  it("rejects preimage for wrong block CID", async () => {
    const cid1 = await uploadBlock("block one for mismatch");
    const cid2 = await uploadBlock("block two for mismatch");

    // Get invoice for cid1
    const challenge = await app.inject({
      method: "GET",
      url: `/block/${cid1}`,
    });
    const { payment_hash } = challenge.json();
    const preimage = mockLnd.settleInvoice(payment_hash);

    // Try to use cid1's preimage for cid2
    const res = await app.inject({
      method: "GET",
      url: `/block/${cid2}`,
      headers: { authorization: `L402 ${preimage}` },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("cid_mismatch");
  });

  it("invoice is single-use (consumed after paid fetch)", async () => {
    const cid = await uploadBlock("single use invoice");

    // Get invoice, pay, fetch
    const challenge = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
    });
    const { payment_hash } = challenge.json();
    const preimage = mockLnd.settleInvoice(payment_hash);

    const res1 = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
      headers: { authorization: `L402 ${preimage}` },
    });
    expect(res1.statusCode).toBe(200);

    // Retry same preimage → rejected (invoice consumed)
    const res2 = await app.inject({
      method: "GET",
      url: `/block/${cid}`,
      headers: { authorization: `L402 ${preimage}` },
    });
    expect(res2.statusCode).toBe(401);
    expect(res2.json().error).toBe("unknown_payment");
  });

  // ── PUT still works without auth ─────────────────────────────

  it("PUT /block does not require L402", async () => {
    const bytes = new TextEncoder().encode("no auth needed for PUT");
    const cid = cidFromBytes(bytes);

    const res = await app.inject({
      method: "PUT",
      url: `/block/${cid}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(bytes),
    });

    expect(res.statusCode).toBe(201);
  });
});
