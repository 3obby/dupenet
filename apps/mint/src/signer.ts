/**
 * Receipt token signer — Ed25519.
 * DocRef: MVP_PLAN:§Receipt Mint (L402 Gate)
 *
 * Token = Sign_mint_sk(canonical("R2" || host_pubkey || epoch ||
 *         block_cid || response_hash || price_sats || payment_hash))
 *
 * This module is the core of the mint. It signs, nothing else.
 * No DB. No business logic beyond "sign this payload."
 */

import { sign, getPublicKey } from "@noble/ed25519";
import { fromHex, toHex, type CID } from "@dupenet/physics";

export class ReceiptSigner {
  private readonly privateKey: Uint8Array;
  readonly publicKeyHex: string;

  constructor(privateKeyHex: string) {
    this.privateKey = fromHex(privateKeyHex);
    const pubkey = getPublicKey(this.privateKey);
    // getPublicKey may return a promise in some versions
    if (pubkey instanceof Promise) {
      throw new Error("Use ReceiptSigner.create() for async initialization");
    }
    this.publicKeyHex = toHex(pubkey);
  }

  static async create(privateKeyHex: string): Promise<ReceiptSigner> {
    const signer = new ReceiptSigner(privateKeyHex);
    // Ensure public key is resolved
    const pk = await getPublicKey(fromHex(privateKeyHex));
    (signer as { publicKeyHex: string }).publicKeyHex = toHex(pk);
    return signer;
  }

  /**
   * Build the token payload and sign it.
   *
   * token = Sign("R2" || host_pubkey || epoch || block_cid ||
   *              response_hash || price_sats || payment_hash)
   */
  async signToken(input: {
    host_pubkey: CID;
    epoch: number;
    block_cid: CID;
    response_hash: CID;
    price_sats: number;
    payment_hash: CID;
  }): Promise<{ token: Uint8Array; mint_pubkey: string }> {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [
      encoder.encode("R2"),
      fromHex(input.host_pubkey),
    ];

    // Epoch as 4-byte big-endian
    const epochBuf = new Uint8Array(4);
    new DataView(epochBuf.buffer).setUint32(0, input.epoch, false);
    parts.push(epochBuf);

    parts.push(fromHex(input.block_cid));
    parts.push(fromHex(input.response_hash));

    // Price as 4-byte big-endian
    const priceBuf = new Uint8Array(4);
    new DataView(priceBuf.buffer).setUint32(0, input.price_sats, false);
    parts.push(priceBuf);

    parts.push(fromHex(input.payment_hash));

    // Concatenate
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const payload = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      payload.set(part, offset);
      offset += part.length;
    }

    const signature = await sign(payload, this.privateKey);
    return { token: signature, mint_pubkey: this.publicKeyHex };
  }
}
