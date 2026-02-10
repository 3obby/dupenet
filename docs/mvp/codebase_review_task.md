# Codebase Review Task

**Purpose**: Exhaustive review of all completed code + tests against the current MVP plan. Identify anything that is dead code, suboptimal, inconsistent, or missing coverage.

**Context**: The MVP plan (`docs/mvp/mvp_plan.md`) evolved significantly after Phase 1 was built. Key changes: volume-tapering founder royalty (replacing flat 5% fee), open-access content tier, 4-page minimum web surface, client interaction model (browser keys, event PoW, upload shim), pool keys generalized to bytes32. Some fixes have already landed (royalty formula, PricingV1 fields, stale constants removed). The remaining divergences are tracked in `progress_overview.txt` under §DIVERGENCES.

**Run this as 4 parallel sub-tasks, one per area. Each should produce a structured report.**

---

## Task 1: packages/physics (all files)

Read every `.ts` file in `packages/physics/src/` and `packages/physics/test/`.

For each source file, check:
1. Does the code match the corresponding MVP plan section? (DocRef comments in each file point to the relevant section)
2. Are there functions/exports that are no longer needed given the current plan?
3. Are there functions the plan specifies that don't exist yet? (Note as "needed for Sprint X")
4. Do the test vectors still exercise the right behavior? (e.g., reward.test.ts tests cidEpochCap — does it test the log-scaled formula correctly?)
5. Are there edge cases the tests miss? (e.g., royalty.ts is new — does it have tests?)
6. Is the index.ts barrel export complete? Any dead exports?

Specific things to verify:
- `royalty.ts`: new file — verify formula matches `r(v) = R0 × (1 + v/V_STAR)^(-ALPHA)`. Check edge cases: v=0 (should return R0=0.15), very large v (should approach 0), negative amounts.
- `constants.ts`: verify no stale constants remain. Verify all plan constants that should exist do exist.
- `schemas/host.ts`: verify PricingV1 has all 6 fields per plan. Verify additionalProperties is still false (may need to be relaxed for Optional fields).
- `reward.ts`: verify cidEpochCap formula matches plan. Verify distributeRewards deducts AGGREGATOR_FEE_PCT correctly.
- `receipt-challenge.ts`: verify challenge format matches plan §Receipt Rules.
- `block-selection.ts`: verify PRF matches plan §Block Selection.
- `epoch-aggregation.ts`: verify 5/3 threshold matches plan.
- `availability.ts`: verify 0.6 threshold, 6-epoch window, status transitions match plan.

**Output**: For each file — status (OK / needs fix / needs test / dead code), specific issues if any.

---

## Task 2: apps/coordinator (all files)

Read every `.ts` file in `apps/coordinator/src/` and `apps/coordinator/test/`.

For each source file, check:
1. Does the route/handler match the MVP plan interface tables?
2. Are there routes that will be replaced by POST /event in Sprint 7b? (Mark as "shim in 7b", not "dead code")
3. Is the Prisma schema consistent with the plan entity model? Note the BountyPool.cid → poolKey migration needed.
4. Do tests mock Prisma correctly? (The aggregate mock was just added for creditTip — check all other mocks are complete)
5. Are there coordinator behaviors not covered by tests?

Specific things to verify:
- `bounty-pool.ts`: verify creditTip uses computeRoyalty correctly. Verify getCumulativeVolume query. Verify creditBountyDirect still has no fee (pin contracts).
- `epoch-settlement.ts`: verify it uses cidEpochCap, checks 5/3 threshold, deducts AGGREGATOR_FEE_PCT. Check for any hardcoded fee percentages that should reference constants.
- `host-registry.ts`: verify status lifecycle matches plan (PENDING→TRUSTED→DEGRADED→INACTIVE). Check stake verification is still stubbed (noted as TODO).
- `pin-contracts.ts`: verify 5% cancel fee. Note SLA-triggered cancel distinction is missing (deferred).
- `scheduler.ts`: verify epoch boundary trigger logic.
- `server.ts`: audit all routes against plan interface tables. Note which routes become POST /event shims.
- `prisma/schema.prisma`: compare every model/field against plan entity model. List missing fields.
- All test files: check mocks are complete (especially bountyPool.aggregate), check coverage gaps.

**Output**: For each file — status, issues, test coverage assessment.

---

## Task 3: apps/gateway + apps/mint + packages/receipt-sdk + packages/lnd-client

Read every `.ts` file in these 4 packages.

For each source file, check:
1. Gateway routes: match plan §Interface: Client → Operator table?
2. L402 flow: match plan §Fetch Flow steps 1-7?
3. Mint signer: token format match plan §Receipt token?
4. Receipt SDK: verification steps match plan §Receipt Validation?
5. Any dead code or unused exports?

Specific things to verify:
- `gateway/src/routes/block.ts`: L402 challenge-response. Note: no free preview tier yet (needed Sprint 7b). Note: no GET /cid/:hash yet.
- `gateway/src/storage/block-store.ts`: filesystem layout matches plan.
- `gateway/src/l402/invoice-store.ts`: TTL, single-use enforcement.
- `gateway/src/l402/mint-client.ts`: POST /sign call to mint.
- `mint/src/signer.ts`: verify token payload format exactly matches `Sign("R2" || host || epoch || block_cid || response_hash || price || payment_hash)`.
- `receipt-sdk/src/verify.ts`: verify all 4 checks (hex validation, PoW, token, client_sig). Zero-dep confirmation.
- `lnd-client/`: verify interface covers createInvoice, lookupInvoice. Check MockLndClient is complete.
- All test files: coverage assessment.

**Output**: For each file — status, issues, test gaps.

---

## Task 4: apps/cli + apps/node-agent + deploy/

Read every `.ts` file in these packages, plus all deploy/ config files.

For each source file, check:
1. CLI commands: match plan §CLI and §Interface tables?
2. Node-agent: mirror + announce logic matches plan §Node Kit?
3. Deploy configs: compose files consistent with plan §Infrastructure Partners?
4. Scripts: still functional given code changes?

Specific things to verify:
- `cli/src/commands/tip.ts`: now shows "founder_royalty" — verify response parsing still works.
- `cli/src/commands/upload.ts`: check chunking flow matches plan. Note: no --access flag yet.
- `cli/src/commands/fetch.ts`: check both single-block and multi-block paths. Note: uses /asset/ and /block/, not /cid/ yet.
- `node-agent/src/mirror.ts`: check profitability filter logic. Note: should publish min_bounty_sats (not yet).
- `node-agent/src/announce.ts`: check signed registration. Note: will migrate to EventV1 kind=HOST.
- `deploy/compose-production.yml`: check it matches plan §Infrastructure Partners (FlokiNET Romania).
- `deploy/compose-founder.yml`: check all services present (gateway, mint, coordinator, postgres, lnd, caddy).
- `scripts/`: check gen-keys.sh generates 3 mint keys. Check backup.sh targets match Prisma DB.

**Output**: For each file — status, issues, migration notes for Sprint 7b.

---

## Final output format

For each task, produce:

```
## [Package/App Name]

### [filename]
Status: OK | NEEDS_FIX | NEEDS_TEST | DEAD_CODE | MIGRATION_7B
Issues: (if any)
Test coverage: (adequate / gaps noted)

### Summary
- Files reviewed: N
- OK: N
- Needs fix: N (list)
- Needs test: N (list)
- Dead code: N (list)
- Sprint 7b migration: N (list)
```

---
---

# REVIEW RESULTS (2026-02-09)

95 TypeScript files + 6 deploy configs + 5 scripts + 1 Prisma schema reviewed.

---

## Task 1: packages/physics

### royalty.ts
Status: NEEDS_TEST
Issues:
  - Formula matches plan: r(v) = R0 × (1 + v/V_STAR)^(-ALPHA) ✓
  - v=0 → returns R0=0.15 ✓
  - Very large v → approaches 0 ✓
  - cumulativeFounderIncome integral formula matches plan I(V) ✓
  - computeRoyalty uses Math.floor correctly (sats are integers) ✓
  - EDGE CASE GAP: No guard on negative `amount` or `cumulativeVolume`.
    founderRoyaltyRate(-125_000_000) → Infinity.
    computeRoyalty(-100, 0) → negative royalty. Should clamp or throw.
Test coverage: No tests exist yet — NEEDS_TEST (highest priority)

### constants.ts
Status: OK
Issues:
  - Stale constants removed: TIP_PROTOCOL_FEE_PCT, PROTOCOL_FEE_HALVING_YEARS, PROTOCOL_FEE_SUNSET_YEARS ✓
  - All plan constants verified present and correct:
    FOUNDER_ROYALTY_R0=0.15, V_STAR=125M, ALPHA=log(2)/log(9),
    AGGREGATOR_FEE_PCT=0.03, CHUNK_SIZE_DEFAULT=262144, EPOCH_LENGTH_MS=14400000 (4h),
    RECEIPT_MIN_COUNT=5, RECEIPT_MIN_UNIQUE_CLIENTS=3,
    EVENT_POW_TARGET=2^240, EVENT_MAX_BODY=16384, MAX_LIST_ITEMS=1000,
    FREE_PREVIEW_MAX_BYTES=16384, BURST_SATS_PER_GB=2000,
    MIN_BOUNTY_SATS_DEFAULT=50, OPEN_MIN_POOL_SATS_DEFAULT=500 ✓
  - Availability thresholds (0.6, 6) live in availability.ts — OK
  - Omitted: SNAPSHOT_INTERVAL_EPOCHS, ANCHOR_INTERVAL_EPOCHS,
    PREVIEW_THUMB_WIDTH, PREVIEW_TEXT_CHARS — coordinator/materializer constants, acceptable
Test coverage: N/A (constants)

### schemas/host.ts
Status: OK
Issues:
  - PricingV1 has all 6 fields:
    min_request_sats (required), sats_per_gb (required),
    burst_sats_per_gb (Optional), min_bounty_sats (Optional),
    sats_per_gb_month (Optional), open_min_pool_sats (Optional) ✓
  - additionalProperties: false ✓
  - HostStatus: PENDING, TRUSTED, DEGRADED, INACTIVE, UNBONDING, SLASHED ✓
  - HostV1, HostServeV1 schemas complete ✓
Test coverage: N/A (schema)

### reward.ts
Status: OK
Issues:
  - cidEpochCap formula matches plan: min(bounty×EPOCH_REWARD_PCT, base×(1+floor(log2(bounty/base+1)))) ✓
  - distributeRewards deducts AGGREGATOR_FEE_PCT: afterFee = cap × (1 - 0.03) ✓
  - computeHostScore uses W_CLIENTS, W_UPTIME, W_DIVERSITY ✓
  - Score-weighted proportional split with Math.floor ✓
  - Zero-host and zero-score edge cases handled ✓
Test coverage: reward.test.ts — good (7 test cases with frozen numeric vectors)

### receipt-challenge.ts
Status: NEEDS_TEST
Issues:
  - Challenge format: H("RECEIPT_V2" || asset_root? || file_root || block_cid || host || payment_hash || response_hash || epoch || client_pubkey) ✓
  - Token payload: "R2" prefix ✓
  - Client sig payload: challengeRaw || nonce || pow_hash ✓
  - PoW: H(challenge || nonce) vs target ✓
  - getTarget: POW_TARGET_BASE >> floor(log2(receipt_count + 1)) ✓
  - All 8 exported functions correctly implemented
Test coverage: NO TEST FILE — 8 exported crypto functions untested (high priority)

### block-selection.ts
Status: OK
Issues:
  - PRF: SHA256("BLOCK_SELECT" || epoch_u32be || file_root || client_pubkey) ✓
  - 48-bit hash extraction for modular reduction ✓
  - selectBlock, verifyBlockSelection correct ✓
  - Edge cases: numBlocks ≤ 0 → 0, numBlocks=1 → 0 ✓
Test coverage: block-selection.test.ts — excellent (15 test cases incl. distribution uniformity)

### epoch-aggregation.ts
Status: OK
Issues:
  - Groups by (host, cid) ✓
  - isPayoutEligible: receiptCount >= 5 AND uniqueClients >= 3 (5/3 threshold) ✓
  - Pure function, no state ✓
Test coverage: epoch-aggregation.test.ts — excellent (12 test cases)

### availability.ts
Status: OK
Issues:
  - AVAILABILITY_TRUSTED_THRESHOLD = 0.6 ✓
  - AVAILABILITY_WINDOW_EPOCHS = 6 ✓
  - Status transitions: score >= 0.6 → TRUSTED, 0 < score < 0.6 → DEGRADED, score == 0 → INACTIVE ✓
  - Window filtering: epoch >= (currentEpoch - 6) ✓
  - Minor: INACTIVE_ZERO_EPOCHS exported but unused internally (available for coordinator use)
Test coverage: availability.test.ts — good (8 test cases)

### index.ts
Status: OK
Issues: Barrel export complete. All source modules re-exported. No dead exports.
Test coverage: N/A (barrel)

### canonical.ts
Status: OK
Issues:
  - Deterministic CBOR with sorted keys ✓
  - Recursive sortKeys handles objects, arrays, Uint8Array, primitives ✓
  - Note: "no floats" rule not enforced (relies on caller discipline) — acceptable for MVP
Test coverage: canonical.test.ts — adequate (5 test cases)

### chunker.ts
Status: OK
Issues:
  - Chunks to CHUNK_SIZE_DEFAULT ✓
  - Builds FileManifestV1 with merkle_root ✓
  - reassembleFile verifies CIDs and size ✓
  - Edge case missed in tests: 0-byte file
Test coverage: chunker.test.ts — good (7 test cases)

### cid.ts
Status: OK
Issues: CID = SHA256(bytes) as hex ✓. cidFromObject = SHA256(canonical(obj)) ✓. verifyCid ✓.
Test coverage: cid.test.ts — good (6 test cases with known SHA256 vectors)

### ed25519.ts
Status: OK
Issues: Web Crypto Ed25519 sign/verify ✓. PKCS8 DER wrapping ✓. wcBuf helper ✓.
Test coverage: Indirectly tested via event-signature.test.ts — adequate for MVP

### epoch.ts
Status: OK
Issues: EPOCH_LENGTH_MS = 4h ✓. All epoch math correct ✓. No test file (low priority).
Test coverage: NO TEST FILE (simple math, low priority)

### event-signature.ts
Status: OK
Issues: Signs canonical-encoded payload with Ed25519 ✓. Defensive error handling ✓.
Test coverage: event-signature.test.ts — excellent (8 test cases)

### merkle.ts
Status: OK
Issues: Binary merkle tree ✓. Odd leaf promoted ✓. verifyMerkleProof implemented ✓.
Test coverage: merkle.test.ts — GAP: verifyMerkleProof is NEVER tested.
  Needs proof generation + verification round-trip test.

### schemas/asset-root.ts
Status: OK — complete, additionalProperties: false ✓

### schemas/audit.ts
Status: OK — AuditChallengeV1 matches plan §Optional Audits ✓

### schemas/bounty.ts
Status: OK — BountyPool and TipV1 correct ✓

### schemas/directory.ts
Status: NEEDS_FIX
Issues: Missing from plan: `regions: [string]` and `refusals_cid?: hash` on DirectoryHostEntry,
  `materializers: [MaterializerV1]` on DirectoryV1 → Sprint 7b

### schemas/epoch.ts
Status: OK — EpochSummary matches plan ✓

### schemas/file-manifest.ts
Status: OK — FileManifestV1 and FileRefV1 complete ✓

### schemas/index.ts
Status: OK — all schemas re-exported, no dead exports ✓

### schemas/pin-contract.ts
Status: OK — PinContractV1 and PinStatus complete ✓

### schemas/receipt.ts
Status: OK — ReceiptV2 with RECEIPT_CHALLENGE_PREFIX = "RECEIPT_V2" ✓

### schemas/refusal.ts
Status: OK — RefusalV1 with RefusalReason and RefusalScope ✓

### Test files: availability.test.ts, block-selection.test.ts, canonical.test.ts, chunker.test.ts, cid.test.ts, epoch-aggregation.test.ts, event-signature.test.ts
Status: OK — all adequate to excellent coverage

### merkle.test.ts
Status: NEEDS_FIX — verifyMerkleProof never tested (critical for block inclusion verification)

### reward.test.ts
Status: OK — good coverage with frozen numeric vectors

### Summary (packages/physics)
- Files reviewed: 35 (26 src + 9 test)
- OK: 30
- Needs fix: 2 (schemas/directory.ts — missing fields; merkle.test.ts — verifyMerkleProof untested)
- Needs test: 3 (royalty.ts — no tests + needs negative input guards; receipt-challenge.ts — 8 crypto fns untested; epoch.ts — low priority)
- Dead code: 0
- Sprint 7b migration: 1 (schemas/directory.ts — add regions + refusals_cid)

---

## Task 2: apps/coordinator

### config.ts
Status: OK
Issues: None. Clean env-based configuration.
Test coverage: Consumed by server.ts and scheduler.ts, tested transitively.

### event-log/schemas.ts
Status: MIGRATION_7B
Issues: Event type constants (tip.v1, host.register.v1, etc.) are coordinator-internal types,
  not unified EventV1 kind bytes (0x01 FUND, 0x04 HOST). Will need mapping in Sprint 7b.
  HOST_UNBOND_EVENT and REFUSAL_EVENT defined but unused — forward declarations, not dead code.
Test coverage: Exercised transitively through route tests.

### event-log/writer.ts
Status: NEEDS_TEST
Issues: Functionally correct Prisma-backed append-only store.
Test coverage: No direct unit tests. BigInt round-trip (BigInt(timestamp) ↔ Number(record.timestamp)) untested.

### scheduler.ts
Status: OK
Issues: None. Epoch boundary trigger correct. Guards, idempotency, spot-checks all present.
Test coverage: scheduler.test.ts — 7 test cases, adequate.

### server.ts
Status: MIGRATION_7B
Issues:
  Routes becoming POST /event shims in Sprint 7b:
  - POST /tip → POST /event kind=0x01 (FUND)
  - POST /host/register → POST /event kind=0x04 (HOST)
  - POST /host/serve → merges into HOST event
  Missing routes: GET /events (query), GET /served, submit_audit, unbond, withdraw.
  GET /directory missing DirectoryV1 fields (regions, refusals_cid, materializers).
  Stake verification stubbed (TODO).
Test coverage: Route-level gaps — GET /bounty/:cid, GET /directory, POST /receipt/submit,
  POST /epoch/settle, GET /epoch/summary/:epoch, POST /hosts/check, GET /hosts/:pubkey/checks,
  GET /health have no direct route-level tests (view functions tested, but param parsing/error
  codes untested).

### views/availability.ts
Status: OK
Issues: None. Injectable fetcher for testing. Correct spot-check flow.
Test coverage: availability.test.ts — 9 test cases, adequate.

### views/bounty-pool.ts
Status: OK
Issues:
  - creditTip → getCumulativeVolume → computeRoyalty: ✓ (formula delegated to physics, no hardcoded %)
  - getCumulativeVolume: prisma.bountyPool.aggregate({ _sum: { totalTipped: true } }) ✓
  - creditBountyDirect: NO fee ✓ (pin contracts bypass royalty). totalTipped set to 0n ✓
  - BountyPool keyed by `cid` not `pool_key` → Sprint 7b migration
Test coverage: Adequate (tested via event-signatures.test.ts and pin-contracts.test.ts).

### views/epoch-settlement.ts
Status: OK
Issues:
  - Uses cidEpochCap, isPayoutEligible (5/3), AGGREGATOR_FEE_PCT from physics ✓
  - No hardcoded fee percentages ✓
  - Aggregator fee: Math.floor(cap × 0.03) ✓
  - Idempotency guard ✓
  - drainPinBudgets called after bounty debit ✓
  - Missing receipt_merkle_root on EpochSummary → Sprint 7d.1
Test coverage: epoch-settlement.test.ts — 7 test cases, adequate.

### views/host-registry.ts
Status: NEEDS_FIX
Issues:
  - BUG: INACTIVE→TRUSTED recovery missing. If host reaches INACTIVE (score=0) and later
    recovers (score≥0.6), no branch handles the transition back. INACTIVE hosts ARE still
    spot-checked, so this is a real gap — hosts stuck in INACTIVE forever.
    Fix: add `else if (score >= 0.6 && host.status === "INACTIVE") → TRUSTED`
  - Stake verification stubbed (expected)
Test coverage: Gap — no direct unit tests for registerHost, getHost, updateStatus, addServedCid.

### views/pin-contracts.ts
Status: OK
Issues:
  - 5% cancel fee (PIN_CANCEL_FEE_PCT from physics) ✓
  - creditBountyDirect (no protocol fee) ✓
  - drainPinBudgets uses min(actualDrain, drainRate, remaining) ✓
  - SLA-triggered cancel fee waiver missing (deferred Sprint 7b)
Test coverage: pin-contracts.test.ts — 15 test cases, adequate.

### prisma/schema.prisma
Status: MIGRATION_7B
Issues:
  | Model | Status | Missing |
  |---|---|---|
  | Event | OK | — |
  | BountyPool | DIVERGENCE | cid → poolKey migration needed (Sprint 7b) |
  | Host | PARTIAL | Missing: regions, refusalsCid, min_bounty_sats (Sprint 7b) |
  | HostServe | OK | — |
  | EpochSummaryRecord | PARTIAL | Missing: receiptMerkleRoot (Sprint 7d.1) |
  | Receipt | OK | — |
  | PinContract | OK | Minor: no cancel_reason (Sprint 7b) |
  | SpotCheck | OK | — |
  Missing models: Materializer, StateSnapshot, AuditChallenge (Sprint 7+)

### All test files: availability.test.ts, bounty-feed.test.ts, event-signatures.test.ts, epoch-settlement.test.ts, pin-contracts.test.ts, scheduler.test.ts
Status: OK — all mocks complete (including bountyPool.aggregate). Good coverage.

### Summary (apps/coordinator)
- Files reviewed: 17 (10 src + 6 test + 1 prisma)
- OK: 11
- Needs fix: 1 (views/host-registry.ts — INACTIVE→TRUSTED recovery missing)
- Needs test: 1 (event-log/writer.ts — no direct unit tests)
- Dead code: 0
- Sprint 7b migration: 4 (event-log/schemas.ts, server.ts, prisma/schema.prisma, views/host-registry.ts)

---

## Task 3: apps/gateway + apps/mint + packages/receipt-sdk + packages/lnd-client

### gateway/config.ts
Status: OK
Issues: satsPerGb configured (default 500) but never used in block.ts pricing —
  dead config value (pricing is flat minRequestSats).

### gateway/l402/invoice-store.ts
Status: NEEDS_FIX
Issues:
  - TTL enforcement on get(): ✓. Single-use via delete(): ✓.
  - cleanup() method defined but NEVER CALLED — no periodic eviction. Expired-but-unredeemed
    entries accumulate in memory (slow leak under traffic). Not a correctness bug but a resource leak.
  - No upper bound on store size.

### gateway/l402/mint-client.ts
Status: OK
Issues: POST /sign with all 6 fields ✓. MintClient interface properly abstracted ✓.

### gateway/routes/asset.ts
Status: OK
Issues: PUT/GET/HEAD all correct ✓. In-memory store (Map) ✓. No runtime schema validation on body.

### gateway/routes/block.ts
Status: NEEDS_FIX | MIGRATION_7B
Issues:
  - L402 challenge-response flow correct ✓
  - BUG: satsPerGb passed into context but never used — pricing is flat minRequestSats.
    Plan says: Charge = max(min_request_sats, ceil(rate × gb)). Large blocks undercharged.
  - x-content-cid header not in access-control-expose-headers (CORS clients can't read it)
  - Sprint 7b: No free preview tier, no GET /cid/:hash
Test coverage: l402.test.ts + round-trip.test.ts — good for L402 happy path + key errors.

### gateway/routes/file.ts
Status: OK
Issues: PUT/GET correct ✓. Dead code: try/catch around `request.body as FileManifestV1` (type assertion can't throw).

### gateway/routes/health.ts
Status: OK
Issues: GET /health ✓. GET /spot-check/:cid ✓. No rate limiting on spot-check (acceptable).

### gateway/routes/pricing.ts
Status: NEEDS_FIX
Issues: Returns only {min_request_sats, sats_per_gb}. Plan PricingV1 has 4 more fields:
  burst_sats_per_gb, min_bounty_sats, sats_per_gb_month, open_min_pool_sats. Incomplete.

### gateway/server.ts
Status: OK
Issues: All route registrations correct. Dev mode fallback ✓. Missing GET /served endpoint.

### gateway/storage/block-store.ts
Status: OK
Issues: Layout {base}/{h[0:2]}/{h[2:4]}/{hash} matches plan ✓. SHA256 on write ✓. Immutable ✓.

### gateway/test/integration/l402.test.ts
Status: OK — 8 tests, good L402 coverage. Gaps: TTL expiry, LND error, mint error paths.

### gateway/test/integration/round-trip.test.ts
Status: OK — 7 tests, validates full upload/download round-trip.

### mint/config.ts
Status: OK
Issues: No validation that privateKeyHex is exactly 64 hex chars.
Test coverage: NONE (no test directory)

### mint/server.ts
Status: NEEDS_FIX | NEEDS_TEST
Issues:
  - POST /sign, GET /pubkey, GET /health all correct ✓
  - Settlement verification via LND ✓
  - NO INPUT VALIDATION on POST /sign body — missing fields → runtime crash (fromHex(undefined))
  - Dev mode signs unconditionally (dangerous if accidentally deployed without LND in prod)
Test coverage: NONE — apps/mint/test/ does not exist. Critical gap for HSM component.

### mint/signer.ts
Status: OK | NEEDS_TEST
Issues:
  - Token payload: "R2" || host(32B) || epoch(4B-BE) || block_cid(32B) || response_hash(32B) || price(4B-BE) || payment_hash(32B) ✓
  - EXACTLY matches plan §Receipt token and receipt-sdk buildTokenPayload ✓
Test coverage: NONE — needs unit tests for payload construction + signing.

### receipt-sdk/ed25519.ts
Status: OK — pure Web Crypto, zero deps ✓

### receipt-sdk/index.ts
Status: OK — clean barrel ✓

### receipt-sdk/verify.ts
Status: OK
Issues:
  - All 4 checks: hex validation, PoW, token (Ed25519), client_sig ✓
  - Zero external dependencies ✓
  - POW_TARGET_BASE = 2^240 hardcoded — no difficulty escalation support yet
  - buildTokenPayload matches signer.ts byte-for-byte ✓

### receipt-sdk/test/vectors/verify.test.ts
Status: OK — full e2e positive test + negative tests (invalid hex, PoW, wrong mint key).

### lnd-client/index.ts
Status: OK — clean barrel ✓

### lnd-client/mock-client.ts
Status: OK — complete LndClient mock ✓. settleInvoice() test helper ✓.

### lnd-client/rest-client.ts
Status: OK | NEEDS_TEST
Issues:
  - createInvoice + lookupInvoice correct ✓
  - Uses deprecated node:https callback API (rest of codebase uses fetch)
  - No timeout on HTTP requests — could hang against unresponsive LND
Test coverage: NONE — critical gap for production deployment.

### lnd-client/types.ts
Status: OK — LndClient interface covers createInvoice + lookupInvoice ✓

### Summary (gateway + mint + receipt-sdk + lnd-client)
- Files reviewed: 23
- OK: 16
- Needs fix: 4 (invoice-store.ts — cleanup never called; block.ts — flat pricing, satsPerGb dead; pricing.ts — incomplete PricingV1; mint/server.ts — no input validation)
- Needs test: 4 (mint/server.ts — zero tests; mint/signer.ts — zero tests; lnd-client/rest-client.ts — zero tests; lnd-client/mock-client.ts — no dedicated tests)
- Dead code: 2 (block.ts satsPerGb field; file.ts try/catch around type assertion)
- Sprint 7b migration: 3 (no GET /cid/:hash, no free preview tier, no GET /served)

---

## Task 4: apps/cli + apps/node-agent + deploy/ + scripts/

### cli/commands/config-cmd.ts
Status: OK — reads/writes ~/.dupenet/config.json ✓
Test coverage: No CLI tests exist

### cli/commands/fetch.ts
Status: OK
Issues: Single-block + multi-block paths correct ✓. L402 auto-pay via LND ✓. Integrity verification ✓.
  Uses /asset/ and /block/, not /cid/ yet (Sprint 7b).
Test coverage: No CLI tests exist

### cli/commands/hosts.ts
Status: OK — GET /directory display ✓
Test coverage: No CLI tests exist

### cli/commands/info.ts
Status: OK — queries /asset/:cid, /bounty/:cid, /pricing ✓
Test coverage: No CLI tests exist

### cli/commands/keygen.ts
Status: OK — generates Ed25519 via physics, --force flag ✓
Test coverage: No CLI tests exist

### cli/commands/pin.ts
Status: OK — pin create/status/cancel with signed requests ✓
Test coverage: No CLI tests exist

### cli/commands/tip.ts
Status: OK | MIGRATION_7B
Issues:
  - Response parsing correct: accesses result.protocol_fee, displays as "founder_royalty" ✓
  - payment_proof stubbed as "0".repeat(64) — expected for dev
  - Will become `dupenet fund` (POST /event kind=FUND) in Sprint 7c
Test coverage: No CLI tests exist

### cli/commands/upload.ts
Status: OK | MIGRATION_7B
Issues:
  - Chunking flow correct: readFile → chunkFile → PUT /block → PUT /file → PUT /asset ✓
  - 409 treated as success (block exists) ✓
  - Missing: --access flag, --title/--description/--tags, POST kind=ANNOUNCE (Sprint 7c)
Test coverage: No CLI tests exist

### cli/index.ts
Status: OK — all 8 command groups wired ✓
Test coverage: No CLI tests exist

### cli/lib/config.ts
Status: OK — env var overrides, priority: env > file > defaults ✓
Test coverage: No CLI tests exist

### cli/lib/http.ts
Status: OK — thin fetch wrappers with L402 402 handling ✓
Test coverage: No CLI tests exist

### cli/lib/keys.ts
Status: OK — load/save Ed25519 keypairs, validates hex format ✓
Test coverage: No CLI tests exist

### cli/lib/mime.ts
Status: OK — extension→MIME map (30+ entries), kindFromMime ✓
Test coverage: No CLI tests exist

### node-agent/config.ts
Status: OK — env-based config with sensible defaults ✓

### node-agent/announce.ts
Status: OK | MIGRATION_7B
Issues:
  - Signed host registration (POST /host/register) ✓
  - Signed serve announcement (POST /host/serve) ✓
  - Does NOT publish min_bounty_sats in pricing (Sprint 7b)
  - Will migrate to EventV1 kind=HOST (Sprint 7b)

### node-agent/index.ts
Status: OK — config validation → announceHost → poll loop ✓. mirroredCids Set prevents re-mirroring ✓.

### node-agent/mirror.ts
Status: NEEDS_FIX
Issues:
  - SINGLE-BLOCK ONLY: mirrorCid() fetches GET /block/{cid} and PUTs to local gateway.
    Does NOT handle multi-block assets (no AssetRoot resolution, no FileManifest traversal,
    no block iteration). If bounty feed returns asset_root CIDs, agent stores only the
    asset root JSON, not file blocks. Multi-block content NOT replicated.
  - No integrity verification: mirrored blocks not hash-verified against CID.
  - Profitability filter itself correct ✓

### node-agent/test/poll-cycle.test.ts
Status: OK — 6 test cases covering mirror + profitability logic ✓

### deploy/Caddyfile.founder
Status: OK — reverse proxy :80, gateway + coordinator routes ✓

### deploy/Caddyfile.nodekit
Status: OK — gateway-only proxy (node operators use remote coordinator) ✓

### deploy/Caddyfile.production
Status: OK — HTTPS on ocdn.is via Let's Encrypt ✓

### deploy/compose-founder.yml
Status: OK — all 8 services: bitcoind, lnd, lnd-bob, gateway, mint, coordinator, postgres, caddy ✓
  LND regtest ✓. Health checks ✓. Volume mounts correct ✓.

### deploy/compose-nodekit.yml
Status: OK — gateway + agent + caddy ✓. Agent depends_on gateway healthy ✓.

### deploy/compose-production.yml
Status: OK — LND signet ✓. No bitcoind (signet public peers) ✓. restart: unless-stopped ✓.
  wallet-unlock-password-file ✓. P2P 9735 exposed ✓.

### scripts/gen-keys.sh
Status: OK — generates 4 keypairs (host + 3 mints), writes .env.local ✓

### scripts/backup.sh
Status: OK — Postgres dump + LND SCB + credentials. 14-day retention. Signet paths ✓.

### scripts/deploy.sh
Status: OK — one-shot VPS setup (Docker, Git, clone, keys, UFW) ✓

### scripts/e2e.sh
Status: OK — 8-step E2E: boot → fund → upload → L402 → tip → receipt → settle → verify ✓

### scripts/fund-lnd.sh
Status: OK — funds both nodes, opens 1M sat channel ✓

### Summary (cli + node-agent + deploy + scripts)
- Files reviewed: 29
- OK: 25
- Needs fix: 1 (node-agent/mirror.ts — single-block only; no hash verification; multi-block content not replicated)
- Needs test: 13 (entire apps/cli — zero test coverage)
- Dead code: 0
- Sprint 7b migration: 2 (node-agent/announce.ts → EventV1 kind=HOST; node-agent/mirror.ts → multi-block + min_bounty_sats)
- Sprint 7c migration: 2 (cli/tip.ts → `dupenet fund`; cli/upload.ts → --access + metadata flags)
- Cross-cutting: formatSize() duplicated in 3 CLI files; extFromMime() overlaps lib/mime.ts

---
---

# GLOBAL SUMMARY

```
Files reviewed:     104  (95 .ts + 6 deploy + 5 scripts + 1 prisma)
OK:                  82
Needs fix:            8
Needs test:          21
Dead code:            2
Sprint 7b migration: 10
Sprint 7c migration:  2
```

## NEEDS_FIX (8 — should fix before Sprint 7b)

1. packages/physics/schemas/directory.ts — missing regions[], refusals_cid from plan
2. packages/physics/test/merkle.test.ts — verifyMerkleProof never tested
3. apps/coordinator/views/host-registry.ts — INACTIVE→TRUSTED recovery missing (bug)
4. apps/gateway/l402/invoice-store.ts — cleanup() never called (memory leak)
5. apps/gateway/routes/block.ts — satsPerGb dead; flat pricing ignores block size
6. apps/gateway/routes/pricing.ts — PricingV1 response incomplete (4 fields missing)
7. apps/mint/server.ts — no input validation on POST /sign body
8. apps/node-agent/mirror.ts — single-block only; multi-block assets not replicated

## NEEDS_TEST (21 — prioritized)

Critical (crypto/security):
1. packages/physics/royalty.ts — no tests; negative input edge cases
2. packages/physics/receipt-challenge.ts — 8 crypto functions untested
3. apps/mint/server.ts — zero tests for HSM component
4. apps/mint/signer.ts — token construction + signing untested
5. packages/lnd-client/rest-client.ts — production LND client untested

Moderate:
6. apps/coordinator/event-log/writer.ts — BigInt round-trip untested
7. packages/physics/epoch.ts — epoch boundary math untested (low priority)
8. packages/lnd-client/mock-client.ts — no dedicated tests

Low (CLI — functional but no test infrastructure):
9-21. apps/cli (13 files) — entire CLI has zero tests

## DEAD CODE (2)

1. apps/gateway/routes/block.ts — satsPerGb field passed but never read
2. apps/gateway/routes/file.ts — try/catch around type assertion (can't throw)

## SPRINT 7b MIGRATION (10)

1. apps/coordinator/event-log/schemas.ts — event types → EventV1 kind bytes
2. apps/coordinator/server.ts — POST /tip, /host/register → POST /event shims
3. apps/coordinator/prisma/schema.prisma — BountyPool.cid→poolKey; Host fields; EpochSummary fields
4. apps/coordinator/views/host-registry.ts — Host model changes
5. packages/physics/schemas/directory.ts — add regions + refusals_cid
6. apps/gateway — add GET /cid/:hash unified endpoint
7. apps/gateway — add free preview tier (blocks ≤16 KiB)
8. apps/gateway — add GET /served endpoint
9. apps/node-agent/announce.ts — migrate to EventV1 kind=HOST + min_bounty_sats
10. apps/node-agent/mirror.ts — multi-block asset mirroring

## SPRINT 7c MIGRATION (2)

1. apps/cli/commands/tip.ts — rename to `dupenet fund`, POST /event kind=FUND
2. apps/cli/commands/upload.ts — add --access, --title/--tags, POST kind=ANNOUNCE
