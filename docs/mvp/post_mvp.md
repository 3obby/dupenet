# Post-MVP Features

**DocRef**: SPEC:§Recovery, ROADMAP:P2+

---

## Layer B: First-Party App

**DocRef**: SPEC:§Content-Addressed, REQUIREMENTS:§Permissionless Infrastructure

Layer B builds the first-party app on top of Layer A (blob utility). It adds content hierarchy, social features, discovery, visibility signals, and messaging. Layer A must be functional before Layer B begins. External adopters never need Layer B — it's the product that exercises the full worldview.

### Implementation Order (Phase 2)

Layer B builds on Phase 1 (Layer A). Steps 6-10 below depend on a working blob utility + host network + receipt system.

**6. Bounty feed + "Fortify" button**

Deliverables:
- Tip endpoint: `tip(cid, amount, payment_proof)` → 5% protocol fee, 95% harmonic allocation across vine
- Harmonic vine allocation engine: compute `share(k) = (1/(k+1)) / H` for each ancestor
- ParentPointerV1 validation (signed, parent exists, timestamp ordering)
- Anti-depth-spam: same-publisher dampening (0.25×), ancestor host requirement (≥2), payer threshold for deep ancestors (≥2 unique tippers beyond depth 3)
- Bounty feed materialization: default view sorted by `bounty[cid]` (client-computable; founder publishes reference)
- "Fortify this CID" UI button: one-tap tip → bounty pool → visible in instrument cluster
- Topic strength derivation: `Σ bounty[cid]` for all CIDs under topic

Dependencies: Phase 1 steps 1-3 (needs content, hosts, bounty pool infrastructure)

Exit: tip 210 sats to comment at depth 5. Harmonic allocation distributes correctly across ancestors. Self-reply chain gets dampened. Bounty feed ranks by total sats committed. "Fortify" button works end-to-end.

---

**7. Paid inbox + Lightning integration**

Deliverables:
- `InboxConfigV1` per account (`min_bid`, `trusted_free`, `max_size`)
- Invoice generation: sender requests invoice from recipient endpoint
- `PaidMessageV1` delivery: payment settles → message lands in inbox
- Content encryption (to recipient pubkey)
- WoT free-pass: trusted contacts (kind:3 follow list via NDK) skip payment
- Inbox UI: sorted by amount (highest bid = most attention)

Dependencies: Phase 1 step 2 (needs LN integration for invoice/payment flow)

Exit: send paid message (21 sats). Recipient sees it in inbox. Stranger without payment gets rejected. Trusted contact messages free.

---

**8. Receipt aggregation + epoch payouts**

Deliverables:
- Aggregator service: collects `ReceiptV2` submissions per epoch (4h windows)
- `EpochSummary` construction: epoch, host, cid, receipt_merkle_root, receipt_count, unique_clients
- Payout eligibility gate: `receipt_count >= 5 AND unique_client_pubkeys >= 3`
- Score-weighted distribution: `W_CLIENTS * unique_clients + W_UPTIME * uptime + W_DIVERSITY * diversity`
- Per-CID epoch cap: `min(bounty * 2%, EPOCH_REWARD_BASE * (1 + log2(bounty/base + 1)))` — log-scaled, endowment-preserving
- 3% aggregator fee deduction from payouts
- Audit challenge support: `AuditChallengeV1` submission, hash mismatch → withhold epoch reward, 30% to challenger
- Fraud detection: cross-reference receipt volume against LN payment flow per mint

Dependencies: Phase 1 steps 1-4 (needs file layer, receipts, hosts, verification SDK)

Exit: epoch closes. Hosts with ≥5 receipts from ≥3 clients receive score-weighted payout. Bounty pool drains at expected rate (log-scaled cap). Auditor submits valid challenge → host loses epoch reward, auditor earns 30%.

---

**9. Resilience score UI**

Deliverables:
- `ResilienceScore` computation per CID: copies, ASN diversity, geo diversity, freshness_epoch, egress_capacity
- Instrument cluster per topic/CID: total sats committed, active replicas, epoch survival time, activity slope, top 5 patrons
- Per-user derived metrics: total sats across CIDs, unique CIDs tipped, identity age, early supporter hits
- UI integration: display alongside content; higher score = harder to kill

Dependencies: steps 3, 6, 8 (needs hosts, bounties, epoch data)

Exit: upload content, tip it, observe resilience score climb as hosts replicate. Score drops when host goes offline. Instrument cluster shows real-time sats/replicas/slope.

---

**10. S3-compatible adapter**

Deliverables:
- S3 protocol handler: `PUT object` → chunk → manifest → asset_root → push blocks
- `GET object` → resolve asset_root → stream blocks → reassemble
- `HEAD object` → size, MIME, pricing hints
- `DELETE object` → no-op or `SupersedesV1` pointer (content-addressed = no true delete)
- Single-tenant process (runs alongside app, translates S3 calls to blob layer)
- Auth: S3 access key maps to protocol pubkey (thin translation)

Dependencies: Phase 1 step 1 (needs file layer; can skip L402 for self-hosted adapter talking to own gateway)

Exit: point existing S3-using app at adapter endpoint. `aws s3 cp file.tar s3://bucket/file.tar` succeeds. `aws s3 cp s3://bucket/file.tar -` returns identical bytes. No code changes in the consuming app.

---

Phase 2 parallelism:

```
[6] ──────────►                (starts once hosts + bounty pool exist)
[7] ──────►                    (starts once LN integration exists; parallel with 6)
     [8] ──────────►           (starts once receipts flowing)
          [9] ────►            (starts once epoch data exists)
[10] ────►                     (can start early; only needs file layer)
```

---

### Signal Classes

Visibility metrics strengthen the protocol, not civility. Coordinated donation attacks at pressure points is the intended outcome.

Why:
- coordination ⇒ real humans
- payment ⇒ real cost
- persistence ⇒ real conviction

Rank on signals that cost money, require time, and leave permanent traces. Ignore everything else.

#### Primary Signals (Use for ranking)

| Signal | Why |
|--------|-----|
| Sats committed (tips + bounty) | Real money |
| Unique payers (not volume) | Distinct humans |
| Sustained activity over epochs | Time investment |
| Independent hosts serving asset_root (or file_root) | Replication commitment |

#### Secondary Signals (Optional)

| Signal | Why |
|--------|-----|
| Unique commenters with stake/age | Costly participation |
| Reply depth over time (not burst) | Sustained engagement |
| Top patrons per CID/topic (ranked by sats, de-duped by pubkey) | Visible costly backing |
| Early supporter ratio (tip_timestamp vs current bounty) | Discovery reward |

#### Never

- Raw impressions
- Likes
- Anonymous reactions

---

### Tip Allocation (Harmonic)

Tips allocate 95% to bounty pools using harmonic distribution across content hierarchy. 5% protocol fee funds infrastructure and development.

```
TIP_PROTOCOL_FEE = 5%   # to protocol operator
TIP_BOUNTY_SHARE = 95%  # to bounty pools (harmonic)

allocation(level_k, tip_T, depth_N) = (T * 0.95) / (k + 1) / H_(N+1)

where:
  k = 0 is target, k = N is topic index
  H_(N+1) = harmonic number = Σ(1/i) for i=1 to N+1
```

5% is below industry standard (Stripe 2.9%+30¢, Patreon 5-12%, App Store 30%). Covers bounty pool accounting, harmonic allocation computation, payout processing, fraud detection.

---

### Hierarchical Content (Vine Model)

Content exists in trees (topic → post → comments). A child without parents is orphaned context.

#### Harmonic Allocation

Tips distribute across hierarchy using harmonic series (no arbitrary percentages):

```
path = [topic, root, ..., parent, target]  // N+1 levels
H = 1 + 1/2 + 1/3 + ... + 1/(N+1)          // harmonic number

share(k) = (1/(k+1)) / H                    // k=0 is target, k=N is topic
```

**Example**: Tip 210 sats to comment at depth 20 (21 levels, H ≈ 3.68):

```
target (k=0):  210 × (1/1) / 3.68 = 57.1 sats  (27.2%)
parent (k=1):  210 × (1/2) / 3.68 = 28.5 sats  (13.6%)
k=2:           210 × (1/3) / 3.68 = 19.0 sats  (9.1%)
...
topic (k=20):  210 × (1/21) / 3.68 = 2.7 sats  (1.3%)
```

#### Minimum Tip

For every level to receive ≥1 sat:

```
MIN_TIP = ceil(H_(N+1))

depth 20:   MIN_TIP ≈ 4 sats
depth 100:  MIN_TIP ≈ 6 sats
depth 1000: MIN_TIP ≈ 8 sats
```

Minimum scales logarithmically. Deep content isn't prohibitively expensive.

#### Ancestry Validation (Anti-Depth-Spam)

Harmonic allocation across ancestry is exploitable: an attacker creates a deep fake chain (20 levels of empty/trivial nodes) to siphon bounty shares into CIDs they control. Each ancestor receives `1/(k+1)/H` of every tip to descendants — free money if the chain is fabricated. Signed parent pointers stop anonymous siphons but don't stop self-authored deep chains (same pubkey replying to itself 20 levels deep). With cheap BASE_FEE that's still viable.

**Defense is layered**: signed lineage + same-publisher dampening + host requirement + payer threshold.

##### Layer 1: Signed Parent Pointers

Every CID claiming a parent MUST include a signed parent pointer.

```
ParentPointerV1 {
  child_cid: bytes32          # the content claiming ancestry
  parent_cid: bytes32         # the alleged parent
  publisher: pubkey           # who published the child
  timestamp: u64
  sig: signature              # publisher signs (child_cid || parent_cid)
}
```

```
1. Parent CID MUST exist (registered with at least one host)
2. Parent pointer MUST be signed by child publisher
3. Parent MUST have been published BEFORE child (timestamp ordering)
4. MAX_PROPAGATION_DEPTH = 20 (hard cap regardless)
```

##### Layer 2: Same-Publisher Dampening

Ancestors sharing a publisher with the tipped CID receive a reduced share. Self-threading is legitimate but shouldn't be a free bounty multiplier.

```
effective_share(ancestor, target) =
  if ancestor.publisher == target.publisher:
    share(k) * SAME_PUBLISHER_DAMPEN    # default 0.25 (75% reduction)
  else:
    share(k)
```

Dampened share is not redistributed to other ancestors — it stays in the bounty pool. This preserves the endowment property: self-reply chains don't drain faster, they drain slower.

**Example**: Attacker builds depth-20 self-reply chain, tips leaf 210 sats:
- Without dampening: ancestors capture ~73% (~153 sats)
- With dampening: ancestors capture ~18% (~38 sats), rest stays in pool
- All 38 sats go back to CIDs the attacker already controls — net zero extraction

##### Layer 3: Independent Host Requirement

Ancestors only receive allocation if served by at least `ANCESTOR_MIN_HOSTS` independent hosts (distinct operator pubkeys). Forces real replication, not just self-hosting.

```
ancestor_eligible(cid) =
  independent_hosts_serving(cid) >= ANCESTOR_MIN_HOSTS  # default 2

# Ineligible ancestor: share stays in bounty pool
```

This is the hard gate. A self-reply siphon chain now requires the attacker to either:
- Convince 2+ independent hosts to serve each node (real replication achieved — attack succeeded but so did the protocol)
- Run 2+ staked hosts per node (40 × OPERATOR_STAKE for a 20-level chain = 84,000 sats at risk)

##### Layer 4: Unique Payer Threshold for Deep Ancestors

Ancestors beyond `ANCESTOR_SHALLOW_DEPTH` only receive allocation if the CID has tips from at least `ANCESTOR_MIN_PAYERS` unique pubkeys. Prevents farming deep ancestry shares from a single wallet.

```
ANCESTOR_SHALLOW_DEPTH = 3    # first 3 ancestors always eligible (if hosted)
ANCESTOR_MIN_PAYERS = 2       # deeper ancestors need ≥2 unique tippers

deep_ancestor_eligible(cid, depth_k) =
  if depth_k <= ANCESTOR_SHALLOW_DEPTH:
    true                      # shallow ancestors: host requirement only
  else:
    unique_payers(cid) >= ANCESTOR_MIN_PAYERS
```

**Why shallow is exempt**: Topic → root → direct parent are the core context chain. Requiring multiple payers there would break normal tipping of new content. Depth 4+ is where siphon chains live.

##### Combined Effect

All layers compose. An ancestor receives its harmonic share only if ALL conditions pass:

```
ancestor_receives_share(ancestor, target, depth_k) =
  signed_parent_pointer_valid(ancestor)       # Layer 1
  AND ancestor_eligible(ancestor)             # Layer 3: host count
  AND deep_ancestor_eligible(ancestor, depth_k)  # Layer 4: payer count
  THEN apply same_publisher_dampen(ancestor, target)  # Layer 2: reduce if same pubkey
  ELSE share stays in bounty pool
```

**Attack economics (depth-20 self-reply chain)**:
- Layer 1: 20 × BASE_FEE to publish (420-4,200 sats)
- Layer 3: 2 hosts per node × 20 nodes × 2,100 sats stake = 84,000 sats at risk
- Layer 2: 75% dampening on every ancestor share
- Layer 4: needs a second wallet tipping to unlock deep ancestors
- Net: attacker spends ~85K sats at risk to extract dampened harmonic scraps from their own tips

Self-reply chains are not banned — legitimate threading works fine. Shallow ancestors (topic/root/parent) receive shares with minimal gates. Deep self-authored ancestry just doesn't pay.

#### Topic Index Strength

Topic strength is derived (not stored):

```
strength(topic) = Σ bounty[cid] for all cid under topic
```

Emerges automatically from content strength beneath it.

#### Gold Tags for Threads

Deep threads use archive format:

```
ThreadArchiveV1 {
  root_cid: CID
  leaf_cid: CID  
  nodes: [{ cid, content, parent, children }, ...]
}
```

Gold Tag inscribes `hash(archive)`. Full thread reconstructable.

---

### Paid Inbox

**Core insight**: Lightning invoice IS the atomic payment. No custom HTLCs needed.

#### Flow

```
1. Sender creates message (encrypted to recipient pubkey)
2. Sender requests invoice from recipient's relay/endpoint
3. Sender pays invoice
4. Payment settles → message delivered to recipient's inbox
```

#### Message Format

```
PaidMessageV1 {
  from: pubkey
  to: pubkey
  amount: u64           # sats paid (informational, invoice is source of truth)
  payment_hash: hash    # Lightning payment hash (proves payment)
  content_cid: hash     # encrypted content blob
  timestamp: u64
}
```

#### Pricing (Recipient-Set)

Recipients configure their inbox:

```
InboxConfigV1 {
  min_bid: u64          # minimum sats to reach inbox (default: 21)
  trusted_free: bool    # allow free from WoT (default: true)
  max_size: u32         # max message bytes (default: 64KB)
}
```

**Why this works**:
- Spam is priced out (21 sats minimum)
- Lightning handles atomicity (no escrow, no timeouts, no refunds)
- Recipient sets their own attention price
- Trusted contacts can message free (WoT signal)

#### Interface: User → User (via Protocol)

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `request_invoice` | `(to, size_hint)` | `BOLT11` | None |
| `send_message` | `PaidMessageV1` | `ack` | Message in recipient inbox |

---

### Plural Discovery (Anti-Capture)

Keep it dumb, deterministic, hard to game. No quorum math. No optimization theater.

#### Server Sampling

1. Query top 5 directories (by freshness + stake-weighted reputation)
2. Take top N hosts per CID they report
3. De-dupe by operator pubkey

#### Content Sampling

From each directory:
1. Take top 3 items per lens
2. Merge
3. De-dupe by CID
4. Hard cap the result set

This gives:
- Plural discovery
- Capture resistance
- Predictable cost
- No "algorithm"

If someone wants to manipulate visibility, they must pay everywhere. That's fine.

#### Canon is a Follow List

- Users follow directories they trust
- Client unions/intersects based on config
- No single "official" directory
- Indexes are CIDs; "canon" is social, not protocol

---

### Topic Hashes (Embrace Ambiguity)

A "topic" is just a hash/CID. Anyone can claim meaning by attaching content. Meaning emerges from density + continuity.

Over time:
- `china` (latin) hash accretes one culture
- `中国` hash accretes another
- Forks, schisms, and parallel narratives coexist

No canonical namespace. No arbitration. No redirects. Clients help humans navigate — the protocol does not decide.

---

### Social Layer (Nostr-Native)

Follows, broadcasts, and social graph live on Nostr. Protocol stores content + payments only.

Client reads via NDK:
- kind:3 (contact list) → follow graph → personalized feed
- kind:1 (short text) → outbound broadcast of new posts (with CID link)
- kind:0 (metadata) → display names, avatars

Feed construction (client-side):
1. Read user's kind:3 follow list
2. For each followed pubkey, query recent tips + posts
3. Rank by signal classes (sats, unique payers, sustained activity)
4. Merge with topic subscriptions (topic hashes user follows)

Outbound bridge (optional):
- New posts broadcast as kind:1 to configured relays
- Include canonical link (resolver URL + CID)
- Nostr users see post; link leads to full portal experience

No protocol dependency on Nostr. Client feature only. NDK handles relay management.

---

### Instrument Cluster (Conflict Metrics)

At pressure points, show only what matters:

Per topic/CID:
- Total sats committed
- Active replicas
- Epoch survival time
- Recent activity slope (up/down/flat)
- Top patrons (pubkey + sats, capped at 5)

Per user (derived, not stored):
- Total sats committed across all CIDs
- Unique CIDs tipped
- Identity age (first_seen_epoch)
- Early supporter hits (tipped before bounty exceeded 10x their tip)

No sentiment. No "truth." No labels.

If people want to fight, they fight with money, time, and hosting. That's better than words alone.

---

### Why This Won't Spiral

Because:
- Escalation costs real sats
- Attention fragments across hashes
- No single global throne exists
- Discovery is sampled, not broadcast

Virality still happens — but it's earned, not amplified. Not suppressing conflict. Pricing it.

---

### Resilience Score (Per-CID)

Computed from verification data:

```
ResilienceScore {
  cid: hash
  copies: u16           # unique operator pubkeys
  asn_diversity: u8     # unique ASNs (optional)
  geo_diversity: u8     # unique regions (optional)
  freshness_epoch: u32  # last verification
  egress_capacity: u64  # measured serving capacity
}
```

Displayed in UI. Higher score = harder to kill.

---

### Lineage Objects (Navigate Chaos Without Governance)

First-class way to handle versioning, supersession, and attestation.

#### BundleV1 (Named Set of CIDs)

```
BundleV1 {
  id: hash                  # SHA256(canonical_serialize(this))
  name: string              # human-readable (e.g. "thread-archive-2024")
  publisher: pubkey
  cids: [hash]              # content in this bundle
  manifest: hash            # optional: CID of detailed manifest
  timestamp: u64
  sig: signature
}
```

#### SupersedesV1 (Version Navigation)

```
SupersedesV1 {
  new_bundle: hash          # points to replacement
  old_bundle: hash          # what it replaces
  reason: enum              # UPDATE | CORRECTION | REDACTION | FORK
  publisher: pubkey
  timestamp: u64
  sig: signature
}
```

Clients follow supersession chains to find latest. No governance needed.

#### AttestationV1 (Signed Claims)

```
AttestationV1 {
  target: hash              # CID or bundle being attested
  attester: pubkey
  claim: enum               # VERIFIED | MIRRORED | REDACTED_PII | MALWARE | etc
  confidence: u8            # 0-100
  evidence_cid: Option<hash>  # supporting data
  timestamp: u64
  sig: signature
}
```

**Examples**:
- "I verified this bundle matches source" (archive integrity)
- "I redacted PII from this version" (compliance)
- "This contains malware" (warning)

#### Client Behavior

- Clients decide which attestations matter (follow list of trusted attesters)
- Attestations are signals, not protocol enforcement
- Bad attesters get unfollowed (social pressure)

---

### Moat: Social Graph Accumulation

**The defensibility is not the protocol. It's the data.**

Over time, users accumulate:
- Trust relationships (who they vouch for)
- Payment history (who paid attention to whom)
- Content graph (what they created, replied to, boosted)

This graph is:
- **Portable** (user owns keys, can export)
- **Valuable** (switching cost grows with network)
- **Non-replicable** (can't fake years of organic interaction)

Protocol is open. Implementations compete. Graph is the moat.

---

### Layer B Entity Schemas

```
Account {
  pubkey: bytes32
  inbox_config: InboxConfigV1?
}

Inbox {
  owner: bytes32          # FK → Account.pubkey
  messages: [PaidMessageV1]
}

ParentPointerV1 {
  child_cid: bytes32      # content claiming ancestry
  parent_cid: bytes32     # alleged parent (must exist, must predate child)
  publisher: pubkey       # who published the child
  timestamp: u64
  sig: signature          # publisher signs (child_cid || parent_cid)
}
# Allocation skips ancestors that fail availability check (no serving host)
# Prevents depth-spam siphoning of harmonic bounty shares
```

#### Layer B Entity Relationships

| Relationship | Cardinality | Constraint |
|--------------|-------------|------------|
| Topic → CID | 1:N | CID.topic = Topic.hash |
| CID → CID (parent) | N:1 | CID.parent = CID.hash (nullable); requires signed ParentPointerV1 |
| Account → Inbox | 1:1 | Lazy-created |
| User → Follow (Nostr kind:3) | N:M | Client-side via NDK; not protocol-stored |
| Tip → Patron rank (derived) | N:1 | Top tippers per CID/topic; computed, not stored |

---

### Layer B Constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| TIP_PROTOCOL_FEE | 5% | Protocol processing fee on tips (below industry standard) |
| INBOX_MIN_BID | 21 sats | Default attention price |
| INBOX_MAX_SIZE | 64 KB | Prevent abuse |
| MAX_PROPAGATION_DEPTH | 20 | Cap vine allocation |
| SAME_PUBLISHER_DAMPEN | 0.25 | Ancestor share multiplier when same publisher as target |
| ANCESTOR_MIN_HOSTS | 2 | Independent hosts required for ancestor to receive share |
| ANCESTOR_SHALLOW_DEPTH | 3 | First N ancestors exempt from payer threshold |
| ANCESTOR_MIN_PAYERS | 2 | Unique tippers required for ancestors beyond shallow depth |
| DISCOVERY_MIN_DIRS | 3 | Client queries at least this many |
| DISCOVERY_HOST_SAMPLE | 5 | Hosts to test per CID |

**Derived (Layer B)**:
- Tip allocation: Harmonic series `1/(k+1)/H` (applied to 95% bounty share)
- MIN_TIP: `ceil(H_(depth+1))` ≈ 4-8 sats
- Topic strength: Sum of content bounties beneath

### Layer B Success Criteria

**Attention is priced**: Paid inbox filters spam. Recipients control their own price.

**Discovery uncapturable**: Multiple directories, client sampling. No single gatekeeper.

**Graph accumulates**: Trust relationships and payment history grow over time. Switching cost increases.

**Lineage navigable**: Bundles supersede cleanly. Attestations enable trust without governance.

---

## Guardian Recovery

**Scope**: Account recovery only. Message-gating is P2+.

### Problem

Private keys get lost. Seed phrases get forgotten. Hardware fails.

### Solution

k-of-n social recovery with physical co-presence proof + anti-coercion.

```
RecoveryConfigV1 {
  guardians: [pubkey; n]    # encrypted, only owner knows full list
  threshold: u8             # k required
  delay: u32                # mandatory wait period (7 days default)
  diversity_score: u8       # computed from guardian independence
}

RecoveryRequestV1 {
  old_pubkey: pubkey
  new_pubkey: pubkey
  guardian_sigs: [sig; k]   # co-signed during physical meetup
  duress_flags: u8          # silent, set by guardians
  timestamp: u64
}

RecoveryCancelV1 {
  request_id: hash
  canceller: pubkey         # owner or any guardian
  reason: enum              # OWNER_CANCEL | GUARDIAN_ALERT | DURESS_DETECTED
  timestamp: u64
  sig: signature
}
```

### Physical Co-Presence (Defeat $5 Wrench)

Recovery requires k guardians physically present. Options:

1. **Human ritual** - all tap "approve" within 60s window
2. **QR chain** - each phone scans previous, signs, displays next
3. **BLE/WiFi rendezvous** - time-boxed local network handshake

**Why physical**: Remote coercion is easy. In-person coercion is visible, risky, and requires finding k people.

### Anti-Coercion Features

#### 1. Delay + Cancel

- All recoveries have mandatory delay (default 7 days)
- Owner can cancel anytime during delay
- Any guardian can cancel + alert (notifies owner via all channels)

#### 2. Duress Mode

Guardians can "approve" under coercion but set a silent flag:

```
DURESS_FLAG = 0x01  # hidden in sig, only owner's client detects
```

If any guardian sets duress:
- Approval appears normal to attacker
- Delay silently extends (7 days → 30 days)
- Owner notified via out-of-band channel
- Recovery eventually fails or owner intervenes

#### 3. Guardian Diversity Score

Don't count guardians who share:
- Same phone plan / carrier
- Same household IP range
- Same org email domain
- Same geographic area (if known)

```
diversity_score = unique_clusters / total_guardians
```

Client warns if diversity_score < 0.6

### Constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| RECOVERY_DELAY | 7 days | Time to detect compromise |
| RECOVERY_DURESS_EXTENSION | 30 days | Extra delay when duress flag set |
| RECOVERY_THRESHOLD | 2-of-3 | Default guardian config |
| GUARDIAN_DIVERSITY_MIN | 0.6 | Warn below this score |

---

## Receipt Mint Evolution

### P1+: Competing Independent Mints

Protocol opens for competing directories, mints, and aggregators. Founder-operated services remain default, but are no longer sole.

- Multiple independent mints (each with own Ed25519 keypair)
- Clients configure which mint set they accept (follow list, like directories)
- Aggregators accept receipts from any recognized mint
- Mint misbehavior detectable via payment flow auditing
- Competing mints audit each other — same incentive structure as competing hosts

### P2+: Threshold Signatures (FROST)

Threshold signatures (FROST k-of-n) for shared mint authority. No single point of trust.

- k-of-n threshold signing for receipt tokens
- Distributed mint authority across independent parties
- Maintains O(1) verification (anyone with mint public key can verify)
- Eliminates single-operator risk

---

## Decentralization Path

### P1+: Competing Services

Protocol open for competing directories, mints, aggregators. Founder is default, not sole.

- Multiple directory operators
- Multiple receipt mints
- Multiple receipt aggregators
- Clients follow service sets (like relay sets)
- Founder competes on quality, not exclusivity

### P2+: Gossip-Based Directory

Gossip-based directory replaces centralized directory feeds.

- Distributed directory propagation
- No single source of truth
- Clients sample from multiple sources
- Founder competes on quality

Aggregator dissolves into a race: receipts are self-verifying (sig + PoW + mint token verify = O(1), no LN state). Aggregation is clerical, not adjudicative. Stake to aggregate, earn 3%, get slashed for provably bad summaries. First valid EpochSummary per (host, cid, epoch) wins the fee.

---

## Aggregator Competition

As multiple aggregators emerge, aggregation becomes a race condition:

- Receipts are self-verifying (sig + PoW + mint token verify = O(1), no LN state)
- Aggregation is clerical, not adjudicative
- Stake to aggregate, earn 3%, get slashed for provably bad summaries
- First valid EpochSummary per (host, cid, epoch) wins the fee

---

## Open Code Repository (GitHub Alternative)

The protocol primitives (content-addressed blobs, events, bounty pools, receipts, citation graph) map naturally to a code hosting platform. This is a compelling Layer B materializer application — zero protocol changes needed.

### Why the Architecture Fits

| Protocol primitive | Code hosting equivalent |
|-------------------|------------------------|
| Blocks → Manifests → AssetRoots | Git objects (blobs → trees → commits). SHA256 content addressing IS git's object model. |
| kind=ANNOUNCE | Release / tag publication |
| kind=POST (ref=repo CID) | Issue, PR comment, code review |
| kind=LIST | Branch HEAD listing, repository index |
| kind=FUND | Sponsorship / maintainer funding |
| SupersedesV1 (post_mvp) | Force push / version update / deprecation notice |
| Bounty pools | Repo sustainability funding. Pool drains to hosts serving the repo. |
| Pin contracts | Long-term maintenance: "keep this library at 5 replicas for 2 years" |
| Receipts | Honest usage signal. Each `git clone` / dependency fetch costs real sats — replaces gameable npm download counts. |
| Body edges (`[ref:bytes32]`) | Dependency graph between repos. Weighted by economic commitment. |
| Importance triangle | **The killer feature**: "this library is depended on by 200 funded projects but has zero funding itself" = **Underpriced** label. The importance index for code. |
| Author revenue share | Maintainers earn `revshare_bps` from egress + bounty on their repos. Upload a popular library → earn per clone. No begging for sponsorships. |
| Proof URLs + Bitcoin anchor | Audit trail: "this commit existed at this time, provably." Compliance, reproducible builds, supply chain verification. |
| L402 paid fetch | Premium repos, private dependencies, paid API access. Vending-first for commercial OSS. |

### What the Materializer Adds (Not Protocol)

A code-hosting materializer provides the workflows GitHub users expect. All are materializer-level views over the event stream:

- **Diff rendering**: compute diffs between AssetRoot versions (same CID-based versioning)
- **Merge/PR workflow**: kind=POST events with structured body (proposed changes, review status, merge action)
- **Branch management**: LIST events per branch HEAD; SupersedesV1 chains for history
- **CI/CD integration**: materializer triggers builds on new ANNOUNCE events, publishes results as ATTEST events
- **Code search**: materializer indexes blob contents at ingest time
- **Permission model**: materializer-enforced write access per pubkey per repo (not protocol — anyone can fork by uploading their own AssetRoot referencing the original via body edge)
- **Dependency graph visualization**: citation DAG rendered as interactive dependency tree with economic weights

### Why This Wins vs Existing Alternatives

| Alternative | What it lacks that this provides |
|-------------|----------------------------------|
| **GitHub** | Centralized, censorable, no economic demand signal, maintainers earn nothing from usage |
| **GitLab/Gitea** | Self-hosted but no economic layer; sustainability still unsolved |
| **Radicle** | P2P but no payment rails, no bounty pools, no demand intelligence |
| **SourceHut** | Opinionated but no content addressing, no economic sustainability model |

The unique value: **the importance index for open source.** No other platform answers "which libraries does humanity value enough to pay to keep alive?" The dependency graph weighted by bounty pools + receipt velocity produces a signal that npm stars, GitHub stars, and download counts cannot — because those are free and gameable. This signal is valuable to: security auditors (which dependencies are economically critical?), enterprises (which libraries are sustainably funded?), investors (which OSS projects have real demand?), and the libraries themselves (fund the Underpriced nodes before they die).

### Trigger

Build when Layer A has 50+ hosts and the blob layer handles multi-MB repos reliably. The materializer is the complex part; the protocol is ready now.

### Revenue

Same toll booths as the main platform: egress royalty (1%) on every `git clone` + pool credit royalty on repo sponsorships + materializer query fees on code search / CI / dependency analysis. Author revenue share gives maintainers a cut of every clone. The institutional API ("real-time dependency importance feed") is high-value for enterprise customers.

---

## Future Extensions

- Guardian quorum on messages (P2+)
- Cryptographic location proofs (P2+)
- Hardware attestation (P2+)
- Memory-hard PoW (Argon2id) if ASIC farming emerges
- Payment rail diversity: ecash/Cashu pool credits, on-chain settlement fallback, Fedimint, custom token (P2+). Trigger: LN routing disruption or regulatory chokepoint on LN on-ramps. No protocol change — `sats > 0` is the invariant, rail is plumbing.
- Event stream live mirroring: SSE/WebSocket subscription from coordinator for independent real-time replicas (P1+). Reduces snapshot recovery gap. Prerequisite: at least one independent party replaying events before first crisis content seeded.

---

## Interactive Signals (For Recovery/Attestation)

| Signal | Why Hard |
|--------|----------|
| k-of-n guardian actions | Requires human coordination |
| Challenge/response participation | Time-bounded, must be online |
| Physical co-presence proofs | Can't fake geography |