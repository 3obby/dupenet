/**
 * RefusalV1 — operator content policy declaration.
 * DocRef: MVP_PLAN:§Operator Content Policy
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const RefusalReason = Type.Union([
  Type.Literal("ILLEGAL"),
  Type.Literal("MALWARE"),
  Type.Literal("DOXXING"),
  Type.Literal("PERSONAL"),
  Type.Literal("COST"),
  Type.Literal("OTHER"),
]);

export type RefusalReason = Static<typeof RefusalReason>;

export const RefusalScope = Type.Union([
  Type.Literal("EXACT"),
  Type.Literal("BUNDLE_DESCENDANTS"),
]);

export type RefusalScope = Static<typeof RefusalScope>;

export const RefusalV1 = Type.Object(
  {
    version: Type.Literal(1),
    operator: Hex32,
    target: Hex32,
    reason: RefusalReason,
    scope: RefusalScope,
    timestamp: Type.Integer({ minimum: 0 }),
    sig: Type.String(),
  },
  { additionalProperties: false },
);

export type RefusalV1 = Static<typeof RefusalV1>;
