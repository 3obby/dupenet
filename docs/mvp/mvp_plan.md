# Content Availability MVP

**Purpose**: Durable sovereign content via economic incentives. Paying attention mechanically increases availability.

**DocRef**: SPEC:§Content-Addressed, REQUIREMENTS:§Permissionless Infrastructure, RATIONALES:[d8m5p7]

---

## Core Thesis

1. **Spam is a pricing problem** - Mandatory minimum fees filter infinite spam
2. **Censorship is an availability market** - Replication funded by those who care
3. **Infrastructure is a commodity** - Hosts compete like gas stations, self-select profitable content
4. **Payment streams are separate** - Bounty pays for availability, egress pays for bandwidth. A fetch that generates a receipt counts toward both (explicit demand subsidy at cost, not accidental double-counting)
5. **Visibility is derived, not curated** - Three separate layers: Directory = host routing, Topic = content organization, Signals = visibility ranking. No layer controls another.

### Trust Assumptions (MVP)

- Founder operates default directory, aggregator, receipt mints, provisioning
- Receipts accepted from founder mints only
- Architecture permits replacement at every layer; MVP does not exercise that
- Goal is to prove market dynamics, not decentralization

### Platform Layers

The protocol serves two audiences. Layer A is infrastructure other platforms consume. Layer B is the first-party app that exercises the full worldview. They compose but must not be coupled.

**Layer A — Blob Utility (what other platforms buy)**
- Content-addressed blob store (AssetRoot / FileManifest / blocks)
- HTTP origin interface (`GET /asset`, `/file`, `/block`)
- L402 paid fetch + receipt minting
- Host economics: stake, egress pricing, epoch rewards
- Pin contracts (budgeted durability)
- Receipt verification SDK (standalone, zero dependencies)
- S3-compatible adapter (migration unlock)

**Layer A.1 — Discovery + Signals (bridge: makes Layer A content usable by humans)**
- Discovery events: signed announcements that reference CIDs with human metadata (title, description, preview)
- Asset lists: signed grouping events that collect CIDs into named collections
- Signal aggregation: host scorecards, content resilience scores, author profiles — all derived automatically from protocol events (receipts, spot-checks, tips), not from ratings
- Market quoting: host profitability thresholds enable client-side supply curve estimation
- Free preview tier: thumbnails/excerpts served without L402 to drive paid consumption
- Web content surface: landing pages that render content + instrument cluster + Fortify button

Layer A.1 does not require Layer B's social features (vine allocation, harmonic distribution, paid inbox). It sits on top of Layer A's raw blobs + economics and makes them accessible to humans and discoverable by peers. Every Layer A.1 artifact is a signed event referencing CIDs — the coordinator materializes a default view, but any peer can materialize the same state from the event stream.

**Layer B — First-Party App (exercises full worldview, see `post_mvp.md`)**
- Vine model + harmonic allocation
- Topic hashes + plural discovery
- Signal classes + instrument cluster
- Paid inbox
- Nostr social integration
- Resilience score UI

External adopters use Layer A as replaceable infrastructure. They store `asset_root` pointers, outsource distribution, and never touch Layer A.1 or B. The first-party app uses all three.

**Constraint**: other platforms adopt Layer A only if they can treat it as commodity infrastructure, get boring HTTP tooling + SDKs, and are not required to join the discovery/social layer.

---

## Entity Model

### Layers (Layer A)

- **Content**: CID → AssetRoot? → FileManifest → Blocks; BountyPool
- **Operator**: Host (stakes, serves CIDs) → Receipt (client proof) → EpochSummary
- **User**: pubkey identity (no account object in Layer A)
- **Routing**: Directory → HostList (routing only)

### Core Entities

| Entity | Identity | Mutable State | Layer |
|--------|----------|---------------|-------|
| **CID** | SHA256(content) | None | A |
| **BountyPool** | CID | `balance: u64` | A |
| **Host** | pubkey | `status`, `stake`, `served_cids[]` | A |
| **Receipt** | hash(content) | None (immutable) | A |
| **Refusal** | hash(content) | None (immutable) | A |
| **AssetRoot** | SHA256(canonical(AssetRootV1)) | None | A |
| **FileManifest** | SHA256(canonical(FileManifestV1)) | None | A |
| **Directory** | pubkey | `hosts[]`, `timestamp` | A |
| **PinContract** | hash | `status`, `budget_sats`, `drain_rate` | A |
| **ContentAnnounce** | SHA256(canonical(ContentAnnounceV1)) | None (immutable) | A.1 |
| **AssetList** | SHA256(canonical(AssetListV1)) | None (immutable) | A.1 |

### Entity Schemas

```
CID {
  hash: bytes32           # SHA256 of content (small blobs) or asset_root_cid (multimedia)
}

FileManifestV1 {
  chunk_size: u32         # default 262144 (256KiB)
  size: u64               # total file size in bytes
  blocks: [bytes32]       # ordered BlockCIDs = SHA256(block_bytes)
  merkle_root: bytes32    # SHA256(canonical(ordered block CIDs))
  mime: string?
}

FileRefV1 {
  file_root: bytes32      # SHA256(canonical(FileManifestV1))
  size: u64
  mime: string?
}

VariantRefV1 {
  label: string           # e.g. "720p", "thumb_200", "webp"
  file: FileRefV1
}

MetaV1 {
  width: u32?
  height: u32?
  duration_ms: u64?
  codec: string?
  sha256_original: bytes32  # hash of pre-processing original bytes
}

AssetRootV1 {
  kind: enum              # TEXT | IMAGE | AUDIO | VIDEO | FILE
  original: FileRefV1
  variants: [VariantRefV1]  # optional: resized/transcoded
  poster: FileRefV1?      # video poster frame
  thumbs: [FileRefV1]?    # image/video thumbnails
  meta: MetaV1
}
# asset_root_cid = SHA256(canonical(AssetRootV1))
# Tips/bounties attach to asset_root_cid

BountyPool {
  cid: bytes32            # FK → CID
  balance: u64            # sats available
  last_payout_epoch: u32  # track draining
}

Host {
  pubkey: bytes32         # operator identity
  endpoint: string        # URL or null (archive mode)
  stake: u64              # locked sats
  status: enum            # PENDING | TRUSTED | DEGRADED | UNBONDING
  unbond_epoch: u32?      # when unbonding started
  pricing: PricingV1      # egress rates
  regions: [string]       # optional geo hints
  accepted_types: [string]?  # MIME prefixes e.g. ["text/*", "image/*"]
}

HostServe {
  host: bytes32           # FK → Host.pubkey
  cid: bytes32            # FK → CID
  registered_epoch: u32   # when announced
}

ReceiptChallenge {
  # Forced ordering: pay → receive receipt_token → fetch → hash → PoW → submit
  # Cannot precompute (needs payment_hash + receipt_token from mint)
  # Cannot reuse (epoch-bound)
  # Cannot fake (needs response_hash from actual bytes)
  # Cannot forge token (mint signature required)
}

ReceiptMint {
  # L402 gate mints bearer proofs on payment settlement
  # Token binds: host, epoch, block, response, price, payment
  #
  # token = Sign_mint_sk(canonical("R2" || host_pubkey || epoch || block_cid || response_hash || price_sats || payment_hash))
  #
  # MVP: 2-3 independent mints, each with own Ed25519 keypair.
  #       Clients accept any mint from their configured set.
  #       Even 2-3 keys you control independently beats 1 key.
  #
  # Verification is permissionless: anyone with mint_pk can verify O(1)
}

EpochSummary {
  epoch: u32
  host: bytes32
  cid: bytes32
  receipt_merkle_root: bytes32  # merkle of valid ReceiptV2s
  receipt_count: u16
  unique_clients: u16
}

ReceiptV2 {
  asset_root: bytes32?        # preferred for ranking/bounties
  file_root: bytes32
  block_cid: bytes32          # SHA256(block_bytes)
  host_pubkey: bytes32
  payment_hash: bytes32       # L402 invoice payment hash
  response_hash: bytes32      # SHA256(returned block bytes)
  price_sats: u64             # sats paid for this fetch
  receipt_token: bytes        # bearer proof from receipt mint (proves payment settled)
  epoch: u32
  nonce: u64
  pow_hash: bytes32           # H(challenge || nonce) < TARGET
  client_pubkey: bytes32
  client_sig: sig
}

# receipt_token = Sign_mint_sk(canonical("R2" || host_pubkey || epoch || block_cid || response_hash || price_sats || payment_hash))
# Verify: Ed25519_verify(mint_pk, token_payload, mint_sig) — O(1), no LN state lookup
#
# MVP: 2-3 independent mints (founder-operated, separate keypairs)
#       clients accept any mint from their configured set
#
# challenge = H("RECEIPT_V2" || asset_root? || file_root || block_cid || host || payment_hash || response_hash || epoch || client_pubkey)
# valid if: pow_hash = H(challenge || nonce) < TARGET(client_pubkey, epoch, receipt_count)

Tip {
  from: bytes32           # payer pubkey
  target: bytes32         # asset_root_cid (preferred) or raw CID
  amount: u64             # total sats
  timestamp: u64
  payment_proof: bytes32  # Lightning payment hash
}

RefusalV1 {
  operator: bytes32       # host pubkey
  target: bytes32         # CID or Bundle id
  reason: enum            # ILLEGAL | MALWARE | DOXXING | PERSONAL | COST | OTHER
  scope: enum             # EXACT | BUNDLE_DESCENDANTS
  timestamp: u64
  sig: signature
}

PinContractV1 {
  id: hash                    # SHA256(canonical(this))
  client: pubkey              # platform/user requesting durability
  asset_root: bytes32         # what to keep alive
  min_copies: u8              # minimum independent hosts
  regions: [string]?          # optional geo diversity requirements
  duration_epochs: u32        # how long to sustain
  budget_sats: u64            # total sats allocated
  drain_rate: u64             # max sats/epoch (derived from budget/duration)
  status: enum                # ACTIVE | EXHAUSTED | CANCELLED
  created_epoch: u32
  sig: signature              # client signs commitment
}
# Wrapper around bounty pools with explicit SLA constraints.
# Budget tops up bounty[asset_root]; drain_rate caps epoch payout.
# Periodic proof = EpochSummary (already exists) filtered to pinned asset_root.
# Platforms treat this as "pay for durability" without understanding vine/harmonic internals.

ContentAnnounceV1 {
  version: u8               # schema version
  cid: bytes32              # asset_root CID this announcement describes
  from: bytes32             # uploader/announcer pubkey
  title: string             # human-readable name
  description: string?      # 1-3 sentence summary
  mime: string              # from AssetRootV1 (duplicated for discovery without blob fetch)
  size: u64                 # total bytes (duplicated for same reason)
  language: string?         # ISO 639-1 (e.g. "en", "ja")
  tags: [string]?           # free-form tags for filtering
  created: u64?             # content creation timestamp (distinct from announcement time)
  source_url: string?       # provenance: where content originally lived
  author_name: string?      # human-readable attribution (not necessarily the announcer)
  preview: PreviewV1?       # inline preview (thumbnail or excerpt)
  thumb_cid: bytes32?       # optional higher-res thumbnail as a fetchable blob
  timestamp: u64            # announcement time
  sig: signature            # announcer signs canonical(content fields)
}
# announce_id = SHA256(canonical(ContentAnnounceV1 minus sig))
# Anyone can announce metadata for any CID. Multiple announcements per CID allowed.
# Quality of metadata is a service — better metadata drives more consumption.

PreviewV1 {
  type: string              # "image/jpeg" | "text/plain"
  data: string              # base64-encoded thumbnail or text excerpt
}
# Max inline preview: PREVIEW_MAX_BYTES (16 KiB)
# Images: JPEG thumbnail, 200px wide
# Text/PDF: first 500 characters

AssetListV1 {
  version: u8               # schema version
  from: bytes32             # curator/uploader pubkey
  title: string             # collection name
  description: string?      # collection summary
  items: [AssetListItemV1]  # ordered list of constituent assets
  language: string?         # primary language
  tags: [string]?           # collection-level tags
  timestamp: u64
  sig: signature
}
# list_cid = SHA256(canonical(AssetListV1 minus sig))
# Collections are signed assertions, not protocol entities.
# Anyone can create a list referencing any CIDs.
# Multiple lists can reference the same CIDs with different curation.

AssetListItemV1 {
  cid: bytes32              # asset_root CID
  name: string              # human-readable item name (e.g. filename)
  mime: string?             # content type
  size: u64?                # bytes
}
```

### Entity Relationships

| Relationship | Cardinality | Constraint |
|--------------|-------------|------------|
| CID → BountyPool | 1:1 | Created on first tip or pin |
| Host → HostServe | 1:N | Host chooses which CIDs |
| HostServe → CID | N:1 | Multiple hosts per CID |
| Receipt → Host | N:1 | Clients prove host served |
| Receipt → FileManifest | N:1 | Receipts bind to file_root + block_cid |
| AssetRoot → FileManifest | 1:N | Original + variants |
| CID → AssetRoot | 1:1 | Multimedia content (optional) |
| User → Tip | 1:N | Payment history |
| PinContract → CID | N:1 | Pin targets an asset_root (CID) |
| PinContract → BountyPool | N:1 | Budget feeds bounty pool; drain_rate caps epoch payout |
| ContentAnnounce → CID | N:1 | Multiple announcements per CID (different metadata sources) |
| AssetList → CID | N:N | List groups CIDs; CIDs appear in multiple lists |
| AssetList → ContentAnnounce | 1:N | List items may have corresponding announcements |

### Interface Boundaries

- **Client**: Submit tips/pins, fetch content, mint receipts
- **Protocol**: Enforce bounty ledger, stake custody, slash rules, epoch summary
- **Operator**: Provide storage, egress, uptime

Flow: Client tips/pins → Protocol credits bounty → Operator claims via receipts → Protocol rewards

Casual readers pay L402 only (hosts earn egress). Receipt minting serves bounty drainage, not individual fetches. Vine allocation and harmonic distribution are Layer B (see `post_mvp.md`).

### Interface: Client → Protocol

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `tip` | `(cid, amount, payment_proof)` | `TipReceiptV1` | Funds bounty pool for target CID. Layer B adds harmonic vine allocation (see `post_mvp.md`) |
| `query_bounty` | `(cid)` | `u64` | None |
| `query_resilience` | `(cid)` | `ResilienceScore` | None |
| `pin` | `PinContractV1` | `PinContractAck` | Budget allocated to bounty pool; drain_rate set |
| `pin_status` | `(pin_id)` | `PinStatusV1` | None |
| `pin_cancel` | `(pin_id, sig)` | `ack` | Remaining budget returned; status → CANCELLED |

### Interface: Protocol → Operator

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `register_host` | `HostServeV1` | `ack` | Stake locked, status=PENDING |
| `submit_receipts` | `[ReceiptV2]` | `ack` | Receipts validated, counted |
| `claim_reward` | `(host, cid, epoch)` | `u64` | Bounty debited if receipt threshold met; 3% aggregator fee deducted |
| `submit_audit` | `AuditChallengeV1` | `result` | Host score updated on mismatch |
| `unbond` | `UnbondV1` | `ack` | 7-day timer starts |
| `withdraw` | `(host)` | `u64` | Stake returned |

### Interface: Client → Operator (Direct)

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `GET /cid/{hash}` | None | `bytes` (small blob) or redirect | Egress charged |
| `GET /asset/{asset_root}` | None | `AssetRootV1` | None |
| `GET /file/{file_root}` | None | `FileManifestV1` | None |
| `GET /block/{block_cid}` | None | `bytes` | Egress charged (min_request_sats) |
| `PUT /block/{block_cid}` | `bytes` | `ack` | Block stored (verified) |
| `PUT /file/{file_root}` | `FileManifestV1` | `ack` | Manifest stored |
| `PUT /asset/{asset_root}` | `AssetRootV1` | `ack` | Asset registered |
| `GET /pricing` | None | `PricingV1` | None |
| `GET /served` | None | `[cid]` | None |

### S3-Compatible Adapter (Layer A — Migration Unlock)

Thin shim over the file layer. Lets existing apps switch storage with a config change.

| S3 Operation | Maps To | Notes |
|-------------|---------|-------|
| `PUT object` | Client-side chunk → `PUT /block` × N → `PUT /file` → `PUT /asset` | Adapter handles chunking + manifest construction |
| `GET object` | Resolve `GET /asset` → `GET /file` → stream `GET /block` × N | Transparent reassembly |
| `HEAD object` | `HEAD /asset/{root}` | Returns size, MIME, pricing hints |
| `DELETE object` | No-op or SupersedesV1 | Content-addressed = no true delete; adapter returns 204 |

Scope: single-tenant adapter (runs alongside app, speaks S3 protocol, translates to blob layer). Not a hosted multi-tenant service.

User → User messaging (paid inbox) is Layer B. See `post_mvp.md`.

---

## File Layer (Chunked Content)

### Canonicalization

Manifests and asset roots MUST be canonical-serialized (stable field order, no floats, deterministic encoding) before hashing to produce file_root / asset_root_cid.

### Upload / Ingestion

Client-side chunking. Client computes all CIDs locally, pushes to host(s):

```
1. Chunk file → CHUNK_SIZE_DEFAULT blocks
2. block_cid = SHA256(block_bytes) per block
3. Build FileManifestV1 → file_root = SHA256(canonical(manifest))
4. Generate variants (images: client-side resize; video: paid transcoding service)
5. Build AssetRootV1 → asset_root = SHA256(canonical(asset_root))
6. Push: PUT /block/{cid}, PUT /file/{root}, PUT /asset/{root}
```

Host verifies block hashes on receive. All blocks present before manifest accepted.

### Variant Policy

- Images: client-generated (resize is cheap)
- Video: paid transcoding service (client pays sats, receives variant FileRefs)
- Variants immutable once AssetRoot published. Hosts MUST NOT re-encode.

### Metadata

Strip EXIF/metadata before hashing by default. `original` in AssetRoot = cleaned version. Optional `raw` variant for archival.

### Private Media

Chunk-then-encrypt: each block independently decryptable, enables streaming decryption.

```
enc_block = encrypt(key, nonce || block_index, block_bytes)
block_cid = SHA256(enc_block)
```

Keys shared via paid inbox / WoT.

---

## Durability Ladder

| Level | Mechanism | Cost | Durability |
|-------|-----------|------|------------|
| 0 | Origin only | Free | Ephemeral |
| 1 | Nostr relays | Free | Days-weeks |
| 2 | Bundled (INDEX_ROOT anchored) | Base fee | Depends on mirror economics |
| 3 | Bounty-sustained | Tips flowing | Active replication market |
| 4 | Gold Tag (Bitcoin inscription) | ~$10-50 | Permanent |

Most content lives at levels 1-3. Gold Tags reserved for civilizational-collapse durability.

---

## Fee Model

### Layer 1: Base Fee (Spam Defense + Infrastructure)

```
BASE_FEE = 21-210 sats (dynamic, EIP-1559 style)
Floor: 21 sats (spam defense: infinite spam costs infinite sats, trivial for humans)
Cap: 210 sats (peak demand)
100% to bundler/anchorer (compensates real infrastructure work)
```

No burn. At protocol scale, burned sats are economically inert against BTC supply. Pay the entity doing the work.

### Layer 2: Tips

Tips fund bounty pools for specific CIDs. In Layer A, tips go directly to the target CID's bounty pool. Layer B adds harmonic vine allocation across content hierarchies (see `post_mvp.md`).

```
TIP_PROTOCOL_FEE = 5%   # to protocol operator
TIP_BOUNTY_SHARE = 95%  # to bounty pool(s)
```

5% is below industry standard (Stripe 2.9%+30¢, Patreon 5-12%, App Store 30%).

### Layer 3: Earnings

```
Creators: Host their own content, earn like any host (first-mover advantage)
Hosts: epoch_reward (2% of bounty, capped 50 sats/epoch) + egress (host-configurable)
AGGREGATOR_FEE = 3% of bounty payouts (receipt validation, fraud detection, payout authorization)
```

### Protocol Fee Decay

All protocol-level fees (BASE_FEE bundler share, TIP_PROTOCOL_FEE, AGGREGATOR_FEE, provisioning surcharge) halve every 4 years. Sunset at year 20. Verifiable in code.

```
PROTOCOL_FEE_HALVING = 4 years
PROTOCOL_FEE_SUNSET  = 20 years

Year  0-4:   100%   (bootstrap: founder builds everything)
Year  4-8:    50%
Year  8-12:   25%
Year 12-16:  12.5%
Year 16-20:   6.25%
Year 20+:     0%    (protocol becomes public good)
```

Front-loads revenue during bootstrap when founder's work is most critical. Converges to zero, preventing permanent rent extraction.

---

## Bounty Pool Mechanics

### Accumulation

Tips and pin contract budgets fund bounty pools per CID. In Layer A, tips go to target CID directly. Layer B adds harmonic vine allocation across content hierarchies (see `post_mvp.md`).

### Release

Hosts claim by proving they serve the content (per epoch):

1. Host registers: `HostServeV1 { host_pubkey, cid, endpoint, stake }`
2. Clients fetch via L402, optionally mint PoW receipts
3. If ≥ 5 receipts from ≥ 3 unique clients in epoch: host earns `epoch_reward`
4. Ongoing: host earns egress fees per request (host-configured pricing)

### Equilibrium

| Bounty Pool | Expected Copies | Economics |
|-------------|-----------------|-----------|
| 0-20 sats | 0-1 | Below viable |
| 21-100 sats | 1-2 | Hobby hosts |
| 100-500 sats | 3-5 | Small operators |
| 500-2000 sats | 5-10 | Professional hosts |
| 2000+ sats | 10+ | Commodity race |

Step-function durability emerges from host economics, not protocol rules.

---

---

## Protocol Enforcement

### Division of Responsibility

| Layer | Responsibility | Enforced By |
|-------|---------------|-------------|
| **Client** | Vine logic, allocation computation | User wallet |
| **Protocol** | Bounty accounting, payout rules | Consensus |
| **Operator** | Serve CIDs, maintain uptime | Earning decay (availability), slashing (fraud only) |

Operators see bounties per CID. They don't know/care about parent-child relationships.

### Operator Rules (MUST)

```
1. STAKE before registering (2,100 sats minimum)
2. SERVE correct bytes (hash(response) == cid)
3. UNBOND cleanly (7-day wait to withdraw stake)
```

### Operator Rules (MAY)

```
1. CHOOSE which CIDs to serve
2. SET own egress pricing
3. LEAVE at any time (after unbonding)
4. SERVE from anywhere (public or archive mode)
5. REGISTER multiple endpoints per CID (failover)
```

### Receipt Rules

Receipts must bind:

```
RECEIPT_BINDING = asset_root? || file_root || block_cid || host || payment_hash || response_hash || epoch || client
POW_TARGET_BASE = 2^240  # ~200ms on mobile
DIFFICULTY_ESCALATION = log2(receipt_count + 1)
```

Ordering forced: pay → fetch → hash → PoW → submit. Cannot shortcut.

### Enforcement: Slashing vs Earning Decay

**Principle**: Slash only for cryptographic lies (provably wrong bytes, forged claims). Never slash for availability — availability failures may be caused by DDoS, network partitions, or targeted griefing of competitors. Punishing downtime with stake loss creates a DoS-to-slash attack vector.

For availability, use earning decay: score drops, payout ineligibility, status demotion. The host loses income, not capital. Recovery is automatic when service resumes.

#### Slashable Offenses (Fraud — Cryptographic Proof Required)

| Offense | Slash | Proof |
|---------|-------|-------|
| Data corruption (response hash != CID) | 100% | AuditChallengeV1 with mismatched hashes |
| Forged receipt_token | 100% | Invalid mint signature on submitted receipt |
| Forged HostServeV1 (claiming CIDs not stored) | 50% | Audit fetch returns no data for registered CID |

Each requires a cryptographic proof that a neutral verifier can check. No human judgment. No reputation-based accusations.

#### Earning Decay (Availability — Score-Based)

| Condition | Effect | Recovery |
|-----------|--------|----------|
| Spot-check timeout (30s) | Score penalty: -0.2 per miss | Score recovers on next pass |
| 3+ consecutive misses | Status → DEGRADED (payout ineligible) | Pass 3/5 checks → TRUSTED again |
| Unreachable 24h+ | Status → INACTIVE (delisted from directory) | Resume serving → re-enter as PENDING |
| Low receipt volume (< threshold) | No epoch reward (natural) | Earn more receipts |

Degraded/inactive hosts keep their stake. They just stop earning until they recover. A DDoS attacker can suppress a competitor's income temporarily but cannot destroy their capital.

#### Availability Score

```
availability_score(host, epoch) =
  successful_checks / total_checks    # rolling window: last 6 epochs (24h)

TRUSTED threshold:   score >= 0.6     # 3/5 checks
DEGRADED threshold:  score < 0.6
INACTIVE threshold:  score == 0.0 for 6 consecutive epochs
```

### Enforcement Triggers

| Event | Action |
|-------|--------|
| HostServeV1 submitted | Lock stake, status = PENDING |
| Availability score >= 0.6 | Status → TRUSTED, payout eligible |
| Availability score < 0.6 | Status → DEGRADED, payout ineligible |
| Score == 0.0 for 6 epochs | Status → INACTIVE, delisted |
| AuditChallengeV1 (hash mismatch) | **Slash** stake; AUDIT_REWARD_PCT to challenger |
| Forged receipt/claim proven | **Slash** stake |
| UnbondV1 | Start 7-day timer |

---

## Node Operator Model

### Modes

| Mode | Earns | Requirements |
|------|-------|--------------|
| **Public Gateway** | Full (egress + epoch reward) | Publicly reachable endpoint |
| **Archive Only** | Reduced (epoch reward only) | Behind NAT, challenge-response verification |

Archive mode enables participation without port forwarding. Simplest onboarding path.

### Staking

```
OPERATOR_STAKE = 2,100 sats (refundable)
UNBONDING_PERIOD = 7 days
```

**Why stake?**
- Sybil resistance: 1000 fake nodes costs ~$1500
- Fraud accountability: serving wrong bytes loses stake
- Commitment signal: filters short-term opportunists

Stake is only at risk for cryptographic fraud (see Enforcement above). Availability issues affect earnings, not capital.

### Lifecycle

```
Deposit stake → PENDING
Availability score >= 0.6 → TRUSTED (earning)
Availability score < 0.6 → DEGRADED (not earning, stake safe)
Score == 0.0 for 24h → INACTIVE (delisted, stake safe)
Proven fraud → SLASHED (stake lost)
Request exit → UNBONDING (7 days)
Complete unbonding → stake returned
```

Multi-endpoint failover is allowed and encouraged: a host MAY register multiple endpoints for the same CID. Directory lists all endpoints; clients failover naturally.

---

## Operator Content Policy

Operators choose what to serve. No governance, no global moderation—just local policy.

### Refusal (Not Slashable, Not Penalized)

Operators can refuse CIDs without any penalty. Slash only for cryptographic fraud:
- Serving wrong bytes (hash mismatch proven by audit)
- Forging receipts or claims

Refusal = "I didn't register HostServe for that CID." That's allowed. Unavailability = earning decay, not slashing.

### RefusalV1 (Explicit + Auditable)

```
RefusalV1 {
  operator: pubkey
  target: bytes32           # CID or Bundle id
  reason: enum              # ILLEGAL | MALWARE | DOXXING | PERSONAL | COST | OTHER
  scope: enum               # EXACT | BUNDLE_DESCENDANTS
  timestamp: u64
  sig: signature
}
```

Machine-readable service declaration. Not censorship—operators publish what they won't serve.

### Policy Layers

| Layer | Mechanism |
|-------|-----------|
| Exact CID | Denylist specific hashes |
| Bundle | Deny entire bundle roots |
| Attester-driven | "Refuse anything X attests as MALWARE/CSAM" |

Operators don't interpret content—they apply policy over hashes + attestations.

### Attestation-Driven Quarantine (Optional)

Operators subscribe to attesters they trust:

```
follow attesters A, B, C
auto-deny if: claim ∈ {MALWARE, CSAM, DOXXED_PII} AND confidence >= 80 AND attesters >= 2
```

No global truth. Local follow list, applied locally.

### Discovery Integration

- Directory includes optional `refusals[]` or link to operator's refusal feed
- Client filters host candidates by refusal match before fetching
- If all hosts refuse: show "not served" + "offer bounty to attract hosts who will"

Availability market preserved: content lives if someone will serve it.

### Encrypted Blobs (Plausible Deniability)

Hosts can serve without knowing content:
- Store blobs encrypted client-side
- CID = hash(ciphertext)
- Keys shared via paid inbox / WoT

Operators deny based on metadata (attestations, bundles, known bad CIDs), not inspection.

### Operator UX (Node Kit)

```
Toggle sets: [Block malware] [Block doxxing] [Block illegal] [Block unknown]
Attester follow list (importable presets)
Manual deny CID paste
Export/import policy JSON
```

---

## Egress Pricing (Market Decides)

Hosts set their own prices. Three knobs, everything else derived.

### Price Model

```
PricingV1 {
  min_request_sats: u64    # floor per request (grief resistance)
  sats_per_gb: u64         # normal bandwidth rate
  burst_sats_per_gb: u64   # surge price when busy (optional)
  min_bounty_sats: u64?    # profitability threshold: min bounty pool to mirror a CID (optional)
}
# min_bounty_sats enables market-based quoting: clients sample host thresholds
# to estimate how many copies a given bounty level will attract.
```

### Charge Formula

```
cost(bytes, busy) =
  let gb = bytes / 1e9
  let rate = busy ? burst_sats_per_gb : sats_per_gb
  max(min_request_sats, ceil(rate * gb))
```

### Defaults

| Knob | Default | Rationale |
|------|---------|-----------|
| min_request_sats | 3 | Anti-grief floor: covers marginal serving cost at $100K/BTC |
| sats_per_gb | 500 | Sustainable margins for small operators ($0.05/GB vs AWS $0.09/GB) |
| burst_sats_per_gb | 2000 | 4× surge for load shedding |

### What 500 sats/GB Means

| Size | Cost |
|------|------|
| 1 MB | ~3 sats (min_request dominates) |
| 10 MB | ~5 sats |
| 100 MB | ~50 sats |
| 1 GB | ~500 sats |

The `min_request_sats` is the real anti-abuse lever. Each block fetch costs at least 3 sats.

### Free Preview Tier

Thumbnails and small blobs bypass L402 to drive consumption of paid content.

```
FREE_PREVIEW_MAX_BYTES = 16384   # 16 KiB — covers thumbnails, text excerpts
```

Two mechanisms (host chooses):
1. **Thumbnail CIDs**: blocks referenced by `AssetRoot.thumbs[]` served free (host opts in)
2. **Size threshold**: any `GET /block/{cid}` where `block_size ≤ FREE_PREVIEW_MAX_BYTES` served free

Rationale: a 10 KiB JPEG thumbnail costs negligible bandwidth but 6× increases the probability of a paid fetch of the full content. Free previews are loss leaders that drive the L402 revenue loop. Hosts who don't want to serve free previews simply don't opt in — pricing is local.

### Client Behavior (SHOULD)

```
1. Query cheapest host meeting minimum resilience score
2. Show "estimated cost" before fetching large blobs
3. Failover to next cheapest on timeout
4. Optionally "pin" a preferred host
```

Creates real competition without protocol governance.

---

## Epoch-Based Rewards

Replace one-time `copy_bonus` with continuous stream. Receipt-based, not committee-based.

### Epoch Structure

```
EPOCH_LENGTH = 4h
```

Shorter epochs = faster host payouts, better cash flow for small operators. 6 payout cycles/day.

Host earns for a CID in an epoch if it has sufficient paid receipts:

```
PAYOUT_ELIGIBLE(host, cid, epoch) if:
  receipt_count >= 5          AND
  unique_client_pubkeys >= 3  AND
  each receipt includes valid payment_hash
```

Receipt token (bearer proof from mint) is the gate. PoW receipts are anti-sybil plumbing.

The 5/3 threshold is a phase boundary: below it, content is self-hosted (creator earns egress only). Above it, content enters the replication market. Long-tail content doesn't need bounty payouts — it degrades gracefully by design.

### Reward Formula

Per-CID per-epoch cap scales logarithmically with bounty, then splits among eligible hosts by score.

**Design intent**: Large bounties act as endowments — they sustain replication over long timescales rather than draining fast. The log-scaled cap is the release valve: bigger bounties do attract more replication, but sublinearly. A 100x bounty produces ~2x the per-epoch incentive, not 100x. This prevents whale-funded CIDs from monopolizing host attention while still rewarding larger pools more than small ones.

```
EPOCH_REWARD_BASE = 50 sats

cid_epoch_cap = min(bounty[cid] * EPOCH_REWARD_PCT,
                    EPOCH_REWARD_BASE * (1 + floor(log2(bounty[cid] / EPOCH_REWARD_BASE + 1))))

score(host) = W_CLIENTS * unique_clients
            + W_UPTIME  * uptime
            + W_DIVERSITY * diversity

host_share = cid_epoch_cap * score(host) / Σ score(eligible_hosts)
```

- Cap scales with `log2(bounty)` — bigger pools drain faster, but sublinearly
- Total drain rate per CID is fixed regardless of replica count
- More replicas = more competition for the same cap, not faster depletion
- Tiny bounty → tiny cap (self-limiting)
- Massive bounty → endowment with slow sustained drain, not a gold rush

### Example

| Bounty Pool | Cap/Epoch | 1 Host | 5 Hosts | 10 Hosts |
|-------------|-----------|--------|---------|----------|
| 100 sats | 2 sats | 2 sats | ~0.4 each | ~0.2 each |
| 500 sats | 10 sats | 10 sats | ~2 each | ~1 each |
| 2,500 sats | 50 sats | 50 sats | ~10 each | ~5 each |
| 10,000 sats | 100 sats | 100 sats | ~20 each | ~10 each |
| 100,000 sats | 150 sats | 150 sats | ~30 each | ~15 each |
| 1,000,000 sats | 200 sats | 200 sats | ~40 each | ~20 each |

More hosts = same drain rate, split thinner. Log-scaled cap means large endowments sustain replication for years, not days. High-bounty content attracts replicas; economics self-balance.

---

## Verification (Receipt-Based + Auditable)

Receipts replace committee spot-checks. Bearer proof (receipt_token from mint) is primary filter, PoW is rate-limiter. No LN state lookup required for verification.

### Receipt Mint (L402 Gate)

The receipt mint is the L402 gate that confirms payment and issues bearer proofs.

```
MVP:   2-3 independent mints (founder-operated, separate Ed25519 keypairs).
        Clients configure which mint set they accept (follow list, like directories).
        Aggregators accept receipts from any recognized mint.
        Even 2-3 mints you control independently is better than 1 key.
```

Mint issues `receipt_token` only after LN payment settles. Token binds host, epoch, block, response hash, price, and payment hash. Anyone with the mint's public key can verify the token in O(1). The mint never needs to be consulted after issuance.

Mint misbehavior (issuing tokens without payment, issuing for wrong amounts) is detectable: compare token volume against LN payment flow. Competing mints audit each other — same incentive structure as competing hosts.

### Receipt Validation (O(1), Permissionless)

```
1. Verify client_sig over receipt
2. Verify pow_hash = H(challenge || nonce) < TARGET
3. Verify receipt_token against mint public key (Ed25519_verify — no LN state lookup)
4. Verify response_hash (optional: challenger can audit)
```

No step requires LN node access. Receipt verification is fully self-contained: signature checks + hash checks. Anyone can verify.

### Receipt Verification SDK (Layer A — Portable Primitive)

Standalone library, zero protocol dependencies. One function:

```
VerifyReceiptV2(receipt: ReceiptV2, mint_pubkey_set: [pubkey]) → { valid: bool, error?: string }
```

Checks: client_sig, pow_hash < target, receipt_token against any mint in set (Ed25519_verify). No LN state, no network calls, no protocol context. Other platforms import this single function to treat receipts as portable demand attestations — rank content, gate access, reward creators, prove paid consumption cross-platform.

### Difficulty Schedule

Per client pubkey, per host, per day:

| Receipts | Difficulty | Mobile time |
|----------|------------|-------------|
| 1-8 | 1× | ≤200ms |
| 9-16 | 2× | ~400ms |
| 17-32 | 4× | ~800ms |
| 33+ | 8×+ | exponential |

Human browsing stays smooth. Farms get compute-bound.

### Optional Audits

Anyone can challenge a host's receipts. No stake required.

```
AuditChallengeV1 {
  challenger: pubkey
  host: bytes32
  file_root: bytes32
  block_cid: bytes32
  claimed_response_hash: bytes32
  actual_response_hash: bytes32   # from challenger's fetch
  timestamp: u64
  sig: signature
}
```

If mismatch: host loses epoch reward for window. Challenger earns `AUDIT_REWARD_PCT` of withheld amount; remainder stays in pool.

L402 cost to fetch gates spam audits (audit cost > 0, reward only on proven fraud). Content correctness is checked, not availability — DDoS doesn't create false positives. Audit density scales with bounty size (bigger epoch rewards → bigger audit rewards → more auditors). "Audit mining" (never serve, only audit) is a valid role — if hosts are honest, auditors spend L402 fees and earn nothing.

---

## Receipt-Based Payouts (Replaces Committees)

Clients prove consumption. No trusted verifiers needed.

### Why Receipts Work

| Attack | Defense |
|--------|---------|
| Fake demand (sybil clients) | Each receipt costs L402 payment + PoW compute |
| Wash trading (host pays self) | Still costs real sats + compute = demand subsidy |
| Precompute receipts | payment_hash unknown until invoice issued; receipt_token unknown until mint signs |
| Replay receipts | epoch-bound, single use |
| Fake bytes served | response_hash must match actual content |
| Forge receipt_token | Requires mint private key (Ed25519); detectable via payment flow auditing |
| Collude with mint | MVP risk (founder-operated); mitigated by 2-3 independent mints |

### Block Selection (Anti-Special-Casing)

```
block_index = PRF(epoch_seed || file_root || client_pubkey) mod num_blocks
block_cid = manifest.blocks[block_index]
```

Host can't predict which block client will request. Must store all blocks.

### Fetch Flow

```
1. Client resolves: GET /asset/{root} → AssetRootV1 (or GET /cid/{hash} for small blobs)
2. Client fetches manifest: GET /file/{file_root} → FileManifestV1
3. Client requests block: GET /block/{block_cid} (L402 gated)
4. Client pays L402 invoice
5. L402 gate confirms settlement, mints receipt_token t, returns t with block bytes
6. Client verifies: SHA256(bytes) == block_cid
7. Client optionally mints PoW receipt (includes t as bearer proof)
```

Normal browsing stays smooth. Receipt minting is opt-in. The receipt_token makes each receipt permissionlessly verifiable without LN state access. Small text blobs still served via `GET /cid/{hash}`.

### Host Self-Farming

Hosts can pay themselves + compute. That's explicit demand subsidy, not free.

For ranking, weight receipts by:
- Client pubkey age (accumulated history)
- Distinct clients (not just distinct pubkeys)
- Interaction graph breadth (real users touch many CIDs/hosts; puppet clients are narrow)

Wash trading is self-limiting: profitable only when bounty is high AND real demand is absent — a narrow, unstable band. At scale, self-farming is demand subsidy at cost.

---

## Node Kit (Target: Raspberry Pi)

### Components

```
docker-compose.yml
├── gateway      # HTTP server: GET /cid/{hash}
├── agent        # Watch bounties, mirror content, announce
├── caddy        # HTTPS + reverse proxy
└── (optional) watchtower  # Auto-update
```

### Storage

Mount USB SSD at `/data`. SD cards die under write load.

### Minimal Resource Requirements

- RAM: 1GB
- Storage: 32GB+ SSD
- Bandwidth: 10Mbps symmetric
- Always-on connectivity

---

## What Hosts vs What You Host

### You Host (MVP)

- One directory feed (known gateways + last-seen)
- Bounty feed (derived view: client-computable from tip/receipt data; founder publishes default materialization, not authoritative)
- Reference client
- Receipt mints (L402 gate — 2-3 independent Ed25519 signers)
- Receipt aggregator
- Node provisioning marketplace (BTC-native VPS providers: SporeStack, bitcoin-vps.com ecosystem)

### Nodes Host

- Gateway + storage
- Mirror/prover agent
- Their own payout receiver (LNURL-pay)

### Node Provisioning (Default Onboarding)

Most operators won't run hardware. Default path: managed provisioning via BTC-native VPS providers.

```
User pays sats → Provisioning layer → Routes to cheapest/best provider
                       ↓
              Deploys node kit automatically
              Monitors health, applies updates
              Handles failover (provider dies → migrate)

PROVISIONING_SURCHARGE = 21% (same halving decay as protocol fees)
```

Multiple providers, one interface. No KYC anywhere in the chain.

### MVP Architecture

Founder operates directory, receipt mints (2-3 independent keypairs), receipt aggregator, provisioning. Bounty feed is a derived materialization any client can recompute from tip/receipt data.

Founder operates default services. Architecture permits replacement. MVP does not exercise that.

### Infrastructure Partners (Jurisdictional Fragmentation)

No single government seizure should kill more than one mint. Operators chosen for: own infrastructure (not resellers of US companies), Bitcoin/crypto payment, non-14-Eyes jurisdiction, track record under pressure.

| Operator | Jurisdiction | Role (MVP) | Notes |
|----------|-------------|------------|-------|
| FlokiNET | **Iceland** | Gateway + Coordinator + LND + Mint 1 | Own DC, since 2012, hosted WikiLeaks infra. BTC accepted, no KYC. IMMI press freedom laws. |
| Zergrush | **Romania** | Mint 2 | Own DC in Bucharest, 15+ cryptos. RO constitutional court struck down EU data retention twice. |
| Shinjiru | **Malaysia** | Mint 3 | Own DC in KL since 1998. ASEAN/non-aligned, no 14-Eyes. BTC accepted. |
| COIN.HOST | **Switzerland** | Backup gateway / future coordinator | Own DC in Zurich, ISO 27001, since 2011. BTC accepted. Not EU, not 14-Eyes, constitutional privacy. |
| VPSBG.eu | **Bulgaria** | DNS / monitoring / future gateway | Own hardware, self-funded since 2013. Accepts **Lightning**. Ignores DMCA, allows Tor exits. |

3 continents, 5 jurisdictions, 5 independent operators. ~$46/mo total at full deployment.

**MVP launch (2 servers):** FlokiNET Iceland (main stack) + one remote mint. Scale to 3 mints across 3 jurisdictions before public announcement.

---

## Directory Format

```
DirectoryV1 {
  publisher: pubkey
  hosts: [{ pubkey, endpoint, pricing: PricingV1, last_seen: u64, regions: [string], refusals_cid?: hash }]
  timestamp: u64
  sig: signature
}
```

`refusals_cid` links to operator's RefusalV1 feed. Client filters before routing.

---

## Discovery Event Model (Layer A.1)

Every meaningful protocol action is a signed event referencing a CID. Events propagate via gossip (Nostr relays, peer exchange). The coordinator materializes a default view, but any peer can materialize the same state from the event stream. Discovery is emergent from event accumulation, not curated by any authority.

### Event Kinds

All events share: `version: u8`, `from: pubkey`, `timestamp: u64`, `sig: signature`. Event identity = `SHA256(canonical(event minus sig))`.

| Kind | Schema | Purpose | Producer |
|------|--------|---------|----------|
| `CONTENT_ANNOUNCE` | ContentAnnounceV1 | Human metadata for a CID (title, description, preview, tags) | Uploader (or any metadata provider) |
| `ASSET_LIST` | AssetListV1 | Named collection of CIDs | Curator/uploader |
| `TIP` | TipV1 | Fund bounty pool for a CID | Supporter |
| `HOST_SERVE` | HostServeV1 | Host announces it serves a CID | Host operator |
| `HOST_REGISTER` | HostRegisterV1 | Host joins the network | Host operator |
| `RECEIPT_SUBMIT` | ReceiptV2 | Proof of paid consumption | Client |
| `EPOCH_SUMMARY` | EpochSummaryV1 | Settlement results for an epoch | Aggregator |
| `REFUSAL` | RefusalV1 | Host declares what it won't serve | Host operator |

### Propagation Model

```
MVP:     Events flow via HTTP to coordinator (POST /tip, POST /content/announce, etc.)
         Coordinator stores + materializes views.
         Coordinator is one materializer, not the authority.

Future:  Events published to Nostr relays (NIP-compatible kind numbers).
         Any peer subscribes, catches up on history, materializes local views.
         Coordinator becomes optional cache.
         (Already designed for in L2 + L4 of Longevity section.)
```

### Peer Discovery (How a New Node Bootstraps)

A new node knows nothing. It needs to discover what content exists, what's funded, what's worth mirroring.

```
1. Bootstrap:   Know at least one coordinator URL or Nostr relay (hardcoded or DNS-seeded)
2. Catch-up:    Subscribe to event stream. Query recent events by kind:
                - TIP events → what CIDs have been funded recently
                - HOST_SERVE events → who serves what, at what price
                - CONTENT_ANNOUNCE events → human metadata for CIDs
                - ASSET_LIST events → collections declared by uploaders
                - EPOCH_SUMMARY events → what settled, where receipts flowed
3. Materialize: Replay events to build local views (bounty pools, host directory, content index)
4. Filter:      Selective sync by bounty level, content type, region, recency
5. Participate:  Mirror profitable CIDs, publish own HOST_SERVE events
```

The coordinator's `GET /bounty/feed` (used by node-agent today) is a materialized view over TIP events. Any peer with the event stream can compute the same feed.

### Event Log Growth + Compaction

**Problem**: The event stream grows without bound. At scale, TIP/RECEIPT/HOST_SERVE events explode. "Replay from genesis" becomes impractical — a new node joining at epoch 50,000 can't process millions of events before it can participate. Bootstrapping degrades to "trust a snapshot from someone," which undermines the self-verifying property (L4).

**Design constraint**: Compaction must preserve auditability. A node that starts from a snapshot must be able to verify it was derived honestly from the event stream, without replaying the stream itself.

**Solution: Epoch snapshots with inclusion proofs, anchored to Bitcoin.**

```
                    Event Stream (append-only, unbounded)
                    ┌──────────────────────────────────────────┐
                    │ TIP  TIP  RECEIPT  HOST_SERVE  TIP  ...  │
                    └──────────────────┬───────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │  Epoch Summary   │  (already exists: merkle root of receipts,
                              │  (per epoch)     │   host scores, bounty deltas)
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  State Snapshot  │  compact materialized state at epoch N:
                              │  (periodic)      │  bounty pools, host registry, content index
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  Epoch Root      │  SHA256(epoch_summary || snapshot_hash)
                              │  Anchored to BTC │  committed on-chain (L7)
                              └─────────────────┘
```

#### State Snapshots

A snapshot is a compact materialized view of protocol state at an epoch boundary:

```
StateSnapshotV1 {
  epoch: u32                      # snapshot taken at this epoch boundary
  bounty_pools: MerkleRoot        # merkle tree of all (cid, balance) pairs
  host_registry: MerkleRoot       # merkle tree of all (host_pubkey, status, stake, score, pricing)
  content_index: MerkleRoot       # merkle tree of all (cid, announce_id, list_ids)
  host_serves: MerkleRoot         # merkle tree of all (host, cid) pairs
  pin_contracts: MerkleRoot       # merkle tree of all active pins
  event_count: u64                # total events through this epoch
  prev_snapshot_hash: bytes32     # chain snapshots for consistency
  snapshot_hash: bytes32          # SHA256(canonical(this minus snapshot_hash))
}
```

Each merkle tree supports **inclusion proofs**: a node can verify "CID X has bounty Y in this snapshot" with O(log N) hashes, without downloading the full tree.

#### Bootstrap from Snapshot

```
1. Bootstrap:    Obtain recent StateSnapshotV1 (from coordinator, peer, or relay)
2. Verify:       Check snapshot_hash against Bitcoin-anchored epoch root (L7)
                 If anchor exists: trustless. If not: trust-on-first-use with snapshot publisher sig.
3. Catch-up:     Replay events ONLY from snapshot epoch to current (days, not years)
4. Materialize:  Apply delta events to snapshot state → current state
5. Participate:  Node is fully operational
```

A node joining at epoch 50,000 downloads a snapshot at epoch 49,900, verifies it against the anchored root, replays ~100 epochs of events, and is current. Not "trust a snapshot from someone" — verify against a Bitcoin commitment.

#### Log Compaction Strategies

| Strategy | When | Benefit |
|----------|------|---------|
| **Epoch summaries** | Every epoch (4h) | Compact receipts into merkle root + counts; raw receipts become retrievable blobs |
| **State snapshots** | Every N epochs (configurable, e.g. every 100 epochs ≈ 17 days) | Full state checkpoint for fast bootstrap |
| **Receipt rollups** | Per epoch | Replace individual ReceiptV2 events with `EpochSummary { merkle_root, count, unique_clients }` in the propagated stream; raw receipts stored by coordinator but not gossiped |
| **Event pruning** | After snapshot | Events before the latest anchored snapshot can be archived to blob storage (content-addressed, retrievable) rather than kept in the hot event stream |
| **Sharded event streams** | At scale | Partition events by `(epoch, cid_prefix)` — a node interested in CIDs starting with `0x3f` subscribes to that shard only |

#### What Propagates vs. What's Archived

| Data | Propagated (gossip/relay) | Archived (blob storage, retrievable) |
|------|--------------------------|-------------------------------------|
| State snapshots | Yes (small, periodic) | Yes |
| Epoch summaries | Yes (compact) | Yes |
| TIP events | Yes (needed for bounty computation) | Yes |
| HOST_SERVE events | Yes (needed for directory) | Yes |
| CONTENT_ANNOUNCE events | Yes (needed for discovery) | Yes |
| Raw individual receipts | **No** — only merkle roots + counts propagate | Yes (auditors retrieve on demand) |
| Spot-check results | Only aggregated score changes | Yes |

Receipt rollups are the biggest win: individual receipts are the highest-volume event type, but only their aggregates (merkle root, count, unique clients) matter for epoch settlement and reputation signals. Raw receipts are kept for audit challenges but don't need to flow through the gossip layer.

#### MVP vs. Scale

| Phase | Approach |
|-------|----------|
| **MVP** | Single coordinator stores all events in Postgres. No compaction needed — volume is small. Epoch summaries already exist. |
| **Early scale** | Coordinator publishes periodic state snapshots. New nodes bootstrap from snapshot + recent events. Receipt rollups reduce gossip volume. |
| **Full scale** | Epoch root anchoring (L7) makes snapshots trustless. Sharded event streams. Raw receipts in blob storage. Any peer can generate + publish snapshots. |

The important thing: **design the snapshot format and inclusion proof structure now** (even if MVP doesn't exercise it), so that the transition from "trust the coordinator" to "verify against Bitcoin" is a configuration change, not an architecture change.

### Content Grouping

Collections are signed events, not protocol entities. The blob layer stays dumb.

- Uploader publishes `AssetListV1` grouping CIDs with human-readable names
- Anyone can publish their own list referencing the same CIDs (different curation, different metadata)
- Tipping a collection = client-side fan-out: resolve list → tip each constituent asset_root proportionally
- Bounty pools remain per-CID (hosts don't need to understand collections)

Multiple announcements and lists for the same CID are expected. Metadata quality is a service — better metadata drives more consumption, more consumption drives more receipts.

### Collection Fan-Out (Tipping a List)

```
tip_collection(list_cid, total_sats):
  list = resolve(list_cid)                     # fetch AssetListV1
  total_size = sum(item.size for item in list.items)
  for item in list.items:
    share = floor(total_sats * item.size / total_size)
    tip(item.cid, share)                       # individual tip per constituent
```

Proportional by file size: larger files get proportionally more (they cost more to store/serve). Alternative strategies (equal split, manual allocation) are client-side decisions.

---

## Signal Layer (Automatic Reputation)

Reputation signals are exhaust from normal protocol operation. No ratings, no reviews, no human judgment. Every signal is either a cryptographic proof or an economic fact derived from signed events.

**Principle**: Positive signals accumulate automatically from protocol activity. Negative signals require cryptographic proof of fraud or are observable availability failures.

### Host Signals (Automatic)

| Signal | Source | Cost to Fake |
|--------|--------|-------------|
| Uptime % | Spot-check pass/fail (rolling window) | Must actually serve correct bytes |
| Median latency | Spot-check latencyMs | Must actually respond fast |
| Receipt volume | Lifetime receipt count | Each receipt costs L402 + PoW |
| Unique clients | Distinct client pubkeys in receipts | Each pubkey costs sats + escalating PoW |
| CIDs served | HostServe event count | Must store + serve real blocks |
| Tenure | Epochs since registration | Time is unfakeable |
| Earned sats | Sum from EpochSummaryRecords | Derived from verified receipt flow |
| Slash count | AuditChallenge events with proven fraud | Cryptographic proof required |
| Profitability threshold | min_bounty_sats from PricingV1 | Self-reported, but market-verified |

### Content Signals (Automatic)

| Signal | Source | Meaning |
|--------|--------|---------|
| Bounty pool balance | TIP events | Funding committed to keep this alive |
| Tip count + unique tippers | TIP events (distinct `from` pubkeys) | Breadth of support (1 whale vs 200 supporters) |
| Receipt velocity | Receipts per epoch, recent trend | Active demand (paid fetches happening now) |
| Client diversity | Unique client pubkeys in receipts | Genuine demand breadth |
| Replica count | HOST_SERVE events for this CID | Independent hosts serving |
| Host diversity | Distinct regions/ASNs of serving hosts | Geographic resilience |
| Epoch survival | Consecutive epochs with active receipts | Sustained demand over time |
| Estimated sustainability | bounty / drain_rate at current host count | How long funding lasts |

Composite **resilience score** = weighted formula over these inputs. Client-computable, auditable, not authoritative.

### Author Signals (Pseudonymous, Automatic)

| Signal | Source | Meaning |
|--------|--------|---------|
| Content published | CONTENT_ANNOUNCE events from pubkey | Volume |
| Demand attracted | Receipts across all their CIDs | Did people consume what they published? |
| External funding | TIP events from *other* pubkeys on their content | Others spending real sats on your stuff |
| Unique supporters | Distinct tippers across their content | Breadth of support |
| Content survival rate | Fraction of uploads still served after N epochs | Lasting value vs flash-in-pan |
| Self-hosts | Pubkey matches a registered Host | Skin in the game |
| First seen | Earliest event from this pubkey | Age in the system |

### Market Quoting (Supply Curve)

Clients estimate replication by sampling host `min_bounty_sats` thresholds from the directory:

```
quote(cid, additional_sats):
  current_bounty = query_bounty(cid)
  new_bounty = current_bounty + additional_sats
  
  hosts = query_directory()
  willing = [h for h in hosts if h.pricing.min_bounty_sats <= new_bounty]
  
  return {
    current_copies: count(hosts serving cid),
    estimated_copies: len(willing),
    estimated_sustainability: new_bounty / cid_epoch_cap(new_bounty),
    supply_curve: [
      { bounty_level: 50,    hosts_willing: count(h where threshold <= 50) },
      { bounty_level: 200,   hosts_willing: count(h where threshold <= 200) },
      { bounty_level: 1000,  hosts_willing: count(h where threshold <= 1000) },
      ...
    ]
  }
```

This is a real market quote from counterparty signals, not a formula estimate. Accuracy improves with network size.

### Anti-Fakery Economics

| Attack | Defense |
|--------|---------|
| Inflate own receipt count | Each receipt costs real L402 sats + PoW compute = demand subsidy at cost |
| Fake unique clients | Each pubkey needs sats + PoW escalation per receipt per day |
| Inflate tip count | Each tip costs real Lightning sats |
| Fake uptime | Spot-checks are protocol-initiated, not self-reported |
| Inflate tenure | Time is unfakeable |
| Self-tip to boost content | Costs real sats. If no one else tips, content dies when your money runs out |

All positive signals are economically costly to produce. Self-promotion is taxed, not prevented. At scale, self-farming is demand subsidy at cost (same principle as receipt anti-sybil: §Host Self-Farming).

---

## Upgradability

### Freeze Layers

| Layer | Examples | Changeability |
|-------|----------|---------------|
| **Frozen** | SHA256 for CIDs, canonical serialization rules, CID semantics | Never. Change breaks all interop. |
| **Versioned** | ReceiptV2, AssetRootV1, PricingV1, ContentAnnounceV1, AssetListV1, all wire schemas | Additive only. V1 never changes; publish V2 alongside. |
| **Tunable** | EPOCH_LENGTH, thresholds, reward caps, all constants | Change at epoch boundaries. |
| **Local** | Client ranking, host pricing, discovery config | Each party decides. No coordination. |

Minimize frozen surface. Everything else is soft.

### Wire Rules

- `version: u8` in every schema, every API response, every epoch summary. Non-negotiable.
- Unknown fields: preserve, don't reject. Additive changes are free.
- Epoch boundaries as upgrade gates: "aggregator requires ReceiptV3 after epoch N." Node kit auto-updates; third parties get advance notice.

### Fee Halving Trigger

Halving schedule is a ceiling (can lower faster, never raise above). Consider starting the 4-year clock at a network maturity threshold (e.g. N independent hosts or X total bounty sats) rather than calendar date. Preserves commitment to decay while allowing learning during bootstrap noise.

### Solo Founder Window

While founder controls all roles (client, aggregator, node kit), Layers 2-4 are cheap to change. Schemas shipped at "1.0" (when third parties build on them) become expensive to change. Exploit the MVP window for iteration; freeze deliberately.

---

## Implementation Order

Layer A (platform primitive) ships first. Layer B (first-party app) builds on top.

### Phase 1: Blob Utility (Layer A)

**1. File layer + gateway + HTTP origin**

Deliverables:
- Canonical serialization library (stable field order, deterministic encoding, no floats)
- Block storage backend (content-addressed filesystem or KV store)
- SHA256 verification on `PUT /block` (reject mismatched hashes)
- FileManifestV1 construction + validation (chunk_size, size, blocks[], merkle_root)
- AssetRootV1 construction + validation (kind, original, variants, meta)
- Client-side chunking library (chunk → hash → push)
- Client-side image variant generation (resize is cheap; video transcoding is paid service, defer)
- HTTP endpoints: `GET/PUT /block/{cid}`, `GET/PUT /file/{root}`, `GET/PUT /asset/{root}`
- `HEAD /asset/{root}` returns size, MIME, pricing hints
- EXIF/metadata stripping before hashing (default behavior)

Dependencies: none (foundation layer)

Exit: upload a multi-block file, retrieve it by asset_root, verify `SHA256(reassembled_bytes) == original`. Variants resolve independently.

---

**2. L402 paid fetch + receipt minting**

Deliverables:
- LN node integration (CLN or LND; invoice generation + settlement detection)
- L402 challenge-response flow on `GET /block` (402 → invoice → pay → receive bytes + receipt_token)
- Receipt mint service: Ed25519 keypair, signs `("R2" || host || epoch || block_cid || response_hash || price || payment_hash)`
- 2-3 independent mint instances (separate keypairs, separate processes; founder-operated)
- `PricingV1` endpoint per host (`min_request_sats`, `sats_per_gb`, `burst_sats_per_gb`)
- `min_request_sats` enforcement (floor per request)
- Client PoW receipt minting (optional, after fetch): compute `H(challenge || nonce) < TARGET`
- Block selection: `PRF(epoch_seed || file_root || client_pubkey) mod num_blocks` (anti-special-casing)

Dependencies: step 1 (needs blocks to serve)

Exit: client pays L402, receives block + receipt_token. Token verifies against mint pubkey. PoW receipt mints successfully. Second mint issues independently valid tokens for same fetch.

---

**3. Node kit + host registration**

Deliverables:
- `docker-compose.yml`: gateway (HTTP server) + agent (mirror/announce) + caddy (HTTPS + reverse proxy)
- Host registration: `HostServeV1 { host_pubkey, cid, endpoint, stake }`
- Stake locking via LN payment (2,100 sats; refundable after unbonding)
- Health check responder (spot-check: serve random block, 30s timeout)
- CID selection agent: watch bounty feed, mirror content above profitability threshold
- Directory announcement (push `HostServeV1` to founder directory)
- Availability score tracking (successful_checks / total_checks, rolling 6 epochs)
- Status lifecycle: PENDING → TRUSTED → DEGRADED → INACTIVE (earning decay, not slashing)
- Multi-endpoint failover (host MAY register multiple endpoints per CID)
- Archive mode (no public endpoint; challenge-response only; reduced earnings)
- Auto-update via watchtower (optional)

Dependencies: steps 1-2 (needs file layer + L402 to serve paid blocks)

Exit: deploy on Pi or VPS. Registers with directory. Serves blocks via L402. Passes 3/5 spot checks → TRUSTED. Earns egress fees. Second node deploys independently, serves same CID.

---

**4. Receipt verification SDK**

Deliverables:
- Standalone library (TypeScript + Rust; zero external dependencies)
- Single function: `VerifyReceiptV2(receipt, mint_pubkey_set) → { valid, error? }`
- Checks: `client_sig` over receipt fields, `pow_hash < TARGET`, `receipt_token` against any mint in set (Ed25519_verify)
- No LN state, no network calls, no protocol context
- Published as npm package + Rust crate
- Test vectors: valid receipt, expired epoch, bad PoW, forged token, unknown mint

Dependencies: step 2 (needs receipt format finalized + real receipts to test against)

Exit: import library in a fresh project. Verify a receipt in <1ms. Reject a forged receipt. Works offline. Zero deps in `package.json` / `Cargo.toml` beyond std.

---

**5. Pin contract API**

Deliverables:
- `pin(PinContractV1)` → allocates budget to `bounty[asset_root]`, sets `drain_rate = budget / duration_epochs`
- `pin_status(pin_id)` → returns remaining budget, active hosts, epoch proofs
- `pin_cancel(pin_id, sig)` → returns remaining budget minus `PIN_CANCEL_FEE`, status → CANCELLED
- Epoch proof bundle: filtered `EpochSummary` for pinned asset_root (hosts serving, receipt counts, unique clients)
- `min_copies` enforcement: pin stays ACTIVE only while `independent_hosts >= min_copies`; alerts client if below threshold
- Region constraint checking (optional; match host `regions[]` against pin `regions[]`)
- Signed commitment object (client can present to auditors / platforms as proof of durability contract)

Dependencies: steps 1-3 (needs file layer + hosts + bounty pool mechanics)

Exit: create pin for asset_root with `min_copies=3, duration=1000 epochs, budget=10000 sats`. Three hosts replicate content. Epoch proof bundle shows all three serving. Cancel pin, receive refund minus fee. Drain rate limits per-epoch payout correctly.

---

Phase 1 creates the platform primitive. External adopters can use it as a CDN replacement / paid origin / durability market without touching Layer B.

### Parallelism (Phase 1)

```
[1] ──────────────────────►
     [2] ──────────────►       (starts after block storage works)
          [3] ────────────►    (starts after L402 works)
     [4] ────►                 (starts once receipt format is stable)
               [5] ──────►     (starts once hosts + bounty pool work)
```

---

### Phase 1.5: Discovery + Signals (Layer A.1)

Makes Layer A content usable by humans and discoverable by foreign peers. No dependency on production deployment — buildable in parallel with Phase 1 infrastructure.

**6. Discovery event schemas + batch upload**

Deliverables:
- ContentAnnounceV1 + AssetListV1 schemas in physics (TypeBox, canonical, signable)
- PreviewV1 schema (inline thumbnail/excerpt, ≤16 KiB)
- Event kind constants (Nostr NIP-compatible range)
- Batch upload in CLI: `dupenet upload <dir>` → chunk all files, generate thumbnails, publish ContentAnnounceV1 per file + AssetListV1 for collection
- Upload metadata flags: `--title`, `--description`, `--tags`, `--language`, `--source`
- Collection fan-out tipping: `dupenet tip <list_cid> <sats>` → resolves list, distributes across constituents proportionally by size
- `min_bounty_sats` field on PricingV1 (host publishes profitability threshold)

Dependencies: Phase 1 steps 1-3 (needs blob layer + host registration for end-to-end)

Exit: `dupenet upload ~/leak/ --title "Court Filings" --tags legal` uploads 200 PDFs with previews, prints one collection URL. `dupenet tip <list_cid> 10000` distributes sats across all constituents.

---

**7. Signal aggregation + market quoting**

Deliverables:
- Coordinator stores ContentAnnounceV1 + AssetListV1 events (Prisma models, POST/GET endpoints)
- `GET /content/recent` — browsable feed of announced content (paginated, filterable by tags)
- `GET /content/list/:list_cid` — resolve collection
- `GET /host/:pubkey/scorecard` — automatic host reputation (uptime, latency, receipts, tenure, earnings, slashes)
- `GET /content/:cid/signals` — content resilience (bounty, replicas, demand trend, sustainability estimate, composite resilience score)
- `GET /author/:pubkey/profile` — pseudonymous author reputation (content count, demand attracted, unique supporters)
- `GET /market/quote` — supply curve from host thresholds (at bounty X, Y hosts would mirror)

Dependencies: Phase 1 steps 1-5 (needs bounty pools, receipts, spot-checks — data must exist in Prisma)

Exit: `GET /content/recent` returns a human-browsable feed. `GET /content/<cid>/signals` returns resilience score + quote. `GET /host/<pk>/scorecard` returns full automatic reputation.

---

**7b. Event log compaction + snapshot bootstrap**

Deliverables:
- `StateSnapshotV1` schema in physics (epoch, merkle roots for bounty pools / host registry / content index / host serves / pins, event count, prev hash)
- Merkle tree library for snapshot trees (build tree from key-value pairs, generate inclusion proofs, verify proofs)
- Coordinator snapshot generator: materialize current state into `StateSnapshotV1` at epoch boundaries (every `SNAPSHOT_INTERVAL_EPOCHS`)
- `GET /snapshot/latest` — returns most recent snapshot + epoch
- `GET /snapshot/:epoch` — returns snapshot at specific epoch
- `GET /snapshot/:epoch/proof/:key` — returns inclusion proof for a specific entry (e.g. bounty pool for CID X)
- Receipt rollup in epoch settlement: `EpochSummary` stores receipt merkle root + counts; raw receipts archived, not propagated
- Bootstrap endpoint: `GET /bootstrap` — returns latest snapshot + events since snapshot (for fast node sync)
- Snapshot verification: verify `snapshot_hash` against Bitcoin-anchored `epoch_root` (when L7 is active); fall back to publisher signature (MVP)

Dependencies: Phase 1 steps 1-5 (needs coordinator with Prisma state), step 7 (signals depend on snapshot-able state)

Exit: coordinator generates snapshots every 100 epochs. New node calls `GET /bootstrap`, receives snapshot + recent events, materializes state without full replay. Inclusion proof verifies "CID X has bounty Y" against snapshot merkle root.

---

**8. Web content surface**

Deliverables:
- Content landing page: `/v/<cid>` renders content + metadata + instrument cluster + Fortify button
- Collection page: `/c/<list_cid>` renders grouped content with per-asset signals + aggregate resilience
- Market quote display: "Add X sats → est. Y copies for Z days" from supply curve
- Lightning payment in browser: WebLN auto-pay + QR code fallback
- Free preview serving: gateway serves thumbnail CIDs / small blocks without L402
- Host scorecard page: `/h/<pubkey>` renders host reputation profile

Dependencies: steps 6-7 (needs event schemas + signal endpoints)

Exit: share `https://ocdn.is/c/<list_cid>` → recipient sees collection with titles, previews, resilience scores, and Fortify button. One Lightning payment funds replication across all documents.

---

### Parallelism (Phase 1 + 1.5)

```
Phase 1:
[1] ──────────────────────►
     [2] ──────────────►
          [3] ────────────►
     [4] ────►
               [5] ──────►

Phase 1.5 (parallel, no VPS dependency):
[6] ────────────►              (needs physics + CLI; starts after schemas stable)
     [7] ──────────────►       (needs coordinator + Prisma data)
     [7b] ─────────►           (needs coordinator state; parallel with 7)
          [8] ────────────►    (needs signal endpoints + event schemas)
```

Phase 2 (Layer B: first-party app) build plan is in `post_mvp.md`.

### Adoption Path (Expected)

- **Early**: Apps use Layer A as origin/CDN for public media (store `asset_root` pointers, outsource distribution)
- **Mid**: Apps use paid fetch + pin contracts for mirrored archives and paid downloads
- **Mid-late**: Humans discover content via web surface, fund replication via Fortify; hosts compete for bounties
- **Late**: Apps run 1-2 nodes, participate in bounty loop, use receipt SDK for cross-platform demand signals

---

## Go-to-Market

Two flywheels, two GTM tracks. Run both; they reinforce each other.

### Flywheel B: Seed Content (Demand-Side Bootstrap)

Seed content determines who shows up first. Who shows up first determines culture. Choose content that:
- Is under active threat elsewhere (censorship creates organic fortify demand)
- Has a passionate audience willing to pay sats (tips/bounties flow immediately)
- Demonstrates the core value prop in a way anyone can understand (immutable, verifiable, can't be killed)
- Generates discussion depth (vine model gets exercised; harmonic allocation gets tested with real behavior)

#### Tier 1: High-Signal Pressure Content

**Epstein documents / court filings / FOIA releases**
- Massive cross-political-spectrum public interest
- Content is under real suppression pressure → organic "Fortify" demand
- Content-addressed = "these are the verified bytes, hash-check them yourself"
- Generates deep discussion threads (vine depth, harmonic allocation under real load)
- Demonstrates the headline use case: "this can't be taken down if people fund it"
- Risk: attracts conspiracy crowd early; tone-setting. Mitigated by the economics — serious discussion costs sats, noise costs sats.

**Deplatformed creator archives**
- Creators removed from YouTube/Twitter/Patreon already have audiences willing to pay for preservation
- Natural tip/bounty flow from existing fanbases
- Creator promotes the platform to their audience (free distribution)
- Demonstrates "mirror of last resort" positioning
- Risk: depends on creator quality; some deplatformings are deserved. Protocol doesn't care — hosts choose what to serve.

**Investigative journalism under legal threat**
- Stories that get pulled, injuncted, or pressured off platforms
- Journalists + audiences fortify together
- "Streisand effect as a service"
- Risk: legal exposure for founder if positioned as publisher. Mitigated by protocol design — founder operates infrastructure, not editorial.

#### Tier 2: Community-Native Content

**4chan /biz/ archive (or similar ephemeral boards)**
- Content is ephemeral by design (threads expire in hours) → durability has clear, immediate value
- Audience is crypto-native, already understands micropayments and sats
- Financial discussion has natural "put your money where your mouth is" dynamics (tip the alpha, let garbage expire)
- Tests tipping/bounty mechanics with a real, active audience
- Archive becomes content-addressed + searchable + tippable (none of which 4chan provides)
- Risk: attracts shillers and scammers early. Mitigated by signal classes — visibility costs real sats, not free posts.

**Seeded debates / arguments / spicy takes**
- Founder or early community posts controversial-but-substantive takes on tech, finance, politics, culture
- Creates vine depth fast (topic → post → replies → counter-replies)
- Tests harmonic allocation under real emotional load (do people actually tip what they want to preserve?)
- Tests instrument cluster (do sats committed, unique payers, epoch survival actually surface the best content?)
- Effective content: "hot take + evidence + invitation to disagree" — not ragebait, but genuine disagreement that people will pay to amplify
- Risk: founder seeding content looks astroturfed. Mitigated by pseudonymous design — content stands on its own economics, not founder endorsement.

#### Tier 3: Utility Content (Flywheel A Seed)

**Open-source project mirrors / model weights / datasets**
- Software tarballs, ML model weights, scientific datasets
- Developers and researchers care about verifiable bytes + availability
- Tests "immutable release channel" use case
- Pin contracts make immediate sense here (project pays for durability)
- Risk: low emotional engagement, won't drive Flywheel B. That's fine — it drives Flywheel A.

**Academic papers / public-domain archives**
- Sci-Hub-adjacent: massive demand, censorship pressure, audience used to paying small amounts
- Historical documents, out-of-print books, government records
- Low-conflict, high-utility; broadens the user base beyond controversy
- Risk: legal gray zone depending on jurisdiction. Content-addressed + encrypted blobs + operator content policy provides plausible deniability layers.

**Podcast / video backups**
- Podcasters are increasingly deplatformed or demonetized
- Large files test the blob layer under real load
- Creators understand recurring hosting costs → pin contracts map naturally
- Risk: bandwidth-heavy; needs hosts with real capacity early.

### Flywheel A: Layer A as Marketplace Primitive (Self-Reinforcing)

Layer A isn't just boring B2B plumbing. `PUT blob + L402 paid fetch + content-addressed verification` is already a permissionless marketplace where the goods are bytes and the payment is Lightning. Every seller is a marketer (they earn per fetch, so they promote). Every host is earning. Every buyer gets verifiable bytes with no account, no signup, no platform cut.

Markets where this maps directly — the goods are digital, buyers want pseudonymous payment, sellers want to avoid platform risk/cuts, and unit price is small:

#### Micro Video / Clip Markets

- Short clips, tutorials, reactions, how-to, niche content
- L402 makes individual clip purchase trivial (3-50 sats per fetch)
- No account needed — Lightning = pay and go
- Creator keeps nearly everything (egress floor only, no 30% App Store / 45% YouTube cut)
- Self-reinforcing: creators earn per-view without platform → promote their own links → more creators see it working → more content → more viewers
- This is "Gumroad for files" but with no signup, no KYC, no payment processor risk

#### Paid Torrent Replacement

BitTorrent's unsolved problem: no payment. Seeders donate bandwidth, leechers take for free. No economic feedback loop. Content dies when seeders lose interest.

- This protocol solves it: L402 = pay per fetch. Hosts earn. Content stays alive as long as someone pays.
- "BitTorrent but you get paid to seed" is an instantly legible pitch to the torrent community
- Content-addressed = same deduplication / verification properties as torrents
- Multiple hosts = same multi-source download properties
- Price competition among hosts = races to efficiency (not races to zero)
- Self-reinforcing: hosts earn → more hosts join → faster downloads → more users → more earning → more hosts
- Long-tail content survives if *anyone* values it enough to fund a bounty or pin

#### Adult Content

Massively underserved by existing payment rails. Visa/Mastercard constantly deplatform. OnlyFans nearly died overnight from payment processor pressure.

- Lightning solves the payment problem entirely (no chargebacks, no processor, no KYC)
- Content-addressed + encrypted blobs = hosts serve ciphertext, don't need to know content
- Creators keep nearly 100% vs 20% platform cut
- Audience is already comfortable paying per-item
- Self-reinforcing: reliable payment rails attract creators → content attracts audience → audience funds hosts → hosts grow → more creators trust it
- Likely one of the highest-velocity Layer A adoption paths. The demand is massive, the supply is suppressed by payment infrastructure, and the protocol removes the bottleneck.

#### Data / API / Scraping Markets

- Datasets, scraped data, research data, API snapshots, training data
- L402 is literally HTTP 402 — designed for "pay to access this resource"
- Content-addressed = buyer can verify they got what they paid for (no bait-and-switch)
- Metered access: price per block, price per GB, price per query
- AI agent access: agents pay L402, get receipts, cache with verifiable provenance
- Self-reinforcing: sellers list high-value data → buyers pay → sellers produce more → market deepens

#### Gray / Black Markets

The protocol can't prevent this and shouldn't try. Content-addressed encrypted blobs are opaque by design. Hosts serve ciphertext. Keys travel out-of-band.

What will happen:
- Pirated media (movies, music, software, games) — "paid torrents" but with actual host economics
- Leaked documents, corporate secrets, exploit code
- Anything currently on Telegram channels / private trackers / darknet markets that is purely digital files

Why it's self-reinforcing:
- Cheaper than alternatives (host competition drives price down)
- More reliable than alternatives (bounty pools keep content alive)
- Pseudonymous by default (Lightning + pubkeys, no accounts)
- Each participant is economically motivated to keep the market alive

Founder's position: protocol is infrastructure, like TCP/IP or BitTorrent. Founder's own hosts can refuse content via RefusalV1 policy. Other hosts make their own choices. The protocol doesn't know what encrypted bytes contain, and the founder doesn't operate a marketplace — they operate a content-addressed blob store with a price API.

#### The Common Dynamic

All of these share the same self-reinforcing loop:

```
Seller uploads → shares link → buyer pays L402 → host earns egress
                                              → seller earns (if hosting own content)
                                              → receipt proves demand
                                              → more hosts mirror (if bounty exists)
                                              → prices drop → more buyers → more sellers
```

Every seller is their own marketing department because they earn from every fetch. This is the same emotional intensity as Flywheel B (content people care about) but driven by economic self-interest rather than ideological conviction. Both work. Together they cover the full motivation spectrum.

#### What Layer A Markets Need (Minimal)

These markets emerge with just Layer A. They don't need vine allocation, topic hashes, social layers, or discovery. They need:

1. `PUT /block` + `PUT /file` + `PUT /asset` (upload)
2. `GET /block` via L402 (paid fetch)
3. A shareable link (`https://gateway/asset/{root}`)
4. Host competition (multiple gateways, price comparison)
5. Optional: pin contracts for sellers who want guaranteed availability

The seller handles their own marketing (share the link on Twitter, Telegram, Nostr, email, wherever). The protocol just serves bytes and collects payment. No discovery layer needed — the internet is the discovery layer.

### Bootstrap Sequence

```
Week 1-2:  Founder uploads seed content (Tier 1 + Tier 2)
           Founder operates 2-3 hosts + 2-3 mints
           Content browsable at L402 floor (3 sats/request)
           "Fortify" button live but no hosts competing yet
           Layer A HTTP origin functional — anyone can PUT/GET blobs

Week 3-4:  Announce on Nostr, Bitcoin Twitter, torrent communities, relevant forums
           First organic tips flow → bounty pools start filling
           First external hosts deploy via node kit
           First sellers upload paid content (clips, files, data) — share links externally
           Instrument cluster shows real numbers

Month 2:   First deplatformed creator or journalist archives their content
           First "censorship event" drives organic fortify wave
           Layer A micro-markets emerge organically (sellers find the protocol)
           Receipt volume validates host economics from both flywheels

Month 3-4: First external app integrates Layer A (stores asset_root pointers)
           First pin contract from a platform or organization
           Marketplace dynamics self-reinforce (sellers promote, hosts earn, prices drop)
           Adult content / paid media creators discover reliable Lightning payment rails

Month 6+:  Layer A markets generate steady egress revenue independent of Flywheel B drama
           Host network is large enough that new markets bootstrap without founder involvement
           Flywheel A sustains itself; Flywheel B spikes on censorship events
```

### What NOT to Do

- **Don't curate**. Founder operates infrastructure, not editorial. The moment you pick winners, you own the moderation problem.
- **Don't moderate globally**. Hosts choose what to serve. Founder's hosts can have a refusal policy. Other hosts can serve anything.
- **Don't build social features first**. Layer A (boring blobs + paid receipts) proves the economics. Layer B (social, discovery, feed) can come after demand exists.
- **Don't chase volume**. Chase intensity. 100 people tipping 210 sats each on one CID is worth more than 10,000 free impressions. The protocol is designed for this.
- **Don't explain the protocol**. Show the content. "This document can't be taken down because 47 people have funded its replication" is the entire pitch.

### Positioning

Not "decentralized storage." Not "censorship-resistant platform." Not "Web3 media."

**"Content that can't be killed, priced by the people who care."**

The protocol is invisible. The content is visible. The instrument cluster (sats committed, replicas, epoch survival) is the proof. Users don't need to understand L402 or harmonic allocation. They need to see a number go up when they tap "Fortify."

---

## Success Criteria

**Content survives**: Popular content maintains copies. Unpopular content gracefully degrades.

**Verification honest**: Receipt-based payouts + optional audits. No trusted verifiers needed.

**Hosts profit**: Honest operators earn more than costs. Dishonest operators lose stake.

**Market emerges**: Multiple hosts compete on price/performance. No single point of failure.

**Permissionless**: Anyone can host, verify, attest, or pay for replication. No gatekeepers.

**Platform adopted**: External apps use Layer A as replaceable infrastructure. Pin contracts generate B2B revenue. Receipt SDK used cross-platform.

**Flywheel A turning**: More apps → more egress → more hosts → more resilience → more apps.

Layer B success criteria (attention pricing, discovery, graph accumulation, lineage) are in `post_mvp.md`.

---

## Constants (Tunable)

| Constant | Value | Rationale |
|----------|-------|-----------|
| BASE_FEE | 21-210 sats | Floor = spam defense; cap = peak demand; 100% to bundler |
| AGGREGATOR_FEE | 3% | Receipt validation + payout processing fee |
| PROTOCOL_FEE_HALVING | 4 years | All protocol fees halve on this schedule |
| PROTOCOL_FEE_SUNSET | 20 years | All protocol fees reach 0% |
| PROVISIONING_SURCHARGE | 21% | Managed node provisioning margin (same decay) |
| OPERATOR_STAKE | 2,100 sats | Sybil resistance, accessible |
| RECEIPT_MIN_COUNT | 5 | Min receipts for payout eligibility |
| RECEIPT_MIN_UNIQUE | 3 | Min distinct client pubkeys |
| POW_TARGET_BASE | 2^240 | ~200ms on mobile |
| POW_ESCALATION_THRESHOLD | 8 | Receipts/day before difficulty ramps |
| UNBONDING_PERIOD | 7 days | Catch misbehavior |
| EPOCH_LENGTH | 4h | Reward cycle + receipt aggregation (6 cycles/day) |
| EPOCH_REWARD_PCT | 2% | % of bounty pool per CID per epoch (total cap, split by score) |
| EPOCH_REWARD_BASE | 50 sats | Base cap per CID per epoch; scales with log2(bounty/base+1) |
| W_CLIENTS | 0.5 | Score weight: unique clients in epoch |
| W_UPTIME | 0.3 | Score weight: uptime ratio |
| W_DIVERSITY | 0.2 | Score weight: ASN/geo diversity contribution |
| AUDIT_REWARD_PCT | 30% | Challenger's share of withheld epoch reward on proven mismatch |
| MIN_REQUEST_SATS | 3 sats | Egress grief floor (covers marginal serving cost) |
| SATS_PER_GB | 500 | Default egress rate (sustainable for small operators) |
| BURST_SATS_PER_GB | 2000 | 4× surge pricing |
| CHUNK_SIZE_DEFAULT | 256 KiB | Standard block size (262144 bytes) |
| MAX_MANIFEST_BLOCKS | 32,768 | ~8GB max file at 256KiB chunks |
| MAX_ASSET_VARIANTS | 8 | Cap derivative count per asset |
| PIN_MIN_BUDGET | 210 sats | Minimum pin contract budget (covers at least a few epochs) |
| PIN_MAX_COPIES | 20 | Cap on min_copies per pin contract |
| PIN_CANCEL_FEE | 5% | Deducted from remaining budget on early cancellation |
| FREE_PREVIEW_MAX_BYTES | 16,384 | 16 KiB — max block size served without L402 (thumbnails, excerpts) |
| PREVIEW_MAX_BYTES | 16,384 | Max inline preview in ContentAnnounceV1 events |
| PREVIEW_THUMB_WIDTH | 200 px | Default thumbnail width for image/PDF previews |
| PREVIEW_TEXT_CHARS | 500 | Max characters for text excerpt previews |
| MAX_ASSET_LIST_ITEMS | 1,000 | Cap items per AssetListV1 (prevents unbounded events) |
| MIN_BOUNTY_SATS_DEFAULT | 50 | Default host profitability threshold for min_bounty_sats |
| SNAPSHOT_INTERVAL_EPOCHS | 100 | State snapshot every 100 epochs (~17 days) |
| ANCHOR_INTERVAL_EPOCHS | 6 | Epoch root anchored to Bitcoin every 6 epochs (~1/day) |

**Derived (not tunable)**:
- PoW difficulty: `TARGET_BASE >> floor(log2(receipt_count + 1))`
- Block selection: `PRF(epoch_seed || file_root || client) mod num_blocks`
- Pin drain_rate: `budget_sats / duration_epochs`
- Collection fan-out share: `floor(total_sats * item.size / total_collection_size)` per constituent
- Resilience score: weighted composite of replica count, host diversity, demand trend, sustainability estimate

Layer A.1 constants are tunable at the same granularity as Layer A (epoch boundaries or local). Layer B constants (vine allocation, discovery, inbox) are in `post_mvp.md`.

Start with these. Tune based on observed behavior.

---

## Longevity (Founder-Elimination Resistance)

Protocol must survive founder removal within one epoch. Work ordered by survival impact per effort.

### L1. Distribute Mint Keys (Critical, Day 1)

Give 3-5 independent Ed25519 mint keypairs to separate operators in separate jurisdictions. Each runs a stateless signing service. Founder holds 1 key, not all. Zero protocol changes — client mint-set acceptance already supports this.

**Survival**: 2+ mints continue, receipt flow uninterrupted.

### L2. Nostr-Based Host Directory

Hosts announce via Nostr events (pubkey, endpoint, pricing, served_cids, regions). Clients query relays directly. Founder directory becomes optional cache, not authority.

**Survival**: hosts keep announcing on relays, clients keep discovering them.

### L3. Dead Man's Switch (Operational Succession)

- Multi-domain DNS across registrars + `.onion` address
- 2-3 repo maintainers with push access; mirror to GitLab/Codeberg/Radicle
- Shamir-split LN node credentials (2-of-3 trusted parties)
- Operational runbooks in repo (deploy, rotate, monitor — not in founder's head)
- Timed secret release if founder doesn't check in within N days

**Survival**: successors have everything needed within 7-14 days.

### L4. Self-Verifying Protocol State

Tips and receipts are signed events — publish them (Nostr events or content-addressed objects on the blob layer). Any client can replay the log and reconstruct bounty pool balances. Founder's materialization is a cache. Ship a reference replay implementation.

**Survival**: protocol state recoverable from public data by anyone.

### L5. Permissionless Aggregation (Pull Forward from Post-MVP)

Aggregation is clerical: collect receipts, build merkle tree, publish summary. Receipts are self-verifying (sig + PoW + mint token = O(1)). Any staked party submits EpochSummary; first valid summary per (host, cid, epoch) wins 3% fee. Publish reference aggregation implementation.

**Survival**: any staked party can settle epochs. Economic loop continues.

### L6. Deterministic Builds

Nix flake or pinned Docker multi-stage build. CI verifies reproducible output. Published binary hashes alongside releases. A stranger finding the repo can rebuild and run the entire system.

**Survival**: code is verifiable and rebuildable without founder.

### L7. Epoch Root Anchoring

One Bitcoin transaction per epoch (or per day) commits a 32-byte merkle root of tips, pin-contract deltas, receipt sets, and payouts. Taproot tweak or OP_RETURN. Everything else stays off-chain but becomes auditable against that root. Anyone can verify bounty ledger history offline given published data.

The anchored epoch root also serves as the trust anchor for state snapshots (see §Event Log Growth + Compaction). A new node verifies a snapshot against the anchored root — no need to replay the full event history. This is what makes "replay from genesis" optional rather than required, enabling practical bootstrap at scale.

```
epoch_root = SHA256(epoch_summary_merkle_root || state_snapshot_hash)
```

Committed on-chain: one 32-byte value per epoch (or batched: one per day covering 6 epochs). At 1 tx/day with Taproot tweak: ~$0.50/day at typical fee rates.

**Survival**: fraud becomes detectable. Founder's accounting verifiable against Bitcoin-timestamped commitments. Snapshots verifiable without trusting the publisher.

### Longevity Test

> If founder is permanently removed at midnight: do receipts still mint (L1), hosts still discoverable (L2), portal still reachable (L3), state still computable (L4), epochs still settle (L5), code still buildable (L6), accounting still auditable (L7)? Can a new node bootstrap from a verified snapshot without the founder's coordinator (L7 + §Event Log Growth)? Every "no" is a failure.

R&D tracks (FROST threshold mints, on-chain bounty accounting, erasure coding, proof-of-storage, payment rail diversity) documented separately.

---

## Analogies

This system is: **BitTorrent + Lightning + CDN economics + Proof-of-Work receipts**

- **BitTorrent**: Content-addressed, P2P, hosts self-select
- **Lightning**: Fee market, nodes set prices, routing finds cheapest
- **CDN**: Per-GB egress, competitive market, caching emerges
- **PoW receipts**: Clients prove consumption, hosts prove service

Novel additions (Layer A):
- **Bounty pools per CID** as demand signal for replication
- **Receipt-based payouts** replace trusted verifiers with cryptographic proofs
- **Pin contracts** turn durability into a B2B market primitive
- **Receipts as portable demand** — cross-platform proof of paid consumption
- **Layer A/B split** — platform primitive (dumb blobs + paid receipts) decoupled from first-party app worldview

Layer B additions (see `post_mvp.md`): harmonic allocation, vine model, signal classes, plural discovery
