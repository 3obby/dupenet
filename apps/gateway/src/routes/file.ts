/**
 * File manifest routes — GET/PUT /file/{root}
 * DocRef: MVP_PLAN:§Interface: Client → Operator (Direct)
 */

import type { FastifyInstance } from "fastify";
import {
  cidFromObject,
  type CID,
  type FileManifestV1,
} from "@dupenet/physics";
import type { BlockStore } from "../storage/block-store.js";
import type { MetadataStore } from "../storage/metadata-store.js";

export function fileRoutes(
  app: FastifyInstance,
  store: BlockStore,
  meta: MetadataStore,
): void {
  /**
   * PUT /file/:root — store a file manifest.
   * Verifies: file_root = SHA256(canonical(manifest))
   * Verifies: all blocks referenced exist in the store.
   */
  app.put<{ Params: { root: string } }>(
    "/file/:root",
    async (request, reply) => {
      const { root } = request.params;

      if (!/^[0-9a-f]{64}$/.test(root)) {
        return reply.status(400).send({ error: "invalid_root" });
      }

      let manifest: FileManifestV1;
      try {
        manifest = request.body as FileManifestV1;
      } catch {
        return reply.status(400).send({ error: "invalid_json" });
      }

      // Verify file_root matches
      const computedRoot = cidFromObject(manifest);
      if (computedRoot !== root) {
        return reply.status(422).send({
          error: "root_mismatch",
          expected: root,
          computed: computedRoot,
        });
      }

      // Verify all blocks exist
      for (const blockCid of manifest.blocks) {
        const exists = await store.has(blockCid as CID);
        if (!exists) {
          return reply.status(422).send({
            error: "missing_block",
            block_cid: blockCid,
          });
        }
      }

      await meta.putManifest(root as CID, manifest);
      return reply.status(201).send({ ok: true, file_root: root });
    },
  );

  /**
   * GET /file/:root — retrieve a file manifest.
   */
  app.get<{ Params: { root: string } }>(
    "/file/:root",
    async (request, reply) => {
      const { root } = request.params;

      if (!/^[0-9a-f]{64}$/.test(root)) {
        return reply.status(400).send({ error: "invalid_root" });
      }

      const manifest = meta.getManifest(root as CID);
      if (!manifest) {
        return reply.status(404).send({ error: "not_found" });
      }

      return reply.send(manifest);
    },
  );
}
