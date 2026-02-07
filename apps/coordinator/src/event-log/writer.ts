/**
 * Event log writer — append signed events.
 * DocRef: MVP_PLAN:§Longevity L4
 *
 * MVP: events stored in Postgres. Architecture supports replacement
 * with any append-only store (file, Nostr events, etc).
 */

import type { EventEnvelope } from "./schemas.js";

/** In-memory event log for MVP. Replace with Postgres/file in Sprint 6. */
const events: EventEnvelope[] = [];
let nextSeq = 0;

export function appendEvent(event: Omit<EventEnvelope, "seq">): EventEnvelope {
  const full: EventEnvelope = { ...event, seq: nextSeq++ };
  events.push(full);
  return full;
}

export function getEvents(fromSeq: number = 0): readonly EventEnvelope[] {
  return events.filter((e) => e.seq >= fromSeq);
}

export function getEventsByType(type: string): readonly EventEnvelope[] {
  return events.filter((e) => e.type === type);
}

export function getEventCount(): number {
  return events.length;
}
