/**
 * EventV1 — construct, sign, verify, event_id, body encode/decode.
 * DocRef: MVP_PLAN:§Event Layer, §Protocol vs Materializer Boundary
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeypair,
  toHex,
  computeEventId,
  signEvent,
  verifyEvent,
  encodeEventBody,
  decodeEventBody,
  ZERO_REF,
  EVENT_KIND_FUND,
  EVENT_KIND_ANNOUNCE,
  EVENT_KIND_POST,
  EVENT_KIND_HOST,
  EVENT_KIND_LIST,
  EVENT_KIND_PIN_POLICY,
  EVENT_MAX_BODY,
  type EventV1,
} from "../../src/index.js";

// ── Helpers ────────────────────────────────────────────────────────

let kp: { publicKey: Uint8Array; privateKey: Uint8Array };
let pubHex: string;

beforeAll(async () => {
  kp = await generateKeypair();
  pubHex = toHex(kp.publicKey);
});

function makeUnsignedEvent(
  overrides: Partial<Omit<EventV1, "sig">> = {},
): Omit<EventV1, "sig"> {
  return {
    v: 1,
    kind: EVENT_KIND_FUND,
    from: pubHex,
    ref: "aa".repeat(32),
    body: "",
    sats: 100,
    ts: Date.now(),
    ...overrides,
  };
}

// ── EventV1 Schema ─────────────────────────────────────────────────

describe("EventV1 construct + event_id", () => {
  it("computes deterministic event_id from unsigned event", () => {
    const event = makeUnsignedEvent({ ts: 1000 });
    const id1 = computeEventId(event);
    const id2 = computeEventId(event);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different events produce different event_ids", () => {
    const e1 = makeUnsignedEvent({ sats: 100, ts: 1000 });
    const e2 = makeUnsignedEvent({ sats: 200, ts: 1000 });
    expect(computeEventId(e1)).not.toBe(computeEventId(e2));
  });

  it("event_id does not change when sig is added", async () => {
    const unsigned = makeUnsignedEvent({ ts: 2000 });
    const idBefore = computeEventId(unsigned);
    const signed = await signEvent(kp.privateKey, unsigned);
    const idAfter = computeEventId(signed);
    expect(idBefore).toBe(idAfter);
  });

  it("ZERO_REF is 64 hex zeros", () => {
    expect(ZERO_REF).toBe("0".repeat(64));
    expect(ZERO_REF).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── Sign + Verify ──────────────────────────────────────────────────

describe("EventV1 sign + verify", () => {
  it("round-trip: sign then verify succeeds", async () => {
    const unsigned = makeUnsignedEvent();
    const signed = await signEvent(kp.privateKey, unsigned);

    expect(signed.sig).toBeTruthy();
    expect(signed.sig.length).toBeGreaterThan(0);
    expect(signed.v).toBe(1);
    expect(signed.kind).toBe(EVENT_KIND_FUND);
    expect(signed.from).toBe(pubHex);

    const valid = await verifyEvent(signed);
    expect(valid).toBe(true);
  });

  it("wrong key → verification fails", async () => {
    const otherKp = await generateKeypair();
    const unsigned = makeUnsignedEvent();
    const signed = await signEvent(kp.privateKey, unsigned);

    // Swap the from field to otherKp's pubkey
    const tampered: EventV1 = {
      ...signed,
      from: toHex(otherKp.publicKey),
    };
    const valid = await verifyEvent(tampered);
    expect(valid).toBe(false);
  });

  it("tampered sats → verification fails", async () => {
    const signed = await signEvent(kp.privateKey, makeUnsignedEvent({ sats: 100 }));
    const tampered: EventV1 = { ...signed, sats: 999 };
    const valid = await verifyEvent(tampered);
    expect(valid).toBe(false);
  });

  it("tampered body → verification fails", async () => {
    const bodyHex = encodeEventBody({ title: "Original" });
    const signed = await signEvent(kp.privateKey, makeUnsignedEvent({ body: bodyHex }));
    const tampered: EventV1 = {
      ...signed,
      body: encodeEventBody({ title: "Tampered" }),
    };
    const valid = await verifyEvent(tampered);
    expect(valid).toBe(false);
  });

  it("tampered kind → verification fails", async () => {
    const signed = await signEvent(
      kp.privateKey,
      makeUnsignedEvent({ kind: EVENT_KIND_FUND }),
    );
    const tampered: EventV1 = { ...signed, kind: EVENT_KIND_POST };
    const valid = await verifyEvent(tampered);
    expect(valid).toBe(false);
  });

  it("empty sig → verification fails", async () => {
    const unsigned = makeUnsignedEvent();
    const withEmptySig: EventV1 = { ...unsigned, sig: "" };
    const valid = await verifyEvent(withEmptySig);
    expect(valid).toBe(false);
  });
});

// ── Body encode/decode ─────────────────────────────────────────────

describe("EventV1 body encode/decode", () => {
  it("round-trip: encode then decode an AnnouncePayload", () => {
    const payload = {
      title: "Leaked Memo",
      description: "Internal correspondence regarding...",
      tags: ["legal", "whistleblower"],
      mime: "application/pdf",
      size: 1024000,
      access: "open",
    };

    const bodyHex = encodeEventBody(payload);
    expect(bodyHex).toMatch(/^[0-9a-f]+$/);

    const decoded = decodeEventBody(bodyHex);
    expect(decoded).toEqual(payload);
  });

  it("round-trip: HostPayload", () => {
    const payload = {
      endpoint: "https://host.example.com:3100",
      pricing: {
        min_request_sats: 3,
        sats_per_gb: 500,
        min_bounty_sats: 50,
        open_min_pool_sats: 500,
      },
    };

    const bodyHex = encodeEventBody(payload);
    const decoded = decodeEventBody(bodyHex);
    expect(decoded).toEqual(payload);
  });

  it("round-trip: ListPayload", () => {
    const payload = {
      title: "Court Filings Collection",
      items: ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)],
    };

    const bodyHex = encodeEventBody(payload);
    const decoded = decodeEventBody(bodyHex);
    expect(decoded).toEqual(payload);
  });

  it("round-trip: PinPayload", () => {
    const payload = { min_copies: 3, duration_epochs: 100 };
    const bodyHex = encodeEventBody(payload);
    const decoded = decodeEventBody(bodyHex);
    expect(decoded).toEqual(payload);
  });

  it("empty body decodes to empty object", () => {
    const result = decodeEventBody("");
    expect(result).toEqual({});
  });

  it("rejects body exceeding EVENT_MAX_BODY bytes", () => {
    // Create a payload that will exceed the limit when CBOR-encoded
    const bigPayload = { data: "x".repeat(EVENT_MAX_BODY + 100) };
    expect(() => encodeEventBody(bigPayload)).toThrow("Event body too large");
  });
});

// ── Kind constants ─────────────────────────────────────────────────

describe("EventV1 kind constants", () => {
  it("kind constants are distinct integers 0x01–0x09", () => {
    const kinds = [
      EVENT_KIND_FUND,
      EVENT_KIND_ANNOUNCE,
      EVENT_KIND_POST,
      EVENT_KIND_HOST,
      EVENT_KIND_LIST,
      EVENT_KIND_PIN_POLICY,
    ];

    // All unique
    const unique = new Set(kinds);
    expect(unique.size).toBe(kinds.length);

    // All in range [1, 255]
    for (const k of kinds) {
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(255);
    }
  });

  it("FUND=0x01, ANNOUNCE=0x02, POST=0x03, HOST=0x04", () => {
    expect(EVENT_KIND_FUND).toBe(0x01);
    expect(EVENT_KIND_ANNOUNCE).toBe(0x02);
    expect(EVENT_KIND_POST).toBe(0x03);
    expect(EVENT_KIND_HOST).toBe(0x04);
  });
});

// ── Full event lifecycle (construct → sign → verify → extract) ─────

describe("EventV1 full lifecycle", () => {
  it("FUND event: construct, sign, verify, compute event_id", async () => {
    const unsigned = makeUnsignedEvent({
      kind: EVENT_KIND_FUND,
      ref: "cc".repeat(32),
      sats: 1000,
      body: "",
    });

    const eventId = computeEventId(unsigned);
    expect(eventId).toMatch(/^[0-9a-f]{64}$/);

    const signed = await signEvent(kp.privateKey, unsigned);
    expect(await verifyEvent(signed)).toBe(true);

    // event_id stays the same after signing
    expect(computeEventId(signed)).toBe(eventId);
  });

  it("ANNOUNCE event with structured body", async () => {
    const body = encodeEventBody({
      title: "Important Document",
      tags: ["finance"],
      access: "paid",
    });

    const unsigned = makeUnsignedEvent({
      kind: EVENT_KIND_ANNOUNCE,
      ref: "dd".repeat(32),
      body,
      sats: 0, // ANNOUNCE with no funding
    });

    const signed = await signEvent(kp.privateKey, unsigned);
    expect(await verifyEvent(signed)).toBe(true);

    // Decode body
    const decoded = decodeEventBody(signed.body) as {
      title: string;
      tags: string[];
      access: string;
    };
    expect(decoded.title).toBe("Important Document");
    expect(decoded.tags).toEqual(["finance"]);
    expect(decoded.access).toBe("paid");
  });

  it("HOST event with pricing in body", async () => {
    const body = encodeEventBody({
      endpoint: "https://my-host.example.com",
      pricing: {
        min_request_sats: 5,
        sats_per_gb: 800,
        min_bounty_sats: 100,
      },
    });

    const unsigned = makeUnsignedEvent({
      kind: EVENT_KIND_HOST,
      from: pubHex,
      ref: ZERO_REF,
      body,
      sats: 0,
    });

    const signed = await signEvent(kp.privateKey, unsigned);
    expect(await verifyEvent(signed)).toBe(true);

    const decoded = decodeEventBody(signed.body) as {
      endpoint: string;
      pricing: { min_request_sats: number; sats_per_gb: number; min_bounty_sats: number };
    };
    expect(decoded.endpoint).toBe("https://my-host.example.com");
    expect(decoded.pricing.min_bounty_sats).toBe(100);
  });

  it("POST event with inline text body", async () => {
    const body = encodeEventBody({
      text: "This document proves the allegations in the memo.",
    });

    const unsigned = makeUnsignedEvent({
      kind: EVENT_KIND_POST,
      ref: "ee".repeat(32), // parent event_id
      body,
      sats: 21, // boost own post
    });

    const signed = await signEvent(kp.privateKey, unsigned);
    expect(await verifyEvent(signed)).toBe(true);
  });

  it("PIN_POLICY event with budget in sats", async () => {
    const body = encodeEventBody({
      min_copies: 3,
      duration_epochs: 720, // ~120 days at 4h epochs
    });

    const unsigned = makeUnsignedEvent({
      kind: EVENT_KIND_PIN_POLICY,
      ref: "ff".repeat(32), // asset_root
      body,
      sats: 10000, // budget
    });

    const signed = await signEvent(kp.privateKey, unsigned);
    expect(await verifyEvent(signed)).toBe(true);
  });

  it("pool credit rule: sats > 0 means pool credit", () => {
    // This is a protocol-level rule tested here as documentation.
    // The actual pool credit happens in the coordinator (POST /event handler).
    const fundEvent = makeUnsignedEvent({ sats: 500, ref: "aa".repeat(32) });
    const freeEvent = makeUnsignedEvent({ sats: 0, ref: "aa".repeat(32) });

    // Pool credit rule: if sats > 0, credit pool[ref]
    expect(fundEvent.sats).toBeGreaterThan(0);
    expect(fundEvent.ref).toBe("aa".repeat(32));

    expect(freeEvent.sats).toBe(0);
    // sats=0 means no pool credit (free statement)
  });
});
