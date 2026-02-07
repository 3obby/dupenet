/**
 * AssetRootV1 — multimedia asset descriptor.
 * DocRef: MVP_PLAN:§Entity Schemas
 *
 * asset_root_cid = SHA256(canonical(AssetRootV1))
 * Tips/bounties attach to asset_root_cid.
 */

import { Type, type Static } from "@sinclair/typebox";
import { MAX_ASSET_VARIANTS } from "../constants.js";
import { FileRefV1 } from "./file-manifest.js";

export const AssetKind = Type.Union([
  Type.Literal("TEXT"),
  Type.Literal("IMAGE"),
  Type.Literal("AUDIO"),
  Type.Literal("VIDEO"),
  Type.Literal("FILE"),
]);

export type AssetKind = Static<typeof AssetKind>;

export const VariantRefV1 = Type.Object(
  {
    label: Type.String(), // e.g. "720p", "thumb_200", "webp"
    file: FileRefV1,
  },
  { additionalProperties: false },
);

export type VariantRefV1 = Static<typeof VariantRefV1>;

export const MetaV1 = Type.Object(
  {
    width: Type.Optional(Type.Integer({ minimum: 0 })),
    height: Type.Optional(Type.Integer({ minimum: 0 })),
    duration_ms: Type.Optional(Type.Integer({ minimum: 0 })),
    codec: Type.Optional(Type.String()),
    sha256_original: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);

export type MetaV1 = Static<typeof MetaV1>;

export const AssetRootV1 = Type.Object(
  {
    version: Type.Literal(1),
    kind: AssetKind,
    original: FileRefV1,
    variants: Type.Array(VariantRefV1, { maxItems: MAX_ASSET_VARIANTS }),
    poster: Type.Optional(FileRefV1),
    thumbs: Type.Optional(Type.Array(FileRefV1)),
    meta: MetaV1,
  },
  { additionalProperties: false },
);

export type AssetRootV1 = Static<typeof AssetRootV1>;
