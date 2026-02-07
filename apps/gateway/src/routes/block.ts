/**
 * Block routes — GET/PUT /block/{cid}
 * DocRef: MVP_PLAN:§Interface: Client → Operator (Direct)
 */

import type { FastifyInstance } from "fastify";
import { type CID } from "@dupenet/physics";
import type { BlockStore } from "../storage/block-store.js";

export function blockRoutes(app: FastifyInstance, store: BlockStore): void {
  /**
   * PUT /block/:cid — store a block (verified on receive).
   */
  app.put<{ Params: { cid: string } }>(
    "/block/:cid",
    async (request, reply) => {
      const { cid } = request.params;

      if (!/^[0-9a-f]{64}$/.test(cid)) {
        return reply.status(400).send({ error: "invalid_cid" });
      }

      const body = request.body;

      // Accept raw body as Uint8Array (registered via addContentTypeParser)
      let blockBytes: Uint8Array;
      if (body instanceof Buffer || body instanceof Uint8Array) {
        blockBytes = new Uint8Array(body);
      } else {
        return reply.status(400).send({ error: "body_required" });
      }

      try {
        await store.put(cid as CID, blockBytes);
        return reply.status(201).send({ ok: true, cid });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        return reply.status(422).send({ error: msg });
      }
    },
  );

  /**
   * GET /block/:cid — retrieve a block.
   * TODO: L402 gating will be added in Sprint 2.
   */
  app.get<{ Params: { cid: string } }>(
    "/block/:cid",
    async (request, reply) => {
      const { cid } = request.params;

      if (!/^[0-9a-f]{64}$/.test(cid)) {
        return reply.status(400).send({ error: "invalid_cid" });
      }

      const bytes = await store.get(cid as CID);
      if (!bytes) {
        return reply.status(404).send({ error: "not_found" });
      }

      return reply
        .header("content-type", "application/octet-stream")
        .header("x-content-cid", cid)
        .send(Buffer.from(bytes));
    },
  );
}
