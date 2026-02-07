/**
 * Asset routes — GET/PUT/HEAD /asset/{root}
 * DocRef: MVP_PLAN:§Interface: Client → Operator (Direct)
 */

import type { FastifyInstance } from "fastify";
import { cidFromObject, type CID, type AssetRootV1 } from "@dupenet/physics";
import { getManifest } from "./file.js";

/** In-memory asset store. TODO: move to coordinator/DB in Sprint 3. */
const assets = new Map<CID, AssetRootV1>();

export function assetRoutes(app: FastifyInstance): void {
  /**
   * PUT /asset/:root — register an asset root.
   * Verifies: asset_root_cid = SHA256(canonical(AssetRootV1))
   * Verifies: original file manifest exists.
   */
  app.put<{ Params: { root: string } }>(
    "/asset/:root",
    async (request, reply) => {
      const { root } = request.params;

      if (!/^[0-9a-f]{64}$/.test(root)) {
        return reply.status(400).send({ error: "invalid_root" });
      }

      const asset = request.body as AssetRootV1;

      const computedRoot = cidFromObject(asset);
      if (computedRoot !== root) {
        return reply.status(422).send({
          error: "root_mismatch",
          expected: root,
          computed: computedRoot,
        });
      }

      // Verify original file manifest exists
      const manifest = getManifest(asset.original.file_root as CID);
      if (!manifest) {
        return reply.status(422).send({
          error: "missing_file_manifest",
          file_root: asset.original.file_root,
        });
      }

      assets.set(root as CID, asset);
      return reply.status(201).send({ ok: true, asset_root: root });
    },
  );

  /**
   * GET /asset/:root — retrieve an asset root descriptor.
   */
  app.get<{ Params: { root: string } }>(
    "/asset/:root",
    async (request, reply) => {
      const { root } = request.params;

      if (!/^[0-9a-f]{64}$/.test(root)) {
        return reply.status(400).send({ error: "invalid_root" });
      }

      const asset = assets.get(root as CID);
      if (!asset) {
        return reply.status(404).send({ error: "not_found" });
      }

      return reply.send(asset);
    },
  );

  /**
   * HEAD /asset/:root — returns size, MIME, pricing hints.
   */
  app.head<{ Params: { root: string } }>(
    "/asset/:root",
    async (request, reply) => {
      const { root } = request.params;

      if (!/^[0-9a-f]{64}$/.test(root)) {
        return reply.status(400).send();
      }

      const asset = assets.get(root as CID);
      if (!asset) {
        return reply.status(404).send();
      }

      return reply
        .header("x-asset-size", asset.original.size.toString())
        .header("x-asset-kind", asset.kind)
        .header(
          "content-type",
          asset.original.mime ?? "application/octet-stream",
        )
        .send();
    },
  );
}
