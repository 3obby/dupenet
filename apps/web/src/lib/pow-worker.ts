/**
 * Event PoW Web Worker — mines nonce in background thread.
 * Receives challenge (hex) + target (hex), returns nonce + powHash.
 * Uses @noble/hashes for SHA256 (sync, fast tight loop).
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

self.onmessage = (e: MessageEvent) => {
  const { challengeHex, targetHex, maxAttempts } = e.data as {
    challengeHex: string;
    targetHex: string;
    maxAttempts: number;
  };

  const challenge = hexToBytes(challengeHex);
  const target = BigInt("0x" + targetHex);
  const max = BigInt(maxAttempts);

  for (let n = 0n; n < max; n++) {
    const nonceBuf = new Uint8Array(8);
    new DataView(nonceBuf.buffer).setBigUint64(0, n, false);

    const combined = new Uint8Array(challenge.length + 8);
    combined.set(challenge, 0);
    combined.set(nonceBuf, challenge.length);

    const hash = bytesToHex(sha256(combined));

    if (BigInt("0x" + hash) < target) {
      self.postMessage({
        nonceHex: n.toString(16).padStart(16, "0"),
        powHash: hash,
      });
      return;
    }
  }

  self.postMessage({ error: `no valid nonce in ${maxAttempts} attempts` });
};
