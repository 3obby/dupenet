/**
 * Event log writer — Prisma-backed append-only store.
 * DocRef: MVP_PLAN:§Longevity L4
 *
 * Every mutation is a signed event stored in Postgres.
 * The bounty ledger, host registry, and pin contracts are
 * materialized views over this log. Anyone can replay and reconstruct state.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { EventEnvelope } from "./schemas.js";

export async function appendEvent(
  prisma: PrismaClient,
  event: Omit<EventEnvelope, "seq">,
): Promise<EventEnvelope> {
  const record = await prisma.event.create({
    data: {
      type: event.type,
      timestamp: BigInt(event.timestamp),
      signer: event.signer,
      sig: event.sig,
      payload: event.payload as Prisma.InputJsonValue,
    },
  });

  return {
    seq: record.seq,
    type: record.type,
    timestamp: Number(record.timestamp),
    signer: record.signer,
    sig: record.sig,
    payload: record.payload,
  };
}

export async function getEvents(
  prisma: PrismaClient,
  fromSeq: number = 0,
): Promise<EventEnvelope[]> {
  const records = await prisma.event.findMany({
    where: { seq: { gte: fromSeq } },
    orderBy: { seq: "asc" },
  });

  return records.map((r) => ({
    seq: r.seq,
    type: r.type,
    timestamp: Number(r.timestamp),
    signer: r.signer,
    sig: r.sig,
    payload: r.payload,
  }));
}

export async function getEventsByType(
  prisma: PrismaClient,
  type: string,
): Promise<EventEnvelope[]> {
  const records = await prisma.event.findMany({
    where: { type },
    orderBy: { seq: "asc" },
  });

  return records.map((r) => ({
    seq: r.seq,
    type: r.type,
    timestamp: Number(r.timestamp),
    signer: r.signer,
    sig: r.sig,
    payload: r.payload,
  }));
}

export async function getEventCount(
  prisma: PrismaClient,
): Promise<number> {
  return prisma.event.count();
}
