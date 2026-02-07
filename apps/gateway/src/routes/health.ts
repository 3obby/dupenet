/**
 * Health + spot-check routes.
 * DocRef: MVP_PLAN:§Enforcement: Earning Decay
 *
 * GET /health          — basic liveness check
 * GET /spot-check/:cid — prove we have a block (hash verified, no L402, no bytes)
 */

import type { FastifyInstance } from "fastify";
import type { BlockStore } from "../storage/block-store.js";
import { cidFromBytes } from "@dupenet/physics";

export function healthRoutes(app: FastifyInstance, store?: BlockStore): void {
  app.get("/health", async (_request, reply) => {
    return reply.send({ status: "ok", timestamp: Date.now() });
  });

  /**
   * GET /spot-check/:cid — coordinator calls this to verify host has block.
   * No L402 gate. Returns { verified, size } without sending block bytes.
   * 30s timeout enforced by caller.
   */
  if (store) {
    app.get<{ Params: { cid: string } }>(
      "/spot-check/:cid",
      async (request, reply) => {
        const { cid } = request.params;

        if (!/^[0-9a-f]{64}$/.test(cid)) {
          return reply.status(400).send({ error: "invalid_cid" });
        }

        const bytes = await store.get(cid);
        if (!bytes) {
          return reply.status(404).send({ error: "block_not_found", cid });
        }

        // Verify stored bytes still hash correctly
        const computedCid = cidFromBytes(bytes);
        const verified = computedCid === cid;

        return reply.send({
          cid,
          verified,
          size: bytes.length,
          timestamp: Date.now(),
        });
      },
    );
  }
}
