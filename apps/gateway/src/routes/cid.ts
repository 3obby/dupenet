/**
 * Unified CID route — GET /cid/{hash}
 * DocRef: MVP_PLAN:§Event Layer ("nano-blobs fetched via GET /cid/{event_id}")
 *
 * Resolution logic:
 *   1. If hash matches an asset_root → 302 redirect to /asset/{hash}
 *   2. If hash matches a single block → serve bytes (L402-gated or free preview)
 *   3. If hash matches a file manifest → serve manifest JSON
 *   4. Otherwise → 404
 *
 * Nano-blobs (events ≤ CHUNK_SIZE_DEFAULT) are single blocks and are
 * served directly via this endpoint.
 */

import type { FastifyInstance } from "fastify";
import type { BlockStore } from "../storage/block-store.js";
import type { CID } from "@dupenet/physics";
import { getManifest } from "./file.js";
import { getAsset } from "./asset.js";

export function cidRoutes(
  app: FastifyInstance,
  store: BlockStore,
): void {
  app.get<{ Params: { hash: string } }>(
    "/cid/:hash",
    async (request, reply) => {
      const { hash } = request.params;

      if (!/^[0-9a-f]{64}$/.test(hash)) {
        return reply.status(400).send({ error: "invalid_hash" });
      }

      // 1. Check if it's an asset root → redirect
      const asset = getAsset(hash as CID);
      if (asset) {
        return reply.code(302).redirect(`/asset/${hash}`);
      }

      // 2. Check if it's a file manifest → serve JSON
      const manifest = getManifest(hash as CID);
      if (manifest) {
        return reply.code(302).redirect(`/file/${hash}`);
      }

      // 3. Check if it's a raw block → serve bytes
      const exists = await store.has(hash as CID);
      if (exists) {
        const bytes = await store.get(hash as CID);
        if (!bytes) {
          return reply.status(404).send({ error: "not_found" });
        }

        return reply
          .header("content-type", "application/octet-stream")
          .header("x-content-cid", hash)
          .send(Buffer.from(bytes));
      }

      // 4. Not found
      return reply.status(404).send({ error: "not_found" });
    },
  );
}
