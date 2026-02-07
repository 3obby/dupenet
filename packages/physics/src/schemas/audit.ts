/**
 * AuditChallengeV1 — host verification challenge.
 * DocRef: MVP_PLAN:§Optional Audits
 */

import { Type, type Static } from "@sinclair/typebox";

const Hex32 = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const AuditChallengeV1 = Type.Object(
  {
    version: Type.Literal(1),
    challenger: Hex32,
    host: Hex32,
    file_root: Hex32,
    block_cid: Hex32,
    claimed_response_hash: Hex32,
    actual_response_hash: Hex32,
    timestamp: Type.Integer({ minimum: 0 }),
    sig: Type.String(),
  },
  { additionalProperties: false },
);

export type AuditChallengeV1 = Static<typeof AuditChallengeV1>;
