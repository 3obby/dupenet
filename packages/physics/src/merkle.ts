/**
 * Merkle tree for ordered block CIDs.
 * DocRef: MVP_PLAN:§Entity Schemas (FileManifestV1.merkle_root)
 *
 * merkle_root = SHA256(canonical(ordered block CIDs))
 *
 * Simple binary merkle tree. Odd leaf is promoted.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fromHex, type CID } from "./cid.js";

/**
 * Compute merkle root from an ordered list of block CIDs.
 * Returns the hex-encoded root hash.
 */
export function merkleRoot(blockCids: readonly CID[]): CID {
  if (blockCids.length === 0) {
    throw new Error("merkleRoot: empty block list");
  }

  let level: Uint8Array[] = blockCids.map((cid) => fromHex(cid));

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      if (i + 1 < level.length) {
        const right = level[i + 1]!;
        // Concatenate left || right, then hash
        const combined = new Uint8Array(left.length + right.length);
        combined.set(left, 0);
        combined.set(right, left.length);
        next.push(sha256(combined));
      } else {
        // Odd leaf promoted
        next.push(left);
      }
    }
    level = next;
  }

  return bytesToHex(level[0]!);
}

/**
 * Verify a merkle proof for a given leaf.
 */
export function verifyMerkleProof(
  leaf: CID,
  proof: readonly { hash: CID; position: "left" | "right" }[],
  root: CID,
): boolean {
  let current = fromHex(leaf);

  for (const step of proof) {
    const sibling = fromHex(step.hash);
    const combined = new Uint8Array(64);
    if (step.position === "left") {
      combined.set(sibling, 0);
      combined.set(current, 32);
    } else {
      combined.set(current, 0);
      combined.set(sibling, 32);
    }
    current = sha256(combined);
  }

  return bytesToHex(current) === root;
}
