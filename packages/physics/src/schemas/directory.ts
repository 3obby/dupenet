/**
 * DirectoryV1 — host routing feed.
 * DocRef: MVP_PLAN:§Directory Format
 */

import { Type, type Static } from "@sinclair/typebox";
import { PricingV1 } from "./host.js";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const DirectoryHostEntry = Type.Object(
  {
    pubkey: Hex32,
    endpoint: Type.String(),
    pricing: PricingV1,
    last_seen: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type DirectoryHostEntry = Static<typeof DirectoryHostEntry>;

export const DirectoryV1 = Type.Object(
  {
    version: Type.Literal(1),
    publisher: Hex32,
    hosts: Type.Array(DirectoryHostEntry),
    timestamp: Type.Integer({ minimum: 0 }),
    sig: Type.String(),
  },
  { additionalProperties: false },
);

export type DirectoryV1 = Static<typeof DirectoryV1>;
