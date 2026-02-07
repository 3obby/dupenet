/**
 * @dupenet/physics — Frozen protocol primitives.
 *
 * This package contains ONLY frozen physics and versioned schemas.
 * It has no business logic, no I/O, no state.
 * Everything else in the monorepo imports from here, never the reverse.
 */

// Frozen primitives
export { canonicalEncode, canonicalDecode } from "./canonical.js";
export { cidFromBytes, cidFromObject, hashBytes, fromHex, toHex, verifyCid, type CID } from "./cid.js";
export { merkleRoot, verifyMerkleProof } from "./merkle.js";

// File layer
export { chunkFile, reassembleFile, type ChunkResult } from "./chunker.js";

// Receipt challenge + PoW + payload construction
export {
  buildChallenge,
  buildChallengeRaw,
  buildTokenPayload,
  buildClientSigPayload,
  computePowHash,
  getTarget,
  powMeetsTarget,
  minePoW,
  type ChallengeInput,
} from "./receipt-challenge.js";

// Epoch utilities
export {
  epochFromTimestamp,
  currentEpoch,
  epochStartMs,
  epochEndMs,
  setGenesisTimestamp,
  getGenesisTimestamp,
} from "./epoch.js";

// Reward computation
export {
  cidEpochCap,
  computeHostScore,
  distributeRewards,
  type HostScore,
} from "./reward.js";

// All schemas
export * from "./schemas/index.js";

// Constants
export * from "./constants.js";
