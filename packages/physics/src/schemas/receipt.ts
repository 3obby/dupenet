/**
 * ReceiptV2 — client proof of paid consumption.
 * DocRef: MVP_PLAN:§Entity Schemas, §Receipt Rules, §Verification
 *
 * challenge = H("RECEIPT_V2" || asset_root? || file_root || block_cid ||
 *               host || payment_hash || response_hash || epoch || client_pubkey)
 * valid if: pow_hash = H(challenge || nonce) < TARGET
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const ReceiptV2 = Type.Object(
  {
    version: Type.Literal(2),
    asset_root: Type.Optional(Hex32),
    file_root: Hex32,
    block_cid: Hex32,
    host_pubkey: Hex32,
    payment_hash: Hex32,
    response_hash: Hex32,
    price_sats: Type.Integer({ minimum: 0 }),
    receipt_token: Type.String(), // base64-encoded mint signature
    epoch: Type.Integer({ minimum: 0 }),
    nonce: Type.Integer({ minimum: 0 }),
    pow_hash: Hex32,
    client_pubkey: Hex32,
    client_sig: Type.String(), // base64-encoded client signature
  },
  { additionalProperties: false },
);

export type ReceiptV2 = Static<typeof ReceiptV2>;

/**
 * Receipt challenge construction.
 * The challenge binds all receipt fields for PoW computation.
 */
export const RECEIPT_CHALLENGE_PREFIX = "RECEIPT_V2";
