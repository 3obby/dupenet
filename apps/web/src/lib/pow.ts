/**
 * Event PoW — build challenge from unsigned event, mine in Web Worker.
 * Required for free writes (sats=0). Never blocks UI.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const EV1_POW_PREFIX = "EV1_POW";
// EVENT_POW_TARGET = 2^240
const TARGET_HEX =
  "0001" + "0".repeat(60);
const MAX_ATTEMPTS = 10_000_000;

interface UnsignedEvent {
  v: number;
  kind: number;
  from: string;
  ref: string;
  body: string;
  sats: number;
  ts: number;
}

/**
 * Build the PoW challenge for an event.
 * Must match physics buildEventPowChallenge exactly.
 */
function buildChallenge(event: UnsignedEvent): Uint8Array {
  const enc = new TextEncoder();
  const prefix = enc.encode(EV1_POW_PREFIX);
  const fromBytes = hexToBytes(event.from);
  const tsBuf = new Uint8Array(8);
  new DataView(tsBuf.buffer).setBigUint64(0, BigInt(event.ts), false);
  const kindBuf = new Uint8Array([event.kind]);
  const refBytes = hexToBytes(event.ref);
  const bodyBytes =
    event.body.length > 0 ? hexToBytes(event.body) : new Uint8Array(0);
  const bodyHash = sha256(bodyBytes);

  const total =
    prefix.length + fromBytes.length + 8 + 1 + refBytes.length + 32;
  const buf = new Uint8Array(total);
  let off = 0;
  buf.set(prefix, off); off += prefix.length;
  buf.set(fromBytes, off); off += fromBytes.length;
  buf.set(tsBuf, off); off += 8;
  buf.set(kindBuf, off); off += 1;
  buf.set(refBytes, off); off += refBytes.length;
  buf.set(bodyHash, off);

  return sha256(buf);
}

export interface PowResult {
  nonceHex: string;
  powHash: string;
}

/**
 * Mine event PoW in a Web Worker.
 * Returns { nonceHex, powHash } on success.
 * Falls back to main-thread mining if Worker unavailable.
 */
export function mineEventPow(
  event: UnsignedEvent,
): Promise<PowResult> {
  const challenge = buildChallenge(event);
  const challengeHex = bytesToHex(challenge);

  // Try Web Worker
  if (typeof Worker !== "undefined") {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(
          new URL("./pow-worker.ts", import.meta.url),
        );
        worker.onmessage = (e: MessageEvent) => {
          worker.terminate();
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            resolve({
              nonceHex: e.data.nonceHex,
              powHash: e.data.powHash,
            });
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          // Fallback to main thread
          resolve(mineMainThread(challenge));
        };
        worker.postMessage({
          challengeHex,
          targetHex: TARGET_HEX,
          maxAttempts: MAX_ATTEMPTS,
        });
      } catch {
        // Worker creation failed — fallback
        resolve(mineMainThread(challenge));
      }
    });
  }

  // No Worker support — mine on main thread
  return Promise.resolve(mineMainThread(challenge));
}

/** Fallback: mine on main thread (~65ms at 2^240 target). */
function mineMainThread(challenge: Uint8Array): PowResult {
  const target = BigInt("0x" + TARGET_HEX);

  for (let n = 0n; n < BigInt(MAX_ATTEMPTS); n++) {
    const nonceBuf = new Uint8Array(8);
    new DataView(nonceBuf.buffer).setBigUint64(0, n, false);

    const combined = new Uint8Array(challenge.length + 8);
    combined.set(challenge, 0);
    combined.set(nonceBuf, challenge.length);

    const hash = bytesToHex(sha256(combined));
    if (BigInt("0x" + hash) < target) {
      return {
        nonceHex: n.toString(16).padStart(16, "0"),
        powHash: hash,
      };
    }
  }

  throw new Error("PoW: no valid nonce found");
}
