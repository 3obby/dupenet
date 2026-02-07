/**
 * FileManifestV1 — chunked file descriptor.
 * DocRef: MVP_PLAN:§Entity Schemas
 *
 * file_root = SHA256(canonical(FileManifestV1))
 */

import { Type, type Static } from "@sinclair/typebox";
import { CHUNK_SIZE_DEFAULT, MAX_MANIFEST_BLOCKS } from "../constants.js";

export const FileManifestV1 = Type.Object(
  {
    version: Type.Literal(1),
    chunk_size: Type.Integer({ default: CHUNK_SIZE_DEFAULT }),
    size: Type.Integer({ minimum: 0 }),
    blocks: Type.Array(Type.String({ pattern: "^[0-9a-f]{64}$" }), {
      minItems: 1,
      maxItems: MAX_MANIFEST_BLOCKS,
    }),
    merkle_root: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    mime: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type FileManifestV1 = Static<typeof FileManifestV1>;

export const FileRefV1 = Type.Object(
  {
    file_root: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    size: Type.Integer({ minimum: 0 }),
    mime: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type FileRefV1 = Static<typeof FileRefV1>;
