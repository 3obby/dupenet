/**
 * Host and HostServe — operator registration.
 * DocRef: MVP_PLAN:§Entity Schemas, §Node Operator Model
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const HostStatus = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("TRUSTED"),
  Type.Literal("DEGRADED"),
  Type.Literal("INACTIVE"),
  Type.Literal("UNBONDING"),
  Type.Literal("SLASHED"),
]);

export type HostStatus = Static<typeof HostStatus>;

export const PricingV1 = Type.Object(
  {
    min_request_sats: Type.Integer({ minimum: 1 }),
    sats_per_gb: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type PricingV1 = Static<typeof PricingV1>;

export const HostV1 = Type.Object(
  {
    version: Type.Literal(1),
    pubkey: Hex32,
    endpoint: Type.Union([Type.String({ format: "uri" }), Type.Null()]),
    stake: Type.Integer({ minimum: 0 }),
    status: HostStatus,
    unbond_epoch: Type.Optional(Type.Integer({ minimum: 0 })),
    pricing: PricingV1,
  },
  { additionalProperties: false },
);

export type HostV1 = Static<typeof HostV1>;

export const HostServeV1 = Type.Object(
  {
    version: Type.Literal(1),
    host: Hex32,
    cid: Hex32,
    registered_epoch: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type HostServeV1 = Static<typeof HostServeV1>;
