/**
 * Mint client — calls receipt mint's POST /sign for receipt tokens.
 * DocRef: MVP_PLAN:§Receipt Mint (L402 Gate)
 */

export interface SignReceiptParams {
  host_pubkey: string;
  epoch: number;
  block_cid: string;
  response_hash: string;
  price_sats: number;
  payment_hash: string;
}

export interface MintClient {
  signReceipt(params: SignReceiptParams): Promise<string>;
}

/**
 * Production mint client — calls mint HTTP API.
 */
export class HttpMintClient implements MintClient {
  constructor(private readonly mintUrl: string) {}

  async signReceipt(params: SignReceiptParams): Promise<string> {
    const res = await fetch(`${this.mintUrl}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mint sign failed: ${String(res.status)} ${text}`);
    }

    const data = (await res.json()) as { token: string; mint_pubkey: string };
    return data.token;
  }
}
