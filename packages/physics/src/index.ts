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

// Epoch aggregation (pure receipt grouping + eligibility)
export {
  aggregateReceipts,
  isPayoutEligible,
  type ReceiptDigest,
  type EpochGroup,
} from "./epoch-aggregation.js";

// Availability scoring (pure check result → score)
export {
  computeAvailabilityScore,
  AVAILABILITY_WINDOW_EPOCHS,
  AVAILABILITY_TRUSTED_THRESHOLD,
  INACTIVE_ZERO_EPOCHS,
  type CheckResult,
  type AvailabilityAssessment,
} from "./availability.js";

// Ed25519 sign/verify (event signatures, key generation)
export {
  generateKeypair,
  ed25519Sign,
  ed25519Verify,
} from "./ed25519.js";

// Event signature (sign/verify canonical-encoded payloads)
export {
  signEventPayload,
  verifyEventSignature,
} from "./event-signature.js";

// Block selection (anti-special-casing PRF)
export {
  selectBlockIndex,
  selectBlock,
  verifyBlockSelection,
  blockSelectionPrfHash,
} from "./block-selection.js";

// All schemas
export * from "./schemas/index.js";

// Constants
export * from "./constants.js";
