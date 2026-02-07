/**
 * EpochSummary — per-host per-CID epoch aggregation.
 * DocRef: MVP_PLAN:§Entity Schemas, §Epoch-Based Rewards
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const EpochSummary = Type.Object(
  {
    epoch: Type.Integer({ minimum: 0 }),
    host: Hex32,
    cid: Hex32,
    receipt_count: Type.Integer({ minimum: 0 }),
    unique_clients: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type EpochSummary = Static<typeof EpochSummary>;
