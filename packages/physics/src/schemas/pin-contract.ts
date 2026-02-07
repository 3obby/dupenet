/**
 * PinContractV1 — budgeted durability.
 * DocRef: MVP_PLAN:§Entity Schemas, §Pin Contract API
 */

import { Type, type Static } from "@sinclair/typebox";
import { PIN_MAX_COPIES } from "../constants.js";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const PinStatus = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("EXHAUSTED"),
  Type.Literal("CANCELLED"),
]);

export type PinStatus = Static<typeof PinStatus>;

export const PinContractV1 = Type.Object(
  {
    version: Type.Literal(1),
    id: Hex32,
    client: Hex32,
    asset_root: Hex32,
    min_copies: Type.Integer({ minimum: 1, maximum: PIN_MAX_COPIES }),
    duration_epochs: Type.Integer({ minimum: 1 }),
    budget_sats: Type.Integer({ minimum: 1 }),
    drain_rate: Type.Integer({ minimum: 1 }), // derived: budget_sats / duration_epochs
    status: PinStatus,
    created_epoch: Type.Integer({ minimum: 0 }),
    sig: Type.String(),
  },
  { additionalProperties: false },
);

export type PinContractV1 = Static<typeof PinContractV1>;
