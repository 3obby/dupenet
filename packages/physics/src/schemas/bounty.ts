/**
 * BountyPool and Tip — content funding.
 * DocRef: MVP_PLAN:§Entity Schemas, §Bounty Pool Mechanics, §Fee Model
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const BountyPool = Type.Object(
  {
    cid: Hex32,
    balance: Type.Integer({ minimum: 0 }),
    last_payout_epoch: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type BountyPool = Static<typeof BountyPool>;

export const TipV1 = Type.Object(
  {
    version: Type.Literal(1),
    from: Hex32,
    target: Hex32, // asset_root_cid or raw CID
    amount: Type.Integer({ minimum: 1 }),
    timestamp: Type.Integer({ minimum: 0 }),
    payment_proof: Hex32,
  },
  { additionalProperties: false },
);

export type TipV1 = Static<typeof TipV1>;
