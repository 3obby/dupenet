/**
 * Pricing route — GET /pricing
 * DocRef: MVP_PLAN:§Egress Pricing
 */

import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

export function pricingRoutes(app: FastifyInstance): void {
  app.get("/pricing", async (_request, reply) => {
    return reply.send({
      min_request_sats: config.minRequestSats,
      sats_per_gb: config.satsPerGb,
    });
  });
}
