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
6. **Hosts serve bytes; materializers serve metadata** - Same L402 economics, same market dynamics. Materializers ingest events, build views, serve queries. The coordinator is the first materializer, not a special role.
7. **Protocol surface area is the enemy** - Proof-of-service (receipts + byte correctness + pool drains) is sacred. Everything else — threading, ranking, author payouts, moderation, discovery, pin semantics — is a materializer view, changeable without a fork.
8. **The importance index is the product** - The real-time, economically-weighted ranking of what humanity values enough to pay to preserve is a novel signal no other system produces. The protocol is the plumbing; the importance index (content ranked by economic commitment) is the product. The materializer that computes and serves this index is the primary value-creation engine.
9. **Availability has a clearing price** - The founder operates the clearinghouse matching preservation demand (funders buying replicas × time) to host supply (committed capacity). Pools are the settlement layer; preserve orders are the product layer. The clearing spread is the highest-margin toll — it doesn't taper, compounds with volume, and is naturally monopolistic (liquidity begets liquidity). Every L402 fetch auto-generates a micro-preservation-bid, making consumption mechanically fund availability at the protocol level.
10. **Durability and access are separate products** - Pools fund proof-of-holding (time-based drain via spot-checks). Egress is funded separately: L402 (paid), PoW (free-as-in-CPU), or funder-sponsored access budget. A pin that funds 1 year of replication cannot be drained early by viral free readers. Hosts are stores, not libraries — every byte served has a cost borne by someone (reader, funder, or reader's CPU).

### Trust Assumptions (MVP)

- Founder operates default directory, aggregator, receipt mints, provisioning, materializer, settler, upload escrow, clearinghouse
- Receipts accepted from founder mints only
- Architecture permits replacement at every layer; MVP exercises geographic redundancy
- **Goal is to prove market dynamics AND survive the loss of any single jurisdiction.** No single seizure, block, or arrest kills the system. Content remains retrievable, proof of existence remains verifiable, and the system can be reconstituted from portable state by strangers.

### Enforcement Audit (What's Actually Tight)

**Cryptographic (can't cheat without breaking math):** Content integrity (SHA256 == CID), receipt tokens (Ed25519 mint sig), event signatures, block selection (PRF — host can't predict), PoW on receipts.

**Economic (cheating costs more than compliance):** L402 paid fetch (real Lightning sats), PoW escalation (receipt farming gets exponential), wash trading (costs real sats = demand subsidy at cost), audit incentives (30% reward on proven fraud).

**Founder-trust (honest founder required):** Epoch settlement, pool accounting, mint operation, directory, upload escrow, author revshare verification, spot-checks, preserve clearing, auto-bid computation. All deterministic and auditable from the receipt log — anyone can recompute. But at MVP, nobody does. Competing settlers (post-MVP L5) eliminate the single-executor trust point.

**Deferred (described, not enforced at launch):** Stake verification (receipt + spot-check gates sufficient), PoW-gated free tier (#18), session/tab model (#17), access_sats budget tracking, demand-scaling PoW difficulty, review window auto-refund, staging auto-purge, dynamic base fee (EIP-1559).

**Load-bearing defenses at MVP:** Receipt system (can't earn without serving real bytes to real clients) + spot-checks (non-serving hosts delisted) + founder oversight (manual vetting at 5-20 host scale). These three compose to make Sybil registration, fake demand, and non-serving hosts unprofitable — without requiring stake.

**Survival under duress (MVP requirements):** The system must survive the loss of any single jurisdiction. Minimum viable censorship resistance:

| Requirement | Mechanism | What it survives |
|---|---|---|
| Tor hidden services | `.onion` for gateway, coordinator, web UI | IP/domain blocking |
| Multi-jurisdiction mints | ≥2 mints in different countries | Single-country seizure kills receipts |
| State snapshot + bootstrap | Portable snapshot → airgapped reconstitution | Total infrastructure loss |
| Bitcoin anchoring (L7) | Daily tx: epoch root + snapshot hash | Evidence survives destruction |
| Client peer cache | `peers.json` updated on every host interaction | Directory blocking |
| Second coordinator | Different VPS, different country, same event log | Directory seizure |
| Gateway read-only mode | Serve blocks from disk when coordinator unreachable | Coordinator seizure |
| CDN fronting | Cloudflare/CDN in front of web + gateway | Deep packet inspection |

Protocol property that enables all of the above: **content is addressed by hash, not location.** CIDs are portable. A seizure doesn't change the CID — the content reappears on any other host and is provably the same document. Money flows borderlessly via Lightning. Hosts anywhere in the world mirror content because pools are profitable. The adversary must suppress every copy, not one source.

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

**Layer A.1 — The Importance Index (the product: makes Layer A content visible, fundable, and debatable)**
- The Leaderboard: content ranked by economic commitment (pool balance × funder diversity × receipt velocity). The front page of the importance index. The primary product surface.
- Embeddable widget: compact leaderboard + Fortify button for external sites. The distribution mechanism — every embed on a news site drives funding and attention back to the platform.
- Discovery events: signed announcements that reference CIDs with human metadata (title, description, preview)
- Asset lists: signed grouping events that collect CIDs into named collections
- Signal aggregation: host scorecards, content resilience scores, author profiles — all derived automatically from protocol events (receipts, spot-checks, tips), not from ratings
- Instrument cluster: per-content dashboard showing funding counter, replica map, sustainability meter, funding trajectory, funder count + diversity
- Market quoting: host profitability thresholds enable client-side supply curve estimation
- Free preview tier: thumbnails/excerpts served without L402 to drive paid consumption
- Materializers: operators that ingest events + serve queries (same L402 economics as hosts; coordinator is the first materializer)

Layer A.1 IS the product. It produces the importance index — a real-time, economically-weighted ranking of what humanity collectively values enough to pay to preserve. No other system generates this signal. The leaderboard makes this signal visible; the embeddable widget distributes it across the web; the Fortify button converts attention into funding.

Layer A.1 does not require Layer B's social features (vine allocation, harmonic distribution, paid inbox). It sits on top of Layer A's raw blobs + economics and makes them accessible to humans and discoverable by peers. Every Layer A.1 artifact is a signed event referencing CIDs — the coordinator materializes a default view, but any peer can materialize the same state from the event stream.

**Layer B — First-Party App (exercises full worldview, see `post_mvp.md`)**
- Vine model + harmonic allocation
- Topic hashes + plural discovery
- Signal classes + instrument cluster
- Paid inbox
- Nostr social integration
- Resilience score UI
- Open code repository (GitHub alternative — content-addressed repos + bounty-funded maintenance + importance index for OSS. See `post_mvp.md` §Open Code Repository.)

External adopters use Layer A as replaceable infrastructure. They store `asset_root` pointers, outsource distribution, and never touch Layer A.1 or B. The first-party app uses all three.

**Constraint**: other platforms adopt Layer A only if they get boring HTTP tooling + SDKs and are not required to join the discovery/social layer. **Positioning**: Layer A is not commodity infrastructure — it is infrastructure bundled with demand intelligence (receipt-based consumption signal no other CDN provides). Platforms that store on Layer A get portable demand telemetry they can export. Position as "commodity storage + demand intelligence you own" — not "replaceable CDN."

### Protocol vs Materializer Boundary

Everything in the system is one of four operations: `PUT blob`, `POST event`, `SUBMIT receipt`, `SETTLE epoch`. Events are blobs (nano-blobs: single-block CIDs ≤16 KiB). Two data types: content-addressed object (blob or event — same fetch path, same economics) and receipt. One economic rule: pools drain to receipt-holders.

**Protocol (frozen-ish, must be true in 5 years)**:
- Blob addressing (blocks / manifests / asset roots) + L402 paid fetch
- ReceiptV2 + mint signatures + PoW
- EventV1 envelope (signed statement, kind byte, ref, sats — see §EventV1)
- Pool rule: `if event.sats > 0: credit pool[event.ref] += (sats - royalty)`
- Founder royalty on pool credits: volume-tapering formula (see §Founder Royalty)
- Epoch settlement: drain pools to receipt-holders serving bytes referenced by pool key
- Author revshare enforcement: conditional epoch reward — hosts prove author payment to claim (see §Author Revenue Share)
- Service fees (settlement, materialization, minting): market-determined, no hardcoded rates

**Materializer (iterable, change weekly)**:
- Event kind interpretation (what kind=0x01..0xFF means)
- Threading / parent pointers / vine model / harmonic allocation
- Reference graph: extract body edges (`[ref:bytes32]` inline mentions), build weighted citation DAG across all content
- Graph-weighted importance: economically-weighted PageRank over the reference graph (display signal, not fund transfer)
- Ranking formulas / signal aggregation / scorecards / supply curves
- Author profiles / reputation / creator bonuses (reputation is materializer-level; revshare enforcement is settlement-level — see §Author Revenue Share)
- Pin lifecycle (kind=PIN_POLICY event → materializer enforces drain caps + SLA + alerts)
- Moderation / content filtering / attester follow lists
- Discovery feeds / search / collection fan-out / cluster views (graph-neighborhood browsing)
- Thread fan-out: resolve thread from ref graph, distribute FUND events across constituent event CIDs (explicit, user-selected)
- Thread bundles: snapshot thread state as a single content-addressed object (ThreadBundleV1), fundable/pinnable as one CID
- UI skins (upvote / tip / fortify / pin are all `event.sats > 0` with different amounts)

**Author earnings model**: Protocol pays servers (receipt-holders). Authors earn by (a) self-hosting (earn as any host), (b) settlement-enforced revenue share on third-party payments, or (c) social capital (reputation → paid inbox, commissions, trust premium).

**Author revenue share (settlement-enforced)**: ANNOUNCE payload includes optional `author_pubkey` + `revshare_bps` (basis points, e.g. 1500 = 15%). Enforcement is at settlement, not materializer discretion:

```
settlement(host, cid, epoch):
  announce = ANNOUNCE(cid)
  if announce.revshare_bps > 0:
    expected = total_egress(host, cid, epoch) * announce.revshare_bps / 10000
    if host.author_payment_proof(cid, epoch) >= expected:
      pay epoch_reward normally
    else:
      withhold epoch_reward for this CID (stays in pool)
```

**Trust-minimization chain**: Receipt binds `asset_root` + `host_pubkey` + `price_sats`. ANNOUNCE binds `asset_root` to `author_pubkey` + `revshare_bps`. Expected author payment is deterministically computable by anyone from the receipt log. The only trust point is execution — the settler verifies proof of author payment (Lightning preimage to author invoice, or author signs `ReceivedV1` attestation). Competing settlers (post-MVP) eliminate even that.

**Incentive alignment**: Hosts that don't honor revshare lose their epoch reward for that CID — typically larger than the revshare they'd pocket. Cheating is unprofitable. Hosts opt in by choosing to serve content with `revshare_bps > 0`, knowing the settlement rule upfront.

Only third-party payments qualify — author's own FUND events and self-generated receipts are excluded (prevents farming loops). Default: 0 bps (opt-in). This gives uploaders a trust-minimized revenue stream without requiring them to run a host: upload → pay quote → set revshare → earn from consumption by others.

**Unified pool action**: Tip, upvote, fortify, preserve, and pin budget credits are mechanically identical at the protocol layer — `credit pool[ref] += sats`. Preserve orders add a clearing step (materializer-level escrow → epoch-boundary matching → pool credit at clearing price). Pins add kind=PIN_POLICY body with drain caps. Raw FUND events credit immediately. The protocol only sees pool credits regardless of entry path.

**Value capture (toll booths)**:

| Toll | Type | Rate | Who earns |
|------|------|------|-----------|
| Pool credit royalty | Protocol | Volume-tapering (15% → ~0%) | Founder pubkey (genesis config) |
| Egress royalty | Protocol | Flat 1% of L402 fees | Founder pubkey (genesis config) |
| Base fee (21-210 sats) | Protocol | Dynamic (EIP-1559) | Bundler/anchor |
| Egress (L402) | Protocol | Host-set (minus 1% egress royalty) | Host |
| Pool payouts | Protocol | Score-weighted | Receipt-holding hosts |
| Settlement fee | Market | Settler-set | Epoch settler |
| Materializer ingest/query fees | Product | Materializer-set | Materializer operator |
| Embed/API licensing | Product | Negotiated | Materializer operator |
| Priority replication auctions | Product | Auction (sealed-bid) | Materializer operator |
| Namespace auctions + renewals | Product | Auction | Materializer operator |
| Pin insurance / SLA policies | Product | Risk-priced | Insurer (materializer operator) |
| Provisioning surcharge | Product | Provider-set | Managed node provider |
| **Preserve clearing spread** | Product | 3% of matched preserve value | Clearinghouse operator (founder) |
| **Auto-bid pool credits** | Protocol (indirect) | AUTO_BID_PCT of L402 egress → pool credit (subject to pool credit royalty) | Founder (via royalty on auto-bid credits) |

Protocol tolls: pool credit royalty (volume-tapering) + egress royalty (flat 1%). Both to founder pubkey, both visible, both deterministic. The egress royalty aligns founder income with Flywheel A (paid marketplace) — without it, L402 commerce that dominates protocol volume generates zero passive founder income.
All service fees are market-determined — no hardcoded percentages for any operational role.
Product tolls iterate with engagement and are the primary revenue engine at scale. The clearing spread is the highest-margin product toll — it doesn't taper, compounds with transaction count, and is naturally monopolistic (orderbook liquidity attracts both sides). Auto-bids double-dip: every L402 fetch generates egress royalty (1%) AND an auto-bid pool credit (subject to pool credit royalty). Two independent income events from one fetch.

---

## Entity Model

### Layers

- **Content**: CID → AssetRoot? → FileManifest → Blocks (large objects) OR CID → single block (nano-blobs: events ≤16 KiB, small text). All content-addressed, same fetch path, same economics.
- **Proof**: Receipt (client proof) → EpochSummary → Pool drains
- **Routing**: Directory → HostList (routing only)

Events ARE content. An EventV1's canonical serialization is a content-addressed object (`event_id = SHA256(canonical(...))`). Events ≤ CHUNK_SIZE_DEFAULT are single-block "nano-blobs" — stored and fetched via `GET /cid/{event_id}` without FileManifest/AssetRoot overhead. The replication market treats a 200-byte comment and a 200-MB video identically in kind; only size changes economics.

### Core Entities

**Protocol entities** (sacred — changes require version bump):

| Entity | Identity | Mutable State |
|--------|----------|---------------|
| **CID** | SHA256(content) | None |
| **BountyPool** | pool_key (bytes32) | `balance: u64` |
| **EventV1** | SHA256(canonical(event minus sig)) | None (immutable) |
| **Receipt** | hash(content) | None (immutable) |
| **AssetRoot** | SHA256(canonical(AssetRootV1)) | None |
| **FileManifest** | SHA256(canonical(FileManifestV1)) | None |
| **EpochSummary** | (epoch, host, cid) | None (immutable) |

Pool key = bytes32. Can be CID, event_id, or topic hash. Protocol doesn't care what it references — it just credits/drains.

**Materializer entities** (views — reference materializer conventions, not protocol):

| Entity | Derived From | Purpose |
|--------|-------------|---------|
| **Host** | EventV1 kind=HOST | Directory, scoring, status lifecycle |
| **ContentAnnounce** | EventV1 kind=ANNOUNCE | Human metadata for CIDs |
| **AssetList** | EventV1 kind=LIST | Named collections |
| **PinPolicy** | EventV1 kind=PIN_POLICY | Drain caps, SLA, alerts |
| **Refusal** | EventV1 kind=REFUSAL | Operator content filtering |
| **Thread** | EventV1 kind=POST (ref chains) | Threaded discussion views |
| **Directory** | Aggregated HOST events | Host routing |
| **Materializer** | EventV1 kind=MATERIALIZER | Metadata host discovery |

### Key Schemas (Summary)

Full TypeBox schemas in `packages/physics/src/schemas/`. Key protocol entities:

- **FileManifestV1**: chunk_size, size, blocks[], merkle_root (binary Merkle tree with inclusion proofs)
- **AssetRootV1**: kind, original FileRef, variants[], thumbs[], meta. `asset_root_cid = SHA256(canonical(AssetRootV1))`
- **EventV1**: v, kind, from, ref, body (≤16 KiB), sats, ts, sig. `event_id = SHA256(canonical(minus sig))`. Protocol rule: `sats > 0 → credit pool[ref]`. Everything else is materializer policy.
- **ReceiptV2**: asset_root?, file_root, block_cid, host_pubkey, payment_hash, response_hash, price_sats, receipt_token (mint-signed bearer proof), epoch, nonce, pow_hash, client_pubkey, client_sig
- **EpochSummary**: epoch, host, cid, receipt_merkle_root, receipt_count, unique_clients
- **EvidenceExportV1** (materializer view, not protocol): Self-contained portable proof bundle (<16 KiB). Packages CID, size, MIME, title, publisher pubkey + sig, sources[] (resolved host endpoints), anchors[] (Bitcoin txid + Merkle inclusion proof from L7), attestations[] (AttestationV1 refs), integrity hash. Content-addressed (`SHA256(canonical(...))`). Produced by `dupenet export <ref>` or `GET /evidence/<ref>`. Designed for offline verification, court filings, and institutional handoff — works without protocol access. "Proof URL" resolves to a rendered EvidenceExportV1.

Receipt token: `Sign_mint_sk("R2" || host || epoch || block_cid || response_hash || price || payment_hash)`. Verification is O(1) with mint_pk. MVP: 2-3 independent mints, separate keypairs.

### Event Kind Bytes (Reference Materializer Conventions)

These are `EventV1.body` schemas the reference materializer interprets. Not protocol — other materializers may differ. New kinds require no protocol change.

| Kind | Name | ref | body | Notes |
|------|------|-----|------|-------|
| 0x01 | FUND | pool_key | empty | Tip/upvote/fortify are all FUND with different amounts |
| 0x02 | ANNOUNCE | CID | title, description, mime, tags, preview, thumb_cid, access, author_pubkey?, revshare_bps? | Human metadata for content. `access`: `"open"` or `"paid"` (default). `author_pubkey` + `revshare_bps`: optional revenue share (settlement-enforced, third-party payments only — see §Author Revenue Share). Publisher *signal*, not host *constraint*. See §Dual-Mode Host Economics, §New User Journey. |
| 0x03 | POST | parent_event_id, CID, or topic_hash | inline text ≤16KiB; may contain `[ref:bytes32]` body edges | Comment on any content (blob or event); threading via ref chains; body edges create citation graph; PoW for free, sats to boost |
| 0x04 | HOST | CID | endpoint, pricing, regions, stake | Host registration + serve announcement |
| 0x05 | REFUSAL | CID | reason enum + scope | Operator content filtering |
| 0x06 | ATTEST | CID or event_id | claim enum + confidence + evidence_cid | Third-party claims |
| 0x07 | LIST | list topic | title, items[{cid, name, mime, size}] | Named collections |
| 0x08 | PIN_POLICY | pool_key | drain_rate, min_copies, regions, duration | FUND + drain constraints; materializer enforces SLA. Foundation for preserve orders — preserve extends pins with bid aggregation + clearing + cancellability (see §Preserve Orders) |
| 0x09 | MATERIALIZER | materializer pubkey | endpoint, pricing, coverage | Metadata host discovery |
| 0x0A | PRESERVE | pool_key | tier, target_replicas, min_jurisdictions, duration_epochs, max_price_per_epoch, access_sats, access_pow_fallback, auto_renew | Preservation order (demand side). Sats escrowed until epoch-boundary clearing. `access_sats` funds free reads (separate from durability budget). Extends PIN_POLICY with aggregation + clearing spread. Materializer convention. |
| 0x0B | OFFER | pool_key | replicas, regions, price_per_epoch, bond_sats, duration_epochs | Host commitment (supply side). Bonded capacity offer matched against PRESERVE orders at clearing. Materializer convention. |
| 0x0C | UPLOAD_QUOTE | asset_root | cost_sats, review_window_epochs, included_epochs | Signed upload quote. Binding price commitment from host. Client pays to escrow; host reviews content before accepting. |

### Entity Relationships

| Relationship | Cardinality | Constraint |
|--------------|-------------|------------|
| pool_key → BountyPool | 1:1 | Created on first event with sats > 0 |
| EventV1 → BountyPool | N:1 | Events with sats > 0 credit pool[ref] |
| Receipt → Host pubkey | N:1 | Clients prove host served |
| Receipt → FileManifest | N:1 | Receipts bind to file_root + block_cid |
| AssetRoot → FileManifest | 1:N | Original + variants |
| EventV1 → EventV1 (ref) | N:1 | Threading, replies, attestations |

### Interface Boundaries

- **Client**: POST events (with sats > 0 to fund), fetch blobs (L402), mint receipts
- **Protocol**: Credit pools from events, drain pools from receipts, settle epochs
- **Operator**: Serve blobs, earn from two streams: bounty (epoch rewards from pool drain) + vending (L402 egress fees). Both always available per CID.

Flow: Client posts event with sats → Protocol credits pool → Host serves bytes → Receipt proves service → Protocol pays host

Hosts earn from both streams simultaneously. L402-paying consumers generate receipts (vending). Open-access consumers also generate receipts (bounty-funded). Settlement doesn't distinguish — all receipts count toward epoch eligibility. Harmonic allocation, threading, and author rewards are materializer policy (see `post_mvp.md`).

### Interface: Client → Protocol

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `post_event` | `EventV1` | `event_id` | If sats > 0: credit pool[ref]. Materializer indexes by kind. |
| `query_bounty` | `(pool_key)` | `u64` | None |
| `query_events` | `(ref?, kind?, from?, since?)` | `[EventV1]` | None (materializer endpoint) |
| `pin` | `EventV1 kind=PIN_POLICY` | `event_id` | Sats credit pool[ref]; PinPayload body governs drain (materializer-enforced) |
| `pin_status` | `(pin_id)` | `PinStatusV1` | None |
| `pin_cancel` | `(pin_id, sig)` | `ack` | Remaining budget returned; status → CANCELLED |

### Interface: Protocol → Operator

| Operation | Input | Output | Side Effect |
|-----------|-------|--------|-------------|
| `register_host` | `HostServeV1` | `ack` | Stake locked, status=PENDING |
| `submit_receipts` | `[ReceiptV2]` | `ack` | Receipts validated, counted |
| `claim_reward` | `(host, cid, epoch)` | `u64` | Bounty debited if receipt threshold met; settlement fee deducted (market-rate) |
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
| `PUT /block/{block_cid}?staging=true` | `bytes` | `ack` | Block stored in staging (verified, not served) |
| `PUT /file/{file_root}?staging=true` | `FileManifestV1` | `ack` | Manifest staged |
| `PUT /asset/{asset_root}?staging=true` | `AssetRootV1` | `UploadQuoteV1` | Asset staged; host returns signed quote |
| `POST /upload/{asset_root}/accept` | None | `HostServe` | Host accepts; escrow released; content goes live |
| `POST /upload/{asset_root}/pass` | `reason?` | `REFUSAL` | Host passes; staging purged; escrow refunded minus REVIEW_FEE |
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

### Upload / Ingestion (Quote-Review Model)

Hosts are curated storefronts, not dumb blob buckets. Uploaders pay for placement; hosts review before committing to serve. This gives operators legal cover, filters content before it goes live, and ensures every byte served was explicitly accepted.

```
1. Client chunks locally:
   Chunk file → CHUNK_SIZE_DEFAULT blocks
   block_cid = SHA256(block_bytes) per block
   Build FileManifestV1 → file_root = SHA256(canonical(manifest))
   Generate variants (images: client-side resize; video: paid transcoding service)
   Build AssetRootV1 → asset_root = SHA256(canonical(asset_root))

2. Client pushes to host STAGING:
   PUT /block/{cid}?staging=true, PUT /file/{root}?staging=true, PUT /asset/{root}?staging=true
   Host verifies block hashes, stores in staging (not served, not announced)

3. Host returns signed quote:
   UploadQuoteV1 { asset_root, cost_sats, review_window_epochs, host_pubkey, sig }
   Quote is binding — host cannot change price after seeing content

4. Client pays quote:
   Sats escrowed at materializer (MVP). HTLC conditioned on HostServe publication (post-MVP).

5. Host operator reviews within review_window_epochs (default 6 = 24h):
   ACCEPT → host publishes HostServe, escrow released, content goes live
   PASS   → host publishes REFUSAL, staging purged, escrow refunded minus REVIEW_FEE
   TIMEOUT → review_window expires, escrow auto-refunds in full, staging purged
```

**Uploader can submit to multiple hosts simultaneously.** Each quote is independent. First to accept serves; others can accept too (more replicas). Uploaders self-filter because PASS costs them `REVIEW_FEE`. Hosts self-filter because reviewing garbage costs time with no pay.

**Quote includes initial hosting period**: `cost_sats` covers acceptance + `included_epochs` of hosting. After that, content survives via pool economics (bounty, preserve, or uploader tops up). The quote is the first funding event — upload cost and seed funding combined.

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

### Gateway Persistence

Gateway currently stores file manifests and asset roots in in-memory Maps (`apps/gateway/src/routes/file.ts`, `apps/gateway/src/routes/asset.ts`). Content survives restarts at the block level (blocks are on disk) but manifests are lost — uploaded multi-block content becomes unretrievable until re-uploaded.

This is a prerequisite for the storefront rendering model (§Materializer Content Rendering): the web app proxies reads from the gateway server-side, which requires `GET /asset/<ref>` and `GET /file/<root>` to return data after gateway restarts.

Fix: persist manifests and asset roots to the same filesystem layout as blocks (`{base}/{h[0:2]}/{h[2:4]}/{hash}.manifest.json` or similar), or to a lightweight SQLite/JSON store. The data is small (manifests are <1 KiB typically) and write-once (content-addressed = immutable). Implementation is straightforward; the bug is purely that it wasn't done yet.

---

## Durability Ladder

All content — blobs and events (nano-blobs) — enters the same ladder. A comment starts at level 0, same as an uploaded PDF.

| Level | Mechanism | Cost | Durability | Applies to |
|-------|-----------|------|------------|------------|
| 0 | Origin only | Free | Ephemeral | All content (blobs + events) |
| 1 | Nostr relays (parallel availability) | Free | Days-weeks | Events ≤16 KiB (free extra copies, not source of truth) |
| 2 | Bundled (INDEX_ROOT anchored) | Base fee | Depends on mirror economics | All content |
| 3 | Bounty-sustained | Tips / thread fan-out flowing | Active replication market | All content |
| 4 | Gold Tag (Bitcoin inscription) | ~$10-50 | Permanent | Any CID (including event_id or thread bundle) |

Most content lives at levels 0-3. Events (comments, announcements, fund records) are first-class at every level — no promotion needed. Thread bundles (§Thread Bundles) let entire conversations be funded/pinned at levels 3-4 as a single CID. Gold Tags reserved for civilizational-collapse durability.

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

### Layer 2: Founder Royalty

Protocol-level extraction that flows to `FOUNDER_PUBKEY` in genesis config. Two components, both 100% to founder pubkey, no liveness gate, no governance, no splits:

1. **Pool credit royalty** — deducted at pool credit time: when `event.sats > 0`, royalty is subtracted before crediting `pool[ref]`. Volume-tapering (see formula below).
2. **Egress royalty** — flat 1% of all L402 egress fees, deducted at settlement, credited to `FOUNDER_PUBKEY`. Without this, Flywheel A (paid content marketplace — potentially the majority of protocol volume) generates zero passive founder income. The pool credit royalty only triggers on funding events; the egress royalty ensures founder income correlates with both flywheels.

**Formula (calibrated power-law):**

```
r(v) = r_0 × (1 + v / v_*)^(-α)

r_0   = 0.15           (15% at genesis)
v_*   = 125,000,000    (1.25 BTC — scale constant)
α     = log(2)/log(9)  (≈ 0.3155 — halves every ~10× volume)
v     = cumulative sats credited to all pools since genesis
```

**Rate schedule (exact at anchor points):**

```
Cumulative volume    Royalty rate    Cumulative founder income
0                    15.00%         0
1 BTC                10.53%         ~0.13 BTC
10 BTC               7.50%          ~0.96 BTC
100 BTC              3.75%          ~5.27 BTC
1,000 BTC            1.82%          ~26.3 BTC
10,000 BTC           0.88%          ~128 BTC
100,000 BTC          0.43%          ~600 BTC
```

**Properties (pool credit royalty):**
- Rate halves every ~10× of volume. Clean, predictable, easy to communicate.
- Starts aggressive (15% when the network is just the founder) — captures early value.
- By 100 BTC cumulative: 3.75% (below Patreon, comparable to Stripe).
- By 1,000 BTC: 1.82% (below interchange). Fork incentive is negligible.
- Asymptotically approaches zero. No floor. No sunset date.
- Volume-based, not time-based. Slow growth doesn't penalize the founder.
- Deterministic from cumulative volume. Auditable from state snapshots (L7).
- Cumulative income always increases: every new sat of volume generates founder income.
- FOUNDER_PUBKEY is in genesis config. Cannot be changed. No governance.

**Properties (egress royalty):**
- Flat 1% of L402 egress fees. Does not taper. The durable passive income floor.
- The pool credit royalty tapers to buy goodwill. The egress royalty stays flat to buy food.
- Fork defense is the data moat (accumulated graph, provenance chain, receipt history), not the rate. A 1% egress rate is invisible at the margin (5 sats/GB at default pricing) and below any threshold that justifies a fork.
- Deducted at epoch settlement from proven egress (receipt_token binds price_sats). Host receives 99% of their posted rate. Mechanically identical to the pool credit royalty — settlement-time deduction, not payment-time interception.

**Visibility:** Both royalties shown in the UI. "Protocol: X sats | Pool: Y sats" (funding) and "Egress royalty: X sats" (fetches). Transparent, small. Defense against fork narratives is the data moat + honesty, not invisibility.

**Cumulative income formula:**

```
I(V) = (r_0 × v_*) / (1-α) × [(1 + V/v_*)^(1-α) - 1]
```

### Layer 3: Earnings

```
Creators: Host their own content, earn like any host (first-mover advantage)
              Self-upload → vending stream (L402 sales). If others Fortify → bounty stream too.
Hosts:    Two earning streams, always both available:
              Bounty stream: epoch_reward from pool drain (receipt-based)
              Vending stream: L402 egress fees (host-configurable PricingV1)
              A host serving a CID earns from BOTH simultaneously.
Settlement fee: market-determined by epoch settler (no hardcoded %)
Mint fee: market-determined by receipt mints (no hardcoded %)
```

All service fees (settlement, materialization, minting) are set by operators and compete on price/quality. No protocol-mandated percentages for any operational role.

### Layer 4: Product Revenue (Materializer)

The founder's materializer (the attention surface / leaderboard) generates product-level revenue independent of the protocol royalty. These are market-priced, not protocol-mandated:

- **Leaderboard / embed widget**: per-impression for commercial embeds (free for small sites)
- **Priority replication auctions**: sealed-bid slots per epoch; convex pricing during crises
- **Pin insurance / SLA policies**: premiums priced using network telemetry; founder is default insurer
- **Namespace auctions**: scarce topic positions on the leaderboard; auction + annual renewal
- **Institutional API / intelligence**: real-time importance data; $5K-$1M/year per customer
- **Pro dashboard**: full battle terminal; $21/month in sats
- **Attestation service**: cryptographic provenance verification; per-attestation fee
- **Preserve clearing spread**: 3% of every preserve order matched through the clearinghouse. Does not taper. Compounds with transaction count. Naturally monopolistic (liquidity begets liquidity). The exchange model — fork the protocol, but the orderbook doesn't come with you.

Product revenue scales superlinearly with adoption. Protocol royalties (pool credit + egress) are the passive floor; the clearing spread is the durable middle; product revenue (auctions, insurance, API) is the active ceiling. See §Post-MVP Revenue Layers for trigger conditions and build order.

---

## Bounty Pool Mechanics

### Accumulation

Three paths for sats to enter a pool, in order of expected volume:

1. **Auto-bids from traffic** — Every L402 paid fetch generates a micro-preservation-bid: `auto_bid = price_sats * AUTO_BID_PCT`. Credited to `pool[fetched_cid]` at settlement time (subject to pool credit royalty). Open-access fetches with bounty-funded receipts generate equivalent auto-bids funded from the pool's epoch drain surplus. This makes consumption mechanically fund availability — the "attention increases availability" thesis realized at the settlement layer, not just the UX layer. Content becomes self-sustaining when auto-bid income exceeds preservation cost (see §Sustainability Ratio).

2. **Preserve orders** — Structured bids: `{cid, tier, target_replicas, duration, max_price_per_epoch}`. Multiple funders' preserve orders on the same CID aggregate into a single demand signal. Sats escrowed until epoch-boundary clearing matches demand to host supply, then credited to pool at clearing price. Uncredited sats refundable on cancellation. The materializer clearinghouse takes CLEARING_SPREAD_PCT on matched value. Preserve is the primary explicit funding product — "Preserve (Gold/Silver/Bronze)" replaces raw sats donation as the default CTA. See §Preserve Orders.

3. **Raw FUND events** — Direct `POST /event` with `sats > 0` and `ref = pool_key`. Irrevocable pool credit. The power-user / programmatic path. Tip/upvote/fortify are all FUND with different amounts. Same as before — preserve orders and auto-bids don't replace this, they layer on top.

Layer B adds harmonic vine allocation across content hierarchies (see `post_mvp.md`).

### Release

Hosts claim by proving they *hold* the content (per epoch). Pool drain is time-based, not demand-proportional:

1. Host registers: `HostServeV1 { host_pubkey, cid, endpoint, stake }`
2. Host passes spot-checks (proof-of-holding) and/or accumulates L402 receipts (proof-of-serving)
3. If spot_check_pass OR (receipt_count ≥ 1 AND total_proven_sats > 0): host earns `epoch_reward` (smooth scaling — see §Epoch-Based Rewards)
4. Ongoing: host earns egress fees per request (host-configured pricing, separate from pool drain)
5. Auto-bids from L402 traffic feed back into pool, sustaining the cycle
6. PoW-gated free reads: host serves bytes, no receipt generated, no pool effect

### Equilibrium

| Bounty Pool | Expected Copies | Economics |
|-------------|-----------------|-----------|
| 0-20 sats | 0-1 | Below viable |
| 21-100 sats | 1-2 | Hobby hosts |
| 100-500 sats | 3-5 | Small operators |
| 500-2000 sats | 5-10 | Professional hosts |
| 2000+ sats | 10+ | Commodity race |

Step-function durability emerges from host economics, not protocol rules.

### Preserve Orders (Product Layer on Pools)

A preserve order is a materializer-level product that structures how sats enter pools. Replaces "donate sats to a blind pool" with "buy an availability outcome." Pools (settlement layer) are unchanged — preserve orders control entry, not drain.

**Price unit**: `sats / replica / epoch`. This is the single price dimension. Region, jurisdiction, latency, and uptime score are constraint filters on the same market, not separate markets.

```
PreserveOrderV1 {
  cid: bytes32
  tier: GOLD | SILVER | BRONZE | CUSTOM   // preset or explicit params
  target_replicas: u8                      // Gold=10, Silver=5, Bronze=3
  min_jurisdictions: u8                    // Gold=3, Silver=2, Bronze=1
  duration_epochs: u32                     // Gold=1080(6mo), Silver=540(3mo), Bronze=180(1mo)
  max_price_per_epoch: u64                 // funder's ceiling
  access_sats: u64                         // optional free-access budget (separate from durability)
  access_pow_fallback: bool                // when access_sats exhausted, allow PoW-gated reads (default: true)
  auto_renew: bool
  funder: pubkey
  sig: signature
}
```

**Durability vs access budgets**: `max_price_per_epoch × duration_epochs` funds replication (proof-of-holding, spot-checks). `access_sats` funds free reads (consumed per-fetch, independent of durability drain). When `access_sats` exhausts, content remains durable and available via L402 or PoW (if `access_pow_fallback`). A funder who wants "this document free for 1 year" sets a high `access_sats`; a funder who wants "keep 5 copies forever, readers pay" sets `access_sats: 0`.

**Bid aggregation**: multiple funders' preserve orders on the same CID combine into aggregate demand. "93 backers requesting avg 6.2 replicas at median 40 sats/epoch." Hosts see real demand curves, not opaque pool balances.

**Clearing (epoch-boundary)**: materializer matches aggregate demand per CID against host supply (hosts serving + committed hosts). Computes clearing price. Credits `pool[cid]` at clearing price × matched replicas. Uncredited escrow refundable on cancellation minus time-value fee.

**Preserve lifecycle**: ACTIVE → draining (clearing credits pool each epoch) → LAPSED (stop renewing → order expires, content degrades to organic auto-bid level) → CANCELLED (explicit cancel, unused escrow returned). Clean exit — no "sats trapped in a dying pool."

**Coexistence with raw FUND**: preserve orders and FUND events both credit the same pool. A CID can have 5 active preserve orders AND raw FUND credits. Settlement doesn't distinguish — hosts earn from the pool regardless of how sats entered.

**Clearing spread**: materializer takes `CLEARING_SPREAD_PCT` (3%) on matched preserve value. The exchange model — founder operates the matching engine, sees all order flow, earns on every match. This toll doesn't taper (unlike pool credit royalty) and compounds with transaction count.

**Guarantee enforcement**: Preserve outcomes are guaranteed by the clearinghouse operator, not by individual hosts. The funder's SLA is with the clearinghouse. The clearinghouse monitors host availability (spot-checks, receipts), re-matches when a host fails, and uses host commitment bonds as its insurance pool for re-matching costs. If a Gold-tier preserve drops below target replicas because a host went offline, the clearinghouse re-matches from the bond pool within 1 epoch. The funder never needs to know which host failed — they just see "Gold tier maintained." If the clearinghouse itself fails, preserve degrades to best-effort spot market (same as FUND). This is why the clearinghouse position is valuable: it bears the guarantee risk, and earns the clearing spread for doing so.

**Host supply: OFFER events** (supply-side orderbook). Hosts signal committed capacity via `kind=OFFER` events: `{ ref, replicas, regions, price_per_epoch, bond_sats, duration_epochs }`. Non-bonded hosting still exists (pure spot market — hosts self-select profitable CIDs, earn from pool drain). But OFFER-bonded hosts are what the clearinghouse matches against preserve orders. Two-tier supply: commodity hosts (spot, pool drain only) and committed hosts (bonded OFFER, earn clearing price). Both coexist — the spot market bootstraps the network; committed hosts make preserve guarantees credible.

**Phasing**: MVP ships tier-based "Preserve" UX + bid aggregation display. Formal automated clearing + host commitments follow in Step 7c. Pin contracts (kind=PIN_POLICY) are the existing implementation; preserve orders extend pins with aggregation + clearing + cancellability.

### Sustainability Ratio (Derived Signal)

For each CID: `sustainability_ratio = organic_auto_bid_income / preservation_cost_at_current_replicas`. If ≥ 1.0: content is self-sustaining from traffic alone — no explicit backers needed. Displayed on every content page: "Self-sustaining" (green) | "Needs 300 more sats/epoch" (amber) | "Unfunded" (red). Novel metric — no other system measures "at what point does content earn its own survival from its audience."

---

## Protocol Enforcement + Node Operator Model

**Principle**: Slash only for cryptographic fraud. Never slash for availability (DDoS → slash = attack vector). Availability failures use earning decay — host loses income, not capital.

**Operator MUST**: serve correct bytes (`hash(response) == cid`), unbond cleanly (7-day wait).

**Stake verification (deferred until 50+ hosts)**: OPERATOR_STAKE (2,100 sats) is specified but not enforced at MVP. The receipt + spot-check system is the real Sybil gate: hosts can't earn epoch rewards without real receipts (which require serving real bytes to real L402-paying clients), and non-responding hosts are delisted via spot-check score decay (score=0 for 6 epochs → INACTIVE). At MVP scale (5-20 hosts, founder knows each), stake verification adds implementation cost without defending against a realistic threat. Stake becomes necessary when the founder can't personally vet hosts (~50+ hosts) and directory pollution degrades client UX.
**Operator MAY**: choose CIDs, set own pricing, leave anytime, serve from anywhere (public or archive mode), register multiple endpoints.

| Offense/Condition | Effect | Proof/Recovery |
|-------------------|--------|----------------|
| Data corruption (hash mismatch) | **Slash 100%** | AuditChallengeV1 with mismatched hashes |
| Forged receipt/claim | **Slash 100%** | Invalid mint sig or audit failure |
| Spot-check timeout | Score -0.2 | Recovers on next pass |
| Score < 0.6 | DEGRADED (no payouts) | Pass 3/5 checks → TRUSTED |
| Score == 0 for 6 epochs | INACTIVE (delisted) | Resume serving → re-enter as PENDING |

**Lifecycle**: Deposit → PENDING → TRUSTED (score ≥ 0.6) → earning. DEGRADED/INACTIVE hosts keep stake. Fraud → SLASHED (stake lost). Exit → UNBONDING (7 days) → stake returned.

**Availability score**: `successful_checks / total_checks` (rolling 6 epochs / 24h). TRUSTED ≥ 0.6.

**Staking (deferred)**: Not enforced at MVP. Receipt + spot-check gates are sufficient at founder-vetted scale. When implemented: custodial via LN payment to coordinator. Post-MVP: on-chain UTXO / federation / DLC escrow.

**Modes**: Public Gateway (full earnings) | Archive Only (epoch reward only, behind NAT).

**Committed hosts (post-launch, materializer-level)**: Hosts may opt into preserve fulfillment via `kind=OFFER` events with additional bond beyond the base 2,100 sat stake. Committed hosts serve specific CIDs for a duration and earn the clearing price (typically higher than residual pool drain). If they fail availability checks during an active preserve period, bond compensates clearinghouse re-matching costs. This is materializer enforcement, not protocol slashing — the protocol's "never slash for availability" principle is preserved. The commitment bond is a voluntary product-layer contract. Two-tier supply: commodity hosts (spot market, pool drain only) and committed hosts (bonded OFFER, earn clearing price). The spread between them is another founder income source via the clearing mechanism.

**Receipts**: Bind asset_root + file_root + block_cid + host + payment_hash + response_hash + epoch + client. PoW target: 2^240. Ordering forced: pay → fetch → hash → PoW → submit.

---

## Content Policy (Operator + Client)

**Principle**: No governance, no global moderation. Operators and clients each apply local policy. Slash only for fraud, never for refusal.

**Operator policy**: Operators publish `RefusalV1 { operator, target, reason, scope, sig }` — machine-readable declaration of what they won't serve. Reasons: ILLEGAL | MALWARE | DOXXING | PERSONAL | COST | OTHER. Attester-driven quarantine: follow trusted attesters, auto-deny matching claims. Encrypted blobs are opaque — policy applies over hashes + attestations, not content inspection. Node kit UX: toggle presets + attester follow lists + manual deny + import/export JSON. **Default attester list ships empty.** Operators explicitly opt into attester sets. No auto-subscribe. A non-empty default would create a centralized content policy surface weaponizable via coordinated ATTEST flooding (see §Post-MVP Assessment Queue #14).

**Client safety**: Mirrors operator model, applied locally. Pre-fetch: MIME-type gate (warn on executables), publisher signals, CID denylist. Post-fetch: SHA256 verify, magic bytes vs MIME, known-good list check. `ClientPolicyV1` is importable/exportable (same format as operator policy). No server-side scanning, no global blocklist, no sandboxing — warn and inform, never block by default.

**If all hosts refuse a CID**: show "not served" + "offer bounty to attract hosts who will." Availability market preserved.

---

## Egress Pricing (Market Decides)

Hosts set their own prices via `PricingV1`: `min_request_sats` (anti-grief floor), `sats_per_gb` (normal rate), `burst_sats_per_gb` (surge), `min_bounty_sats` (profitability threshold for mirroring), `sats_per_gb_month` (storage cost signal), `open_min_pool_sats` (minimum pool balance to serve open-access content without L402; below threshold, host falls back to paid).

**Defaults**: min_request 3 sats | normal 500 sats/GB (~$0.05/GB) | burst 2000 sats/GB. Charge = `max(min_request_sats, ceil(rate × gb))`.

### Layered Access Gating

Hosts are stores, not libraries. Every byte served has a cost. Three tiers gate access; each tier has a different payment mechanism:

| Tier | Gate | Content served | Host cost model |
|------|------|---------------|-----------------|
| **Default menu** | None (metadata only) | Titles, descriptions, thumbnails (≤16 KiB per item) | Negligible; host absorbs as storefront |
| **Preview** | PoW (~200ms, `FREE_POW_TARGET`) | Excerpts, first page, text summaries | Small; host absorbs or funder sponsors |
| **Full access** | L402 / funder-sponsored budget / high PoW | Complete content, streaming, download | Fully compensated |

**Default menu**: The storefront window. Materializer serves content listings (titles, thumbnails, prices) without L402 or PoW. Capped at `FREE_PREVIEW_MAX_BYTES` per item. This is what a new visitor sees before paying anything.

**PoW-gated free tier**: Replaces IP-based rate limiting. Client presents a valid PoW solution with the fetch request; host verifies before serving. No L402, no sats — reader pays with CPU. PoW difficulty auto-scales with concurrent demand per CID (`FREE_POW_TARGET >> floor(log2(active_readers))`). A 10-page whistleblower PDF (~5 blocks): ~1 second of compute. A 2-hour video (~4,000 blocks): ~13 minutes of CPU — naturally discourages freeloading on expensive content while remaining accessible to determined readers. Bot flooding requires sustained SHA256 grinding proportional to bytes consumed.

**PoW-gated free reads do not generate receipts and do not drain any pool.** They produce a lightweight demand marker (host-logged, not receipt-grade) that the materializer MAY use for ranking signals, but that triggers zero economic drain. This is the key separation: durability pools fund proof-of-holding; PoW reads fund nothing — the host serves them as marketing cost or declines when overloaded (429 + `Retry-After`).

**Funder-sponsored access budget**: When creating a preserve order, the funder can allocate an explicit `access_sats` budget for free reads, separate from the durability budget. Free readers consume from `access_sats`. When exhausted, content falls back to PoW or L402. The durability budget (replication + spot-check proofs) is unaffected. See §Preserve Orders.

### Dual-Mode Host Economics

The `access` field on ANNOUNCE events is publisher *intent*, not host *constraint*. Publisher says "I'd like this free" — hosts MAY honor it if the pool meets their threshold. Or not. The protocol doesn't care. Hosts are sovereign — they set their own `PricingV1` and there is no enforcement mechanism. Rather than pretending otherwise, the plan formalizes both earning streams as always-available.

**Two earning streams, always both available:**

- **Durability stream** — epoch rewards from pool drain. Hosts earn by proving they *hold* content (spot-checks). Pool drains time-based per `cidEpochCap()`, proportional to proven holding, not to fetches served. Funded by Fortify / preserve orders.
- **Vending stream** — L402 egress fees. Hosts earn per-fetch from consumers. Self-priced via `PricingV1`.
- A host serving a given CID earns from BOTH simultaneously. Durability income is independent of fetch volume — a rarely-read but well-funded document earns the same as a popular one at the same pool level. Vending income scales with demand.

**Open access (sponsored availability)**: Content served without L402 when the funder's `access_sats` budget covers it, OR when PoW is accepted. `access: "open"` on ANNOUNCE signals publisher preference (materializer convention). Hosts serve open content only if the access budget or pool justifies bandwidth cost. Below threshold, host declines or falls back to L402. Content drops from free to paid when funding dries up. No charity, no free CDN — sponsored or PoW-gated availability.

**Host self-upload (vending-first):** A host uploads content to itself (skips quote-review — operator IS the reviewer), announces with `access: "paid"`, sets pricing via `PricingV1`. No bounty pool needed — they earn from direct L402 sales (vending stream). If others Fortify the content later, the host earns durability rewards too. **Third-party upload (quote-review):** An external uploader pushes content to staging, receives a quote, pays, and waits for host review (see §Upload / Ingestion). Uploader sets `revshare_bps` in ANNOUNCE; host earns epoch rewards only if they prove author payment (see §Author Revenue Share). Both paths compose: upload → content live → earn per fetch.

**Receipt economics by access tier:**

| Access tier | Receipt generated? | Pool drain? | Auto-bid? | Demand signal? |
|-------------|-------------------|-------------|-----------|----------------|
| L402 (paid) | Yes (full ReceiptV2) | No (pool drains time-based) | Yes (`AUTO_BID_PCT`) | Full economic signal |
| Funder-sponsored | Yes (receipt_token from access budget) | Access budget only (durability untouched) | No | Moderate signal |
| PoW (free-as-in-CPU) | No | No | No | Lightweight marker only |

**Auto-bids from traffic**: Every L402 paid fetch generates `auto_bid = price_sats * AUTO_BID_PCT` credited to `pool[fetched_cid]` at settlement. PoW-gated free reads do NOT generate auto-bids (no sats involved). This means only economically committed consumption (L402) feeds the sustainability loop: paid consumption → auto-bid → pool growth → more hosts → better serving → more consumption. Content becomes self-sustaining when auto-bid income exceeds preservation cost at current replica level (see §Sustainability Ratio). Auto-bid pool credits are subject to the standard pool credit royalty.

UI: PoW-gated content pages show "Free to read (PoW), pay to preserve." Paid content pages show price tag + Buy button (cheapest host). Funder-sponsored content shows "Free (sponsored by N funders, X sats remaining)." The conversion event for free content is Fortify, not L402.

**Client behavior**: query cheapest host meeting minimum resilience score, show estimated cost, failover on timeout. Creates competition without governance.

---

## Epoch-Based Rewards

Replace one-time `copy_bonus` with continuous stream. Receipt-based, not committee-based.

### Epoch Structure

```
EPOCH_LENGTH = 4h
```

Shorter epochs = faster host payouts, better cash flow for small operators. 6 payout cycles/day.

**Dual proof model**: Hosts prove both *holding* (spot-checks — durability) and *serving* (receipts from L402/sponsored fetches — demand signal). Pool drain is time-based per `cidEpochCap()` regardless of fetch volume. Receipts determine the *split* among eligible hosts (who gets what share of the cap), not the drain *rate*. More fetches = larger share of a fixed cap, not faster drain. PoW-gated free reads produce no receipts and have zero effect on settlement.

Host earns for a CID in an epoch proportional to proven service (L402 receipts + spot-check passes):

```
PAYOUT_ELIGIBLE(host, cid, epoch) if:
  receipt_count >= 1          AND
  total_proven_sats > 0       AND
  each receipt includes valid payment_hash

PAYOUT_MULTIPLIER(host, cid, epoch):
  base = total_proven_sats                    (economic floor — cost is the real defense)
  client_bonus = 1 + log2(unique_clients)     (smooth bonus for client diversity)
  payout_weight = base * client_bonus
```

Receipt token (bearer proof from mint) is the gate. PoW receipts are anti-sybil plumbing.

**Smooth scaling, not cliff gates.** Previous design used a hard 5/3 threshold (5 receipts, 3 unique clients) as a binary eligibility gate — creating cliff-gaming incentives. The smooth multiplier replaces this: payouts scale with proven sats spent (economic cost is the real defense), with a logarithmic bonus for client diversity. One receipt from one client earns a small payout. Five receipts from five clients earns significantly more. No cliff, no gaming discontinuity. Long-tail content earns proportionally less — same graceful degradation, smoother economics.

### Reward Formula

Per-CID per-epoch cap scales logarithmically with bounty, then splits among eligible hosts by score.

**Design intent**: Large bounties act as endowments — they sustain replication over long timescales rather than draining fast. The log-scaled cap is the release valve: bigger bounties do attract more replication, but sublinearly. A 100x bounty produces ~2x the per-epoch incentive, not 100x. This prevents whale-funded CIDs from monopolizing host attention while still rewarding larger pools more than small ones.

```
EPOCH_REWARD_BASE = 50 sats

cid_epoch_cap = min(bounty[cid] * EPOCH_REWARD_PCT,
                    EPOCH_REWARD_BASE * (1 + floor(log2(bounty[cid] / EPOCH_REWARD_BASE + 1))))

score(host) = payout_weight(host)
            * (W_UPTIME  * uptime + W_DIVERSITY * diversity)

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

### Session / Tab Model (Streaming + Batched Payment)

Per-block L402 invoicing is unusable for streaming media (a 1 GB video = ~4,000 blocks = ~4,000 Lightning round-trips). The session model batches payment into a "bar tab":

```
1. Client opens session: POST /session {cid, budget_sats, pubkey}
2. Host returns: {session_id, blocks_covered, expires_at}
3. Client fetches blocks: GET /block/{cid}?session={session_id} (no L402 per block)
4. Host serves bytes, decrements session balance
5. When balance low: client tops up (POST /session/{id}/topup {sats})
6. Session closes: host mints receipts in batch (one per block served)
```

The session is host-level state, not protocol. Receipts are still per-block (for epoch settlement). Only the *payment* is batched. Session tokens are bearer credentials — revocable, expiring, host-scoped. No protocol change required.

**Seek-aware playback**: `FileManifestV1` blocks are sequential byte ranges. For media files (MP4, WebM), the first block(s) contain the container header (`moov` atom, etc.). Client reads the header, computes time-offset-to-block-index mapping locally. AssetRoot `variants[]` supports multiple bitrates. Adaptive bitrate switching is a client-side decision — fetch blocks from a different variant mid-session. The host doesn't care which variant or block order the client requests.

**QoS under load**: When a host is at bandwidth capacity, it returns `429 Too Many Requests` + `Retry-After`. Client failovers to another host (directory has multiple hosts per CID). Hosts MAY implement priority queuing by session `budget_sats` — higher-paying sessions get priority. This is host policy (`PricingV1`), not protocol.

**PoW sessions (free streaming)**: Same session flow, but opened with PoW instead of L402. Client presents PoW per session (not per block), covering N blocks. PoW difficulty scales with session size — a 10-block document session is ~2 seconds; a 4,000-block video session is substantial compute. Free streaming sessions do not generate receipts and do not drain any pool.

### Host Self-Farming

Hosts can pay themselves + compute. That's explicit demand subsidy, not free.

For ranking, weight receipts by:
- Client pubkey age (accumulated history)
- Distinct clients (not just distinct pubkeys)
- Interaction graph breadth (real users touch many CIDs/hosts; puppet clients are narrow)

Wash trading is self-limiting: profitable only when bounty is high AND real demand is absent — a narrow, unstable band. At scale, self-farming is demand subsidy at cost.

### Receipt Privacy

Receipt submission is opt-in (§Fetch Flow step 7). Casual readers pay L402, get bytes, leave — no receipt exists, no protocol-level tracking. Privacy exposure for non-submitters: host sees the request (same as any website), LN routing sees payment flow (same as any Lightning purchase).

For clients who opt into receipt submission, `ReceiptV2` binds `client_pubkey` to content consumed (`block_cid`, `file_root`, `asset_root`), host, epoch, and payment. A persistent `client_pubkey` across submissions creates a consumption history visible to the aggregator (MVP: founder) and potentially public (if receipts published for L4 self-verifying state).

**Mitigation: clients SHOULD use ephemeral pubkeys for receipt submission.** Generate a one-time Ed25519 keypair per receipt batch. This breaks cross-session linkage without changing the receipt schema.

**Why this doesn't weaken anti-sybil**: `client_pubkey` identity was never the hard defense. Key generation is free — any attacker already bypasses PoW difficulty escalation by rotating keys. The load-bearing anti-sybil mechanisms are economic (each receipt costs real L402 sats + requires real `receipt_token` from mint + requires real `response_hash` from fetched bytes). These hold regardless of pubkey persistence. `RECEIPT_MIN_UNIQUE` (3 distinct pubkeys) is a tripwire for lazy self-farmers, not a wall — three throwaway keypairs cost zero.

**Signals that resist sybils without client identity**: payment diversity (distinct `payment_hash` from distinct LN flows — requires real liquidity), temporal spread (receipts across epochs vs burst), interaction graph breadth (real users touch many CIDs/hosts; puppets are narrow), total sats spent (economic cost regardless of identity).

**MVP trust point**: the aggregator sees all submitted receipts. Same custodial trust assumption as stake, mints, directory. Post-MVP, permissionless aggregation (L5) lets clients choose aggregators — no single aggregator has the complete picture. Blinded/bearer receipt variants (Cashu-style) are the long-term direction for zero-knowledge demand proofs; not needed while aggregator is already a trusted coordinator.

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
  materializers: [MaterializerV1]  # metadata hosts — same discovery as blob hosts
  timestamp: u64
  sig: signature
}
```

`refusals_cid` links to operator's RefusalV1 feed. Client filters before routing. `materializers[]` lists metadata hosts that ingest events and serve queries — clients choose a set (like DNS resolvers or Nostr relays).

---

## Event Layer

Every meaningful protocol action is a signed EventV1 referencing a CID (or event_id or topic hash). Events propagate via gossip (Nostr relays, peer exchange). Materializers build views; the founder materializer is the first, not the authority.

### Protocol vs Materializer

The protocol processes exactly one thing from events: **pool credits** (`sats > 0 → credit pool[ref]`). Everything else — kind interpretation, threading, ranking, moderation, pin lifecycle — is materializer policy.

Receipts and epoch summaries are NOT events. They are protocol-level verification objects with their own submission paths (POST /receipt/submit, POST /epoch/settle). They don't use the EventV1 envelope.

### Event Ingestion

```
MVP:     POST /event on founder materializer.
         Materializer validates sig, indexes by kind, credits pool if sats > 0.
         One endpoint replaces POST /tip, POST /content/announce, POST /host/register, etc.

Future:  Events published to Nostr relays (NIP-compatible kind numbers).
         Multiple materializers subscribe to relays, ingest events, serve queries.
         Materializers compete on coverage, freshness, query quality, price.
         Economic model: ingest fees from publishers (POST /event → L402) +
                         query fees from consumers (GET /events → L402).
```

### Peer Discovery (How a New Node Bootstraps)

```
1. Bootstrap:   Know at least one materializer URL or Nostr relay (hardcoded or DNS-seeded)
2. Catch-up:    GET /events?kind=HOST&since=... → who serves what, at what price
                GET /events?kind=FUND&since=... → what CIDs have been funded recently
                GET /events?kind=ANNOUNCE&since=... → human metadata for CIDs
3. Materialize: Replay events to build local views (pools, host directory, content index)
4. Filter:      Selective sync by bounty level, content type, region, recency
5. Participate:  Mirror profitable CIDs, publish own HOST events
```

The coordinator's `GET /bounty/feed` (used by node-agent today) is a materialized view over FUND events. Any peer with the event stream can compute the same feed.

### Event Log Growth + Compaction

**Problem**: Unbounded event stream. "Replay from genesis" becomes impractical at scale.

**Solution**: Periodic `StateSnapshotV1` (merkle roots of pools, hosts, content, serves, pins) anchored to Bitcoin via epoch root (L7). New nodes bootstrap from snapshot + recent events. Inclusion proofs make snapshots verifiable without replaying the full stream. Receipt rollups compact the highest-volume event type — only aggregates (merkle root, count, unique clients) propagate; raw receipts archived for audit.

**Bootstrap**: Obtain snapshot → verify against Bitcoin-anchored root (trustless) or publisher sig (TOFU) → replay events from snapshot epoch to current → participate.

**MVP**: Single coordinator, Postgres, no compaction needed (volume is small). **At scale**: periodic snapshots, receipt rollups, event pruning, sharded streams. Design the snapshot format now so the transition is configuration, not architecture. See Sprint 7b for implementation details.

### Content Grouping

Collections are signed events, not protocol entities. The blob layer stays dumb.

- Uploader publishes kind=LIST event grouping CIDs with human-readable names
- Anyone can publish their own list referencing the same CIDs (different curation, different metadata)
- Funding a collection = materializer fan-out: resolve list → credit each constituent pool (strategy-selected)
- Bounty pools remain per-CID (hosts don't need to understand collections)

Multiple announcements and lists for the same CID are expected. Metadata quality is a service — better metadata drives more consumption, more consumption drives more receipts.

### Durability Model (Unified — Events Are Blobs)

There is one content plane, not two. Every content-addressed object — whether a 200-MB video or a 200-byte comment — enters the same replication market with the same economics. The only variable is size (which changes storage cost) and funding (which changes replica count).

**Events are nano-blobs.** An EventV1's canonical serialization is already content-addressed (`event_id = SHA256(canonical(...))`). Events ≤ CHUNK_SIZE_DEFAULT (16 KiB body) are stored as single-block CIDs — no FileManifest, no AssetRoot. Hosts serve them via `GET /cid/{event_id}`, earn egress and epoch rewards like any other content. A comment is born as a content object, not promoted into one. No class system, no promotion threshold, no materializer gate.

**Nano-blob fetch path:** `GET /cid/{event_id}` returns the canonical EventV1 bytes directly. Same L402 gate, same receipt minting, same bounty pool economics. The only difference from large files: no chunking overhead. This is the `GET /cid/{hash}` path (§Interface: Client → Operator) applied to event content.

**Hierarchy aids discovery, never governs survival.** Graph structure (threads, collections, citations) helps humans navigate. It never creates survival dependencies. A reply can outlive its parent. A correction can outlive the original. A comment linking two documents can become the most important node. Each node's pool funds its own persistence independently.

**No automatic redistribution.** Funding a parent does not automatically flow to children. Funding a thread root does not auto-fund replies. If someone wants a comment preserved, they fund that comment's pool. Collection fan-out (§Collection Fan-Out) and thread fan-out (§Thread Fan-Out) are explicit, user-selected, per-action — not standing policies. No spillover, no subscriptions, no speculative funding of future content.

**Thread fan-out (explicit conversation-level funding).** "No automatic redistribution" is a protocol invariant, but the UX must not make preserving a conversation require N individual actions. The materializer offers a "Fund Thread" action: resolve all events reachable via ref-chain from a thread root, distribute FUND events across constituents using a selected strategy (equal, recency-weighted, importance-weighted, manual). The protocol sees only individual FUND events per event CID. The fan-out is client/materializer policy, identical in mechanism to collection fan-out. See §Thread Fan-Out.

**Nostr relays as parallel availability.** Events published to Nostr relays (NIP-compatible kind numbers) gain free extra copies on an independent, already-decentralized network. Relays are treated as supplementary availability — the system must fully function with only the blob + host market. Relays are not the source of truth; they are free redundancy for small content.

### Reference Graph (Citation DAG)

Every addressable node (CID or event_id) is independently funded, independently replicated, and indexed as a vertex in a weighted directed citation graph. Importance is computed from the graph, not from containers.

**Nodes**: blobs (keyed by CID) and events (keyed by event_id). Both have their own pool. Both can be funded directly.

**Edges** (three types, all derived from events):

| Edge type | Source | Created by |
|-----------|--------|------------|
| **ref edge** | `event.ref` field | Automatic — every event points to one parent |
| **body edge** | `[ref:bytes32]` mentions parsed from POST/ANNOUNCE body | Materializer extracts at ingest time |
| **list edge** | LIST payload items | Each item creates an edge from list event to constituent CID |

The materializer builds this graph incrementally as events arrive. Every edge is a signed, timestamped, economically-weighted statement.

**Universal engagement**: kind=POST with `ref = CID` allows commenting directly on any blob. kind=POST with `ref = event_id` allows replying to any event (comment, announcement, list, other post). All content is equally commentable — documents, comments, collections, attestations. A comment on a comment is the same action as a comment on a document. The ref field is the only distinction.

**Body edge convention**: inline `[ref:bytes32]` tokens in POST/ANNOUNCE bodies. The materializer extracts these and creates graph edges. This is a materializer convention, not protocol. Example: "The deposition at `[ref:a1b2c3...]` contradicts the flight log at `[ref:d4e5f6...]`" creates two body edges. The author's comment becomes a bridge node linking two documents.

**Graph-weighted importance** (materializer-computed, display signal only):

```
importance(node) = direct_pool(node)
                 + Σ (edge_weight × importance(neighbor)) × decay
```

Edge weight = sats on the event that created the edge. Decay dampens with hop distance. This is PageRank with economic weights. A funded comment referencing a document increases the document's graph importance without transferring sats to its pool. Display-layer boost, not fund-layer transfer.

**Two scores, always visible**: direct pool (drives host economics / redundancy) and graph importance (drives discovery / leaderboard rank). A node with low direct pool but high graph importance is "underpriced" — structurally central but not yet funded proportionally. The divergence is transparent.

**Events are blobs from birth** (see §Durability Model). No promotion step. A comment's `event_id` IS a CID. Hosts serve it, earn from it, compete for its bounty pool — identical economics to a PDF or video. A funded comment is as durable as the document it's attached to; an unfunded comment persists at durability level 0 (origin-only) and degrades gracefully like any other unfunded content. Retraction is additive: author publishes a correction POST with ref=own_event_id; both exist; the original persists if others fund its pool.

**Cluster view**: `GET /cluster/<ref>?hops=N` returns all nodes reachable within N hops via any edge type, ranked by importance. "Show me everything economically connected to this deposition." The information neighborhood, not an arbitrary flat list.

**Emergent structure**: over time, the citation graph self-organizes. Heavily-referenced documents become primary sources (high in-degree). Comments synthesizing multiple documents become bridge nodes (high betweenness). Clusters of mutual references become research fronts. No curation needed — topology IS knowledge organization.

**Orphan detection**: high direct pool, low graph connectivity. The materializer surfaces these as "needs analysis" — documents with funding but no discussion. First analysts earn positional advantage in the graph (their comments become the only bridges).

### Collection Fan-Out (Funding a List or Cluster)

Client selects a distribution strategy when funding a collection or cluster. The protocol sees individual FUND events per constituent — strategy is materializer + client policy.

```
fund_collection(list_event_id, total_sats, strategy):
  items = resolve(list_event_id)               # LIST items or cluster nodes

  if strategy == SIZE_WEIGHTED:
    share(item) = floor(total_sats * item.size / total_size)
  elif strategy == EQUAL:
    share(item) = floor(total_sats / len(items))
  elif strategy == DEMAND_WEIGHTED:
    share(item) = floor(total_sats * item.receipt_velocity / total_velocity)
  elif strategy == IMPORTANCE_WEIGHTED:
    share(item) = floor(total_sats * item.graph_importance / total_importance)
  elif strategy == MANUAL:
    share(item) = client_specified_allocation[item]

  for item in items:
    fund(item.ref, share(item))                # individual FUND event per constituent
```

| Strategy | Logic | When to use |
|----------|-------|-------------|
| **Size-weighted** | Proportional to byte count | "Keep these files alive proportional to storage cost" |
| **Equal** | Even split | "I value these equally" |
| **Demand-weighted** | Proportional to receipt velocity | "Amplify what people are already consuming" |
| **Importance-weighted** | Proportional to graph-weighted importance | "Fund what the citation graph says matters most" |
| **Manual** | Client specifies per-item allocation | Power users, targeted intervention |

Default: size-weighted (backward-compatible). Demand-weighted and importance-weighted require materializer signal endpoints (§Signal Layer).

### Thread Fan-Out (Funding a Conversation)

Same mechanism as collection fan-out, applied to a thread root. The materializer resolves the ref-chain DAG from a thread root, then distributes FUND events across constituent event CIDs. The protocol sees only individual FUND events — thread resolution is materializer + client policy.

```
fund_thread(thread_root_event_id, total_sats, strategy):
  events = resolve_thread(thread_root_event_id)   # all events reachable via ref chains

  if strategy == THREAD_EQUAL:
    share(e) = floor(total_sats / len(events))
  elif strategy == THREAD_RECENCY:
    share(e) = floor(total_sats * recency_weight(e.ts) / total_recency)
  elif strategy == THREAD_IMPORTANCE:
    share(e) = floor(total_sats * e.graph_importance / total_importance)
  elif strategy == THREAD_DEPTH:
    share(e) = floor(total_sats * (1 / (1 + depth(e))) / total_depth_weight)
  elif strategy == MANUAL:
    share(e) = client_specified_allocation[e]

  for e in events:
    fund(e.event_id, share(e))                     # individual FUND event per constituent
```

| Strategy | Logic | When to use |
|----------|-------|-------------|
| **Thread-equal** | Even split across all events in thread | "I value this entire conversation" |
| **Thread-recency** | Weighted toward recent replies | "Keep the discussion alive at the frontier" |
| **Thread-importance** | Proportional to graph-weighted importance | "Fund the most structurally central comments" |
| **Thread-depth** | Weighted toward root + early replies (1/depth decay) | "Preserve the core argument, let tangents degrade" |
| **Manual** | Client specifies per-event allocation | Power users |

Default: thread-equal. This is the "Fund Thread" button UX — one click preserves an entire conversation. The action is explicit (user chose to fund the thread), the distribution is transparent (show per-event allocation before confirming), and the protocol sees only standard FUND events.

### Thread Bundles (Atomic Conversation Snapshots)

A thread bundle is a content-addressed snapshot of a conversation at a point in time. It solves "preserve this discussion right now" as a single fundable/pinnable object.

```
ThreadBundleV1 {
  thread_root: event_id          // root event of the thread
  events: [EventV1]              // all events in thread at snapshot time (ordered by ref-chain)
  merkle_root: bytes32           // merkle root of event_ids (verifiable completeness)
  snapshot_epoch: u64            // when the snapshot was taken
  bundler: pubkey                // who created the bundle
  sig: signature                 // bundler's attestation of completeness
}
```

The bundle's canonical serialization gets a CID. It enters the replication market as a single object. Funding the bundle CID preserves the entire conversation atomically — hosts serve the bundle, earn from it, compete for its bounty pool.

**Completeness proof**: anyone with the constituent events can recompute `merkle_root` and verify the bundle contains exactly the events claimed. Missing events produce a different root.

**Self-verifying thread integrity**: because `event.ref` is inside the hashed event identity, the thread DAG is reconstructable from the bundle's events alone. No materializer needed to verify structure — follow ref pointers, check that every ref resolves to another event in the bundle (or to an external CID for root-level comments on blobs).

**Snapshot vs live**: bundles are point-in-time snapshots. New replies after the snapshot are not included. To update, create a new bundle (new CID). Both versions can coexist; the newer bundle supersedes the older for completeness but doesn't invalidate it.

**Crisis use case**: during a censorship spike, a single "Fund Thread Bundle" action preserves the full discussion state. One CID, one pin contract, one bounty pool — hosts replicate the whole conversation.

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
| Organic auto-bid income | `Σ(auto_bid)` per epoch from traffic receipts | How much consumption alone funds this CID |
| Sustainability ratio | organic_auto_bid_income / preservation_cost | ≥1.0 = self-sustaining from traffic alone; <1.0 = needs explicit backers |
| Active preserve backers | Count + aggregate tier of active preserve orders | Coalition size + commitment level (stronger signal than one-time tips) |
| Graph importance | Weighted PageRank over citation DAG (ref edges + body edges + list edges) | Structural centrality — how referenced by funded analysis |
| In-degree (funded) | Count of funded events whose ref or body edges point here | How many paid statements cite this node |
| Orphan score | High direct pool + low graph connectivity (few inbound ref/body edges from funded events) + low discussion depth (few/zero kind=POST replies) | "Funded, but under-analyzed" — content with economic commitment but no discourse. Analyst job board. |

Composite **resilience score** = weighted formula over direct pool inputs. Client-computable, auditable, not authoritative.

**Graph importance** is a separate score from resilience. Resilience = "will hosts keep this alive?" (direct pool driven). Graph importance = "is this structurally central to funded discourse?" (citation driven). Both displayed; neither subsumes the other.

**The importance triangle**: Three axes, always visible on every content page. The divergence between them IS the product — it creates games people play with money.

| Axis | Source | What it measures |
|------|--------|-----------------|
| **Commitment** | Pool balance (FUND events) | How much money is behind this |
| **Demand** | Receipt velocity (fetches/epoch) | How much people are reading this right now |
| **Centrality** | Graph importance (citation DAG) | How structurally connected this is to other funded content |

**Divergence labels** (materializer-computed, shown on content pages and leaderboard):

| Label | Condition | Meaning | Game it creates |
|-------|-----------|---------|-----------------|
| **Underpriced** | High centrality + low pool | Structurally central but not yet funded proportionally | "This node is a bargain — fund it before others do" |
| **Flash** | High demand + low pool | Lots of readers, no durable funding | "Popular right now — will it survive? Fund to lock it in" |
| **Endowed** | High pool + low demand + low centrality | Funded but under-analyzed and under-read | "₿2,000 bounty, zero analysis — be the first" (analyst gold rush) |

Labels are computed from percentile ranks across each axis. A node is "Underpriced" if centrality > 75th percentile AND pool < 25th percentile. Labels are mutually exclusive (highest-signal wins). Most content has no label (median on all axes = unremarkable).

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
| Graph manipulation (link farming) | Each body edge costs base_fee + sats; edge diversity weighted by funder count, not just sats; burst edges dampened by temporal spread; star-topology anomalies flagged; direct pool and graph importance shown separately (divergence is transparent) |

All positive signals are economically costly to produce. Self-promotion is taxed, not prevented. At scale, self-farming is demand subsidy at cost (same principle as receipt anti-sybil: §Host Self-Farming). Graph manipulation is analogous: creating fake citation structure costs real money per edge and produces transparent anomalies in the two-score display.

---

## Upgradability

### Freeze Layers

| Layer | Examples | Changeability |
|-------|----------|---------------|
| **Frozen** | SHA256 for CIDs, canonical serialization rules, CID semantics | Never. Change breaks all interop. |
| **Versioned** | EventV1 envelope, ReceiptV2, AssetRootV1, PricingV1 | Additive only. V1 never changes; publish V2 alongside. |
| **Tunable** | EPOCH_LENGTH, thresholds, reward caps, royalty parameters, all constants | Change at epoch boundaries. |
| **Materializer** | Kind byte interpretation, payload schemas, threading, ranking, pin lifecycle, author rewards, moderation | Each materializer decides. Change at will. |
| **Local** | Client ranking, host pricing, discovery config, attester follow lists | Each party decides. No coordination. |

Minimize frozen surface. Event kind payloads (AnnouncePayload, HostPayload, ListPayload, PinPayload, etc.) are materializer conventions, not protocol. New kinds require no protocol change.

### Wire Rules

- `version: u8` in every schema, every API response, every epoch summary. Non-negotiable.
- Unknown fields: preserve, don't reject. Additive changes are free.
- Epoch boundaries as upgrade gates: "aggregator requires ReceiptV3 after epoch N." Node kit auto-updates; third parties get advance notice.

### Royalty Curve Properties

The founder royalty is volume-based, not time-based (see §Founder Royalty). Rate halves every ~10× of cumulative pool volume. No calendar trigger, no governance vote, no manual adjustment. The rate is a deterministic function of cumulative volume — auditable from state snapshots. Slow growth doesn't penalize the founder; fast growth doesn't penalize users. The formula is in genesis config and cannot be changed.

### Solo Founder Window

While founder controls all roles (client, aggregator, node kit), Layers 2-4 are cheap to change. Schemas shipped at "1.0" (when third parties build on them) become expensive to change. Exploit the MVP window for iteration; freeze deliberately.

---

## Implementation Order

Layer A (platform primitive) ships first. Layer B (first-party app) builds on top.

### Phase 1: Blob Utility (Layer A) — COMPLETE

Steps 1-5 (file layer, L402, node kit, receipt SDK, pin contracts) are fully implemented and tested. See `progress_overview.txt` for detailed deliverables, test counts, and status.

Phase 1 creates the platform primitive: content-addressed blob store + L402 paid fetch + host economics + pin contracts + receipt verification. External adopters can use it as a CDN replacement / paid origin / durability market without touching Layer B.

---

### Phase 1.5: EventV1 + Reference Materializer

Collapses previous "Layer A.1" into: one protocol primitive (EventV1) + one reference materializer implementation. Event kind payloads are materializer conventions, not protocol. No VPS dependency — buildable in parallel.

**6. EventV1 envelope + kind conventions**

Deliverables:
- EventV1 TypeBox schema in physics (v, kind, from, ref, body, sats, ts, sig) — canonical, signable
- Event ID computation: `SHA256(canonical(EventV1 minus sig))`
- Pool credit rule: `if sats > 0: credit pool[ref] += sats`
- Kind byte constants (0x01-0x09 for reference materializer, see §Event Kind Payload Conventions)
- Kind payload TypeBox schemas: AnnouncePayload, HostPayload, ListPayload, PinPayload
- Existing POST /tip, POST /host/register, POST /content/announce collapse into: `POST /event`
- `GET /events?ref=&kind=&from=&since=` — event query endpoint (replaces per-kind endpoints)
- Batch upload in CLI: `dupenet upload <dir>` → chunk + upload blobs → POST kind=ANNOUNCE events → POST kind=LIST event
- Upload metadata flags: `--title`, `--description`, `--tags`, `--language`, `--source`, `--access open|paid`
- `dupenet fund <ref> <sats>` — unified funding (replaces `dupenet tip`). All funding is `POST /event` with sats > 0.
- `dupenet export <ref>` → generates EvidenceExportV1 bundle (CID + publisher sig + host endpoints + L7 anchor proof + attestations). Offline-verifiable. Outputs JSON + optional "Proof URL" short link.
- `dupenet verify <ref-or-file>` → offline verification of EvidenceExportV1 bundle OR live verification of CID (fetch + hash check + anchor proof). Exit 0 = valid.
- `min_bounty_sats` field on HostPayload (host publishes profitability threshold)

Dependencies: Phase 1 steps 1-3 (needs blob layer + host registration for end-to-end)

Exit: `dupenet upload ~/leak/ --title "Court Filings" --tags legal` uploads 200 PDFs, publishes ANNOUNCE + LIST events, prints collection URL. `dupenet fund <list_event_id> 10000` credits pool. One endpoint, one envelope.

---

**7. Signal aggregation + market quoting (reference materializer)**

Deliverables:
- Materializer indexes events by kind, ref, from. Prisma models for materialized views.
- `GET /events?ref=&kind=` — raw event query
- `GET /feed/recent` — browsable feed of recent ANNOUNCE events (paginated, filterable by tags)
- `GET /feed/funded` — CIDs ranked by pool balance (replaces bounty feed). Enriched with `demand` field: receipt_count per epoch as proxy for real traffic. Open-access fetches generate receipts too (§Dual-Mode Host Economics), so demand reflects actual readership, not just paid fetches. Node-agents use demand + balance for mirror targeting. UI shows demand alongside funding.
- `GET /host/:pubkey/scorecard` — automatic host reputation (from HOST events + spot-checks + receipts)
- `GET /content/:ref/signals` — content resilience (from FUND events + receipts + HOST events). Includes demand (fetches/epoch from receipt count) alongside pool balance and graph importance.
- `GET /author/:pubkey/profile` — pseudonymous reputation (from events by pubkey + receipts on their content)
- `GET /market/quote` — supply curve from host min_bounty_sats thresholds
- `GET /host/roi` — **host ROI scoreboard**: top earning CIDs last 24h, estimated sats/day if you mirror top 20 CIDs, median payout time. Operators join when they can estimate earnings now. This is the host conversion surface — "how much will I earn?" answered in one page.
- Collection fan-out: materializer resolves LIST events, distributes FUND across constituents

Dependencies: Phase 1 steps 1-5 (needs pools, receipts, spot-checks in Prisma)

Exit: `GET /feed/recent` returns browsable feed. `GET /content/<ref>/signals` returns resilience score. Signal endpoints are materializer views over EventV1 stream — not protocol.

---

**7b. Event log compaction + snapshot bootstrap**

Deliverables:
- `StateSnapshotV1` schema in physics (epoch, merkle roots for pools / hosts / content / serves / pins, event count, prev hash)
- Merkle tree library: build from key-value pairs, generate/verify inclusion proofs
- Coordinator snapshot generator: materialize Prisma state into StateSnapshotV1 at epoch boundaries
- `GET /snapshot/latest`, `GET /snapshot/:epoch`, `GET /snapshot/:epoch/proof/:key`
- Receipt rollup in epoch settlement: EpochSummary stores merkle root + counts; raw receipts archived
- `GET /bootstrap` — latest snapshot + events since (fast node sync)
- Snapshot verification: publisher sig (MVP), Bitcoin-anchored epoch root (L7)

Dependencies: Phase 1 steps 1-5 + step 7

Exit: new node calls GET /bootstrap, materializes state from snapshot + recent events in seconds.

---

**7c. Preserve clearing + auto-bids**

Deliverables:
- `PreserveOrderV1` TypeBox schema in physics (tier, target_replicas, min_jurisdictions, duration_epochs, max_price_per_epoch, auto_renew)
- kind=PRESERVE (0x0A) event support in coordinator event ingestion
- Preserve escrow: sats held in `escrow[preserve_id]` until clearing, not credited to pool immediately
- Bid aggregation: per-CID demand profile computed from active preserve orders (aggregate target replicas, median willingness-to-pay)
- Host OFFER events: `kind=OFFER` (0x0B) — supply-side orderbook (ref, replicas, regions, price_per_epoch, bond_sats, duration)
- Epoch-boundary clearing: match aggregate demand → host supply → compute clearing price → credit pool at clearing price × matched replicas
- `CLEARING_SPREAD_PCT` deducted from matched value → founder income
- Preserve lifecycle: ACTIVE → LAPSED (expiry) → CANCELLED (explicit, unused escrow returned minus time-value fee)
- Auto-bid generation: settlement-time computation `auto_bid = price_sats * AUTO_BID_PCT` per L402 receipt → credited to pool[fetched_cid]
- Sustainability ratio computation: `organic_auto_bid_income / preservation_cost` per CID per epoch
- `GET /market/orderbook/<cid>` — live bid aggregation + supply curve (extends Step 7 `GET /market/quote`)
- `GET /content/:ref/sustainability` — auto-bid income, preservation cost, ratio, self-sustaining status

Dependencies: Steps 6-7 (needs EventV1 + signal endpoints + pools in Prisma)

Phasing: auto-bids + tier-based UX ship with Step 8 (settlement-time computation, no new infrastructure). Formal clearing + escrow + host commitments ship as Step 7c iteration after launch. Bid aggregation display ships with Step 8 (read-only view over preserve events).

Exit: `GET /market/orderbook/<cid>` returns live demand/supply. Auto-bids visible on content pages. Sustainability ratio displayed in instrument cluster.

---

**8. The Leaderboard + Storefront (primary product surface)**

The web app is a storefront, not a directory. It shows you the content (or a preview of it), surrounded by context (funding, replicas, discussion). Some content is free to read (sponsored by funders). Some costs sats (priced by hosts). The Fortify button works on both — it buys durability, not access. This is the global importance scoreboard — content ranked by economic commitment. The product that drives adoption, distribution, funding, and institutional revenue. Ship this before polish.

Deliverables:

Core surface:
- Global leaderboard: `/` — all content ranked by dual score: direct pool (economic commitment) and graph importance (citation centrality). Both columns visible. Real-time. The front page of the importance index.
- Topic leaderboards: `/topic/<tag>` — filtered by topic tag. Ranked the same way.
- Content page: `/v/<ref>` — **the product page / storefront view.** Renders content inline, not behind a download link:
  - **Storefront rendering model** (see §Materializer Content Rendering below):
    - **Open content** (pool ≥ host threshold): full render, fetched server-side from gateway. "Free to read, pay to preserve."
    - **Paid content** (no open host or below threshold): render free preview (≤16 KiB: excerpt, thumbnail, first page). Show price tag + Buy button (L402 flow). Multiple hosts → show cheapest.
    - Inline render by MIME: text/HTML rendered directly; images displayed inline; PDFs rendered page-by-page; audio/video with player controls. Download link becomes secondary ("raw" link for power users).
  - **Always visible regardless of access mode:**
    - Instrument cluster: total sats, unique funders, demand (fetches/epoch), copies, sustainability ratio (auto-bid income vs preservation cost), preserve backers + tier, access mode
    - Dual score display: direct pool balance + graph-weighted importance (divergence visible)
    - Replica map: hosts serving this content, by country/ASN
    - Thread: discussion (kind=POST events with ref=this CID or event_id), weighted by sats committed per post
    - Comment box: POST kind=POST with ref=content ref (PoW for free; optional sats to boost). Universal — identical UX on blobs, events, collections, and other comments. Comments are nano-blobs from birth — same fetch path, same economics as any content.
    - Body edge display: inbound citations ("referenced by N funded analyses") and outbound citations ("references N other documents")
    - Fortify button: Lightning payment → POST /event (one click, one action)
    - Fund Thread button: Lightning payment → thread fan-out (resolve ref-chain → distribute FUND events across all events in thread). Strategy selector (equal/recency/importance/depth/manual). Shows per-event allocation before confirming. One click preserves an entire conversation.
  - The context is the product even when the content is gated. The instrument cluster, discussion, Fortify button, and proof links are always visible — they're what differentiates `/v/<ref>` from a raw download.
- Collection page: `/c/<list_event_id>` — grouped content with per-asset signals + aggregate resilience. Fan-out strategy selector (size/equal/demand/importance/manual).
- Cluster page: `/g/<ref>` — graph neighborhood: all nodes reachable within N hops via ref/body/list edges, ranked by graph importance. The information neighborhood view. "Show me everything economically connected to this document."
- Thread page: `/t/<event_id>` — threaded discussion view, per-post sats visible. Comments on comments rendered as nested tree. Fund Thread button prominent. Thread bundle snapshot action: "Preserve this conversation" → creates ThreadBundleV1 → single CID, fundable/pinnable as one object.
- Thread bundle page: `/b/<bundle_cid>` — archived conversation snapshot with completeness proof (merkle root verifiable). Shows all events in thread at snapshot time, per-event funding, bundle-level funding counter.
- Orphan view: `/orphans` — content with high direct pool but low graph connectivity. "Needs analysis" — incentivizes first analysts.
- Proof page: `/p/<ref>` — "Proof URL." Renders EvidenceExportV1 for any CID or event_id. Shows: content preview, "Existed since: <date>" with Bitcoin anchor proof, bytes-verified badge (hash match), provenance chain (publisher sig, witnesses, attestations), fetch endpoints, download evidence bundle (offline-verifiable JSON). Top-level nav item alongside leaderboard. The institutional conversion surface — paste a Proof URL in a court filing, email, or tweet. Reconstructable from bundle CID if domain dies.
- Host scorecard: `/h/<pubkey>` — host reputation dashboard
- Market quote display: "Add X sats → est. Y copies for Z days" from supply curve

Embeddable widget (**GTM artifact — ship before media outreach, Week 2 depends on this**):
- Compact leaderboard widget for external sites
- Shows: content title, funding counter, funder count, Fortify button
- Widget served by materializer (free for small sites; L402-gated for commercial embeds at volume)
- Primary distribution mechanism: every embed on a news site drives funding back to the platform
- The widget is the artifact handed to journalists. Without it, "embed this on your site" is words, not code. Ship before any other polish item.

Widget resilience (content-addressed distribution):
- Widget JS+CSS bundle published as a CID on the blob layer. Same replication market as any content — has its own bounty pool, hosts earn from serving it, community can fund the widget CID as infrastructure.
- Embed snippet is inline (~1KB bootstrap), not an external `<script src>`. News sites paste a self-contained snippet that carries its own resolution logic. No single domain in the critical path.
- Bootstrap resolution: try hardcoded host list (5+ endpoints across jurisdictions) → first response with matching content hash wins → cache in localStorage. Hardcoded list is the lifeboat; loaded widget maintains the ship.
- Widget self-updates host list: once loaded, fetches current directory, stores latest endpoints in localStorage. Next page load, bootstrap tries fresh localStorage hosts first, falls back to hardcoded stale list. Host list stays current without news sites updating embed code.
- Widget self-updates code: loaded widget checks for newer version CID via signed announcement event from publisher pubkey. Version-pinned CID in snippet is stable baseline; updates are transparent and signature-verified.
- Two-step resolution: (1) load widget code = blob fetch from any host (survives materializer loss), (2) widget fetches live data from materializer (degrades gracefully — cached counters, "live data unavailable" state, stale-but-visible).
- Dog-food property: the widget is itself protocol content. "This widget can't be taken down because 23 hosts serve it" is both a technical fact and the pitch.
- Seizure math: external `<script src>` = seize 1 domain, kill all embeds. Inline bootstrap with 5 hosts + localStorage = must seize all hosts simultaneously AND wait for cache expiry across every browser. Suppression cost scales with host count × cache lifetime.

Payment integration:
- WebLN auto-pay for Fortify button (zero-click for wallet users)
- QR code fallback for non-WebLN users
- Lightning Address support (tip to a pubkey)
- Free preview serving: gateway serves thumb CIDs / small blocks without L402

Real-time feedback (the 60-second loop):
- WebSocket/SSE from materializer: leaderboard + content pages update within seconds of a Fortify event
- Fortify → see funding counter increment, sustainability meter change, rank shift — immediately, not at epoch settlement
- The loop: See → trust → pay → visible effect in <60s. If this loop isn't tight, attention bleeds.

Bitcoin integrity anchor (L7 — pulled into MVP):
- Daily Bitcoin tx: Taproot tweak with `SHA256(epoch_summary_merkle_root || state_snapshot_hash)`
- Batched: 1 tx/day covering 6 epochs. Cost: ~$0.50/day.
- Verify page: `/verify/<ref>` — paste CID or event_id → show inclusion proof path → link to Bitcoin tx
- This is the "integrity radiator" — turns "cool idea" into "provably real." Institutions won't touch you without it. Critics can't claim numbers are fabricated.

Crisis readiness (before first spike):
- Read-only mode: one switch to disable writes, keep serving reads
- Hot-path cache: top 100 leaderboard items cached, invalidated on new events
- Rate limiting: materializer API rate-limited per-IP (L402 surge pricing at volume)
- Status page: public uptime/health endpoint + incident comms template
- Graceful degradation: widget and API serve cached data if coordinator is overloaded

Materializer content rendering (the storefront — see §Dual-Mode Host Economics):
- The web app is itself a materializer storefront — it proxies reads from the gateway, displays content with context, and converts attention into funding (Fortify) or purchases (L402 Buy).
- `/v/<ref>` renders content inline, not behind a download link. The download link becomes secondary ("raw" link for power users).
- **Open content** (pool ≥ host `open_min_pool_sats` threshold): full render, fetched server-side from gateway. Text/HTML rendered directly; images displayed inline; PDFs page-by-page. "Free to read, pay to preserve."
- **Paid content** (no open host or below threshold): render free preview from ≤16 KiB free-tier bytes (excerpt for text, thumbnail for images, first page for PDFs). Show price tag + Buy button (L402 flow, reuse existing WebLN/invoice flow from FortifyButton). Multiple hosts → resolve cheapest via `GET /directory` → show lowest price.
- **Always show** on every content page: instrument cluster, Fortify button, discussion thread, proof link. The context is the product even when the content is gated.
- Server-side content fetch: web app calls gateway `GET /asset/<ref>` → resolves manifest → fetches blocks → reassembles → renders. For open content, no L402 needed (pool covers it). For paid content preview, free-tier bytes ≤16 KiB are served without L402.
- Prerequisite: gateway must persist asset/file manifests to disk (current in-memory Map loses state on restart — see §Gateway Persistence).

Directory pricing display:
- `GET /directory` already returns `PricingV1` per host per CID.
- Materializer resolves "cheapest host serving this CID" for the Buy button price.
- UI display: "Served by 3 hosts · from ₿3/fetch" (paid) or "Open access · funded for ~8mo" (open).
- Per-host pricing visible on proof page (`/p/<ref>`): host endpoint, pricing, availability score.

Dependencies: steps 6-7 (needs EventV1 + signal endpoints)

Exit: share `https://ocdn.is/v/<ref>` → recipient sees the content (inline render for open; preview + price tag for paid) with Fortify button, Fund Thread button, live funding counter, and comment box. Open-access content renders full document inline — "free to read, pay to preserve." Paid content shows free preview + Buy button (cheapest host). Click Fortify → three-tier flow (WebLN → QR → wallet guide) → counter updates in seconds. Click Buy → L402 payment → full content renders. Comment → thread appears as nano-blob (comment CID fetchable via `GET /cid/{event_id}`), body edges rendered as clickable citation links. Fund Thread → all comments in thread receive funding proportionally, sustainability meters update. "Preserve this conversation" → ThreadBundleV1 snapshot created, single CID fundable/pinnable. `/` shows the global leaderboard with dual scoring (direct pool + graph importance), live activity feed (SSE), header network stats, velocity indicators per item. `/t/<event_id>` shows threaded discussion with per-post funding. `/b/<bundle_cid>` shows archived conversation snapshot with completeness proof. `/g/<ref>` shows the citation neighborhood. `/orphans` surfaces undiscussed funded content with "needs analysis" callouts. `/verify/<ref>` shows inclusion proof anchored to Bitcoin. News sites embed the widget. If a spike hits, the system degrades gracefully, not catastrophically. The new user journey (§New User Journey) is satisfied end-to-end: arrive → read (or preview + buy) → explore → fortify → comment → return.

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
[6] ────────────►              (EventV1 envelope + kind conventions)
     [7] ──────────────►       (materializer views + signal endpoints)
     [7b] ─────────►           (snapshots; parallel with 7)
          [8] ────────────►    (web surface + threading + auto-bids + tier UX)
               [7c] ────────►  (preserve clearing + escrow; iterates after launch)
```

Phase 2 (Layer B: first-party app) build plan is in `post_mvp.md`. Harmonic allocation, paid inbox, vine model, plural discovery are materializer/app features, not protocol.

### Adoption Path (Expected)

- **Early**: Apps use Layer A as origin/CDN for public media (store `asset_root` pointers, outsource distribution)
- **Mid**: Apps use paid fetch + pin contracts for mirrored archives and paid downloads
- **Mid-late**: Humans discover content via web surface, fund replication via Fortify; hosts compete for bounties
- **Late**: Apps run 1-2 nodes, participate in bounty loop, use receipt SDK for cross-platform demand signals

---

## Go-to-Market

Two flywheels, two GTM tracks. Run both; they reinforce each other.

### Flywheel B: Seed Content (Demand-Side Bootstrap)

Seed content determines who shows up first. Who shows up first determines culture. Choose content under active threat, with passionate audiences willing to pay sats, that demonstrates the value prop in a way anyone understands.

| Tier | Content | Why it works | Risk |
|------|---------|-------------|------|
| **1: Pressure** | Epstein docs / court filings / FOIA | Cross-spectrum interest, real suppression → organic Fortify | Conspiracy crowd; mitigated by economics (noise costs sats) |
| **1: Pressure** | Deplatformed creator archives | Existing fanbases willing to pay; creator promotes | Quality varies; protocol doesn't care, hosts choose |
| **1: Pressure** | Investigative journalism under legal threat | "Streisand effect as a service" | Legal exposure; mitigated by infra-not-editorial positioning |
| **2: Community** | Ephemeral board archives (4chan /biz/ etc.) | Durability has clear value; crypto-native audience | Shillers/scammers; mitigated by sats-gated visibility |
| **2: Community** | Seeded debates / spicy takes | Creates vine depth fast; tests economic ranking | Astroturfing optics; mitigated by pseudonymous design |
| **3: Utility** | OSS mirrors, model weights, datasets | Verifiable bytes + pin contracts | Low emotional engagement (drives Flywheel A, not B) |
| **3: Utility** | Academic papers, public-domain archives | Sci-Hub-adjacent demand | Legal gray zone; encrypted blobs + operator policy |
| **3: Utility** | Podcast / video backups | Large files test blob layer; pin contracts natural | Bandwidth-heavy; needs real host capacity early |

### Flywheel A: Layer A as Marketplace Primitive

`PUT blob + L402 paid fetch + content-addressed verification` is a permissionless marketplace. Every seller is a marketer (earn per fetch → promote links). Every buyer gets verifiable bytes, no account, no signup.

| Market | Pitch | Self-reinforcing dynamic |
|--------|-------|------------------------|
| **Micro video / clips** | Gumroad for files, no KYC, no 30% cut | Creators earn per-view → promote → more creators |
| **Paid torrents** | BitTorrent but hosts get paid | Hosts earn → more hosts → faster downloads → more users |
| **Adult content** | Lightning solves payment deplatforming | Reliable rails → creators → audience → hosts → more creators |
| **Data / API markets** | L402 = HTTP 402; verifiable bytes, metered access | Sellers list → buyers pay → market deepens |
| **Gray/black markets** | Encrypted blobs opaque by design | Cheaper + more reliable than alternatives |

Common loop: `upload → share link → L402 pay → host earns → receipt → more hosts mirror → prices drop → more buyers → more sellers`. Founder's position: infrastructure operator, not marketplace. Own hosts apply RefusalV1 policy; other hosts make own choices.

**Host self-upload (vending-first)**: A creator uploads to their own host, announces `access: "paid"`, sets pricing. Earns from direct L402 sales immediately — no bounty pool needed. If others Fortify, the host earns bounty rewards too. The two streams compose without conflict. This is the simplest path for sellers: upload → share link → earn per fetch.

**What Layer A markets need**: `PUT /block` + `GET /block` via L402 + shareable link + host competition + optional pins. Seller handles their own marketing. No discovery layer needed — the internet is the discovery layer.

### Bootstrap Sequence

The leaderboard is the product. Seed it, share it, embed it.

```
Week 1:    Founder uploads Tier 1 seed content (Epstein files, deplatformed archives)
           Founder seeds the citation graph — the graph is the product, documents are nodes:
             - 200+ body edges across 50+ docs ([ref:bytes32] citations linking documents)
             - 20 "hub" docs with 5-10 inbound edges each
             - 3-5 "controversy clusters" (docs that contradict each other, linked by analysis)
             - edges don't require long comments — a one-line "[ref:X] contradicts [ref:Y]" creates structure
           Leaderboard goes live at ocdn.is — funded content visible, Fortify button works
           Embeddable widget ships (iframe snippet, works on any page)
           Founder operates 2-3 hosts + 2-3 mints
           Layer A HTTP origin functional — anyone can PUT/GET blobs

Week 2:    Share leaderboard URL on Nostr, Bitcoin Twitter, journalism communities
           Contact 5-10 independent media outlets: "embed this widget on your coverage"
           First organic funding flows → leaderboard updates in real-time → viral loop starts

Week 3-4:  First censorship event amplifies the leaderboard (funding spikes visible in real-time)
           Media embeds drive 10x traffic (every embed is a Fortify funnel)
           First institutional inquiry: "how do we get API access?"
           First external hosts deploy via node kit (attracted by bounty pools filling)
           First sellers upload paid content (clips, files, data) — share links externally

Month 2:   First deplatformed creator or journalist archives their content
           Widget deployed on 50+ external pages
           Receipt volume validates host economics from both flywheels
           Layer A micro-markets emerge organically (sellers find the protocol)

Month 3-4: First external app integrates Layer A (stores asset_root pointers)
           First pin contract from a platform or organization
           Marketplace dynamics self-reinforce (sellers promote, hosts earn, prices drop)
           Adult content / paid media creators discover reliable Lightning payment rails

Month 6+:  Layer A markets generate steady egress revenue independent of Flywheel B drama
           Host network is large enough that new markets bootstrap without founder involvement
           Flywheel A sustains itself; Flywheel B spikes on censorship events
           Widget on 1000+ external pages — each one a distribution + funding channel
           Each new censorship crisis drives exponential attention to the leaderboard
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

For institutions/legal/compliance: **"Proof URLs — verifiable evidence links with Bitcoin-anchored timestamps."** Same system, different entry point. Consumer sees the leaderboard; lawyer sees the Proof URL.

The protocol is invisible. The content is visible. The instrument cluster (sats committed, replicas, epoch survival) is the proof. Users don't need to understand L402 or harmonic allocation. They need to see a number go up when they tap "Fortify."

### New User Journey (First Contact)

The protocol lives or dies in the first 90 seconds of a new visitor's experience. The scenario that matters: someone on Twitter/Nostr shares an ocdn.is link during a censorship spike. A wave of normies who have never heard of Lightning click through. Every design decision below serves that moment.

**The arrival (the storefront)**

User lands on `/v/<ref>` — a specific Epstein deposition. This is a product page on a storefront, not a file browser.

If the content is open-access (pool meets host threshold):
1. The document (readable — full content rendered inline, fetched server-side from gateway)
2. "Free to read, pay to preserve" subtitle

If the content is paid (no open host / below threshold):
1. Free preview rendered inline (first page of PDF, excerpt of text, thumbnail of image — from ≤16 KiB free-tier bytes)
2. Price tag + Buy button: "Full document · ₿3/fetch · Buy" (cheapest host, resolved from directory)

Either way, they ALSO see:
3. The instrument cluster beside/below it:
   - Funding counter: "4,718 sats committed by 93 people"
   - Demand: "2,340 reads this epoch"
   - Replica map: pins on Iceland, Romania, Malaysia, Switzerland — "served by 7 independent hosts across 4 jurisdictions"
   - Sustainability meter: "funded for 14 more months at current drain rate"
   - Citation inbound: "referenced by 12 funded analyses"
4. The Fortify button (prominent, single action — buys durability, not access)
5. Discussion thread (comments weighted by sats, citation links between documents)
6. Activity pulse: "someone funded this +210 sats 3 minutes ago"

The instrument cluster IS the pitch. It answers "why am I here instead of PACER?" without a single word of explanation. PACER doesn't show you that 93 people care enough to pay for this document's survival, or that it's replicated across 4 jurisdictions, or that 12 analysts have published funded commentary linking it to other documents. The content is commodity. The context is the product.

**Open access for seed content (sponsored availability)**

Seed content — material that's already publicly available and serves as the go-to-market hook (Epstein court filings, FOIA releases, deplatformed archives with creator consent) — MUST be fully readable without L402. The L402 wall at the moment of peak interest kills the viral loop dead.

Open access is NOT "all content is free." It is bounty-funded serving with host thresholds. Content is open only while the pool supports it. When funding dries up, content drops to paid or preview. No charity, no free CDN.

The economics (see §Dual-Mode Host Economics):
- Two earning streams, always both: **bounty** (epoch rewards from pool drain) + **vending** (L402 egress). Hosts earn from both on every CID they serve.
- On open-access fetches: hosts produce receipts identical to paid fetches. Settlement doesn't distinguish. Open reads ARE demand signals that prove service and attract epoch rewards.
- Hosts serve open content only if `pool >= host.open_min_pool_sats` (host-configured). Below threshold, host declines or falls back to L402. This is a host-level policy decision, not protocol.
- Free reading is the loss leader. The conversion event is Fortify, not L402.
- "Free to read, pay to preserve" is a sentence anyone understands. "Pay 3 sats to read what you can get for free on PACER" is not.
- For large files (video, archives): open access serves derived variants only (per-page PDF renders, text extracts, thumbnails). Full raw file stays L402 unless pool is massive. For small/medium documents (court filings, text): open access serves the full file.

Open access is Flywheel B (attention → funding → replication → more attention). The receipt loop is the key: popular open content generates more receipts → more hosts mirror it (proven demand) → faster/cheaper serving → more readers → more receipts. Creator-uploaded paid content (clips, data, files) keeps its L402 gate — that's Flywheel A (marketplace). The two coexist and compose: a host can earn from both streams on the same CID simultaneously.

Implementation: ANNOUNCE event includes `access: "open" | "paid"` field (materializer convention, not protocol). Default: `paid`. Founder sets `open` on seed content. Hosts choose whether to honor it based on their `open_min_pool_sats` threshold. The `access` field is publisher *signal*, not host *constraint* — protocol doesn't enforce it. The materializer storefront renders content inline (open) or preview + Buy button (paid) based on this field and actual host availability. UI shows "Free to read, pay to preserve" (open) or price tag + Buy (paid).

**The Fortify conversion (zero-to-sats)**

The normie who just arrived from Twitter sees the instrument cluster, gets it, wants to Fortify. They don't have Lightning.

The Fortify flow must handle three tiers of user:

**"Preserve" tiers (primary CTA)**: The default action is buying a preservation outcome, not donating sats. Three CTAs everywhere, in priority order:

1. **Preserve** (primary) — tier selector derived from `GET /market/quote` + supply curve:
   - **Gold** — "10 replicas, 3+ jurisdictions, ~6 months" → price from clearing estimate
   - **Silver** — "5 replicas, 2+ jurisdictions, ~3 months" → price from clearing estimate
   - **Bronze** — "3 replicas, ~1 month" → price from clearing estimate
2. **Buy** (secondary, paid content only) — L402 egress, cheapest host
3. **Fund** (power-user) — freeform sats, raw FUND event, irrevocable pool credit

Under the hood, Preserve Gold/Silver/Bronze create `PreserveOrderV1` events (sats escrowed → clearing → pool credit). Fund creates raw FUND events (immediate pool credit). The normie sees "I'm preserving this at Gold tier" — a product with a measurable outcome guaranteed by the clearinghouse, not a donation to a mystery pool. Even at low host count, show best estimate: "est. ~30 days at current drain rate." Preserve backers shown on content page: "93 backers · Gold tier · funded through August."

**Sustainability display**: Every content page shows auto-bid status alongside preserve info. "This content generates 12 sats/epoch from organic traffic. Current preservation cost: 8 sats/epoch. Self-sustaining ✓" or "Needs 300 more sats/epoch from backers." When sustainability_ratio ≥ 1.0, the Preserve button shifts from urgent to optional — "Already self-sustaining. Boost to Gold?"

1. **Lightning-native** (WebLN wallet installed): Click Fortify → goal selector → WebLN auto-pays → counter increments in <5 seconds. Zero friction.

2. **Has a Lightning wallet but no WebLN**: Click Fortify → goal selector → QR code / invoice string → scan/paste in wallet app → counter increments on payment confirmation. 10-second flow.

3. **No Lightning wallet (the critical case)**: Click Fortify → goal selector → "Pay with Lightning" (QR/invoice) OR "Get started" → recommended wallet guide (2-3 options: Phoenix for mobile, Alby for browser, Mutiny for web-only). Keep it to one screen. Don't build a custodial onramp — link to the best self-custodial wallets with clear "install → fund → return here" steps. Accept that this user may bounce and return later. The instrument cluster already did the persuasion work; the wallet setup is homework they'll do because they're motivated.

Fiat onramp (post-MVP, assess when Fortify abandonment rate measurable): embedded Strike/Coinos widget for card-to-Lightning. Not at launch — adds regulatory surface and custodial dependency. But track how many users click Fortify and then don't complete payment. If >60% abandon, the fiat bridge becomes urgent.

**Small network, alive feeling**

At 5-10 nodes and 20 items on the leaderboard, the network needs to feel like a living system, not a static page.

Live activity feed: a real-time stream on the leaderboard page showing funding events as they happen. "Someone funded 'Maxwell Deposition 2019' +500 sats — 2 min ago." SSE/WebSocket from materializer, same infrastructure as the 60-second feedback loop (§Real-time feedback). Even one funding event per hour keeps the page alive. At low volume, batch the feed with system events: "New host online in Romania", "Replica count for <title> increased to 6", "New analysis published on <title>."

Content count and network stats in the header: "47 documents | 4,718 sats committed | 7 hosts across 4 jurisdictions." Small numbers that are real are more powerful than large numbers that feel fake. The header stats grow visibly week over week — returning visitors see momentum.

Leaderboard velocity indicators: alongside each item's rank, show direction arrows or streak indicators ("+3 positions", "trending", "new"). At low volume, even a few Fortify events produce visible rank movement. The leaderboard should feel like a scoreboard, not a library catalog.

**The explorer journey (browsing the Epstein collection)**

The user who arrived on a single document now wants to explore. The collection page (`/c/<list_event_id>`) is the navigation hub:

- All 200+ documents organized with titles, sizes, per-document funding levels
- Sortable: by funding, by recency, by document date, by citation count
- Filter by type (depositions, flight logs, correspondence, court orders)
- Each document shows its mini instrument cluster (funding, replicas, citation count)
- Collection-level aggregate: total sats, total replicas, estimated sustainability of the collection
- "Fund All" button with strategy selector (equal, size-weighted, demand-weighted)

The cluster view (`/g/<ref>`) is the power feature that no other platform offers. "Show me everything economically connected to this deposition." The user clicks through from a document and sees its citation neighborhood: which analyses reference it, which other documents those analyses also cite, which documents are heavily funded but have no analysis yet (orphans).

Orphan callouts: prominent banner on documents meeting the orphan criteria: (a) high direct pool, (b) low graph connectivity (few inbound ref/body edges from other funded events), (c) low discussion depth (few or zero kind=POST replies). "Funded, but under-analyzed." / "This $2,000 bounty document has no analysis yet. Be the first." This creates a gold-rush dynamic for journalists, researchers, and commentators — the funded but undiscussed documents are both the highest-value contribution opportunity and the most obvious gap. Early analysts earn permanent positional advantage in the citation graph (their comments become the only bridge nodes). Hard to game: inflating the pool costs real sats, and reducing graph connectivity means not linking to the node — which defeats the purpose of gaming visibility.

**The commenter journey**

User reads a document, wants to say something. Comment box at the bottom of every content page.

- Free comment: PoW proof (200ms on mobile, invisible to user). Zero sats required. Appears in thread.
- Boosted comment: attach sats to make the comment more visible + fund its own durability. "This comment is backed by 210 sats" shown alongside it. Boosted comments rank higher in the thread. The sats go to the comment's own bounty pool (it's a nano-blob, independently fundable).
- Citing other documents: type `[ref:...]` inline to create body edges. "The deposition at [ref:a1b2...] contradicts the flight log at [ref:d4e5...]" — creates citation links visible in the graph. The materializer auto-links these in the rendered comment. This is the mechanism by which the citation graph grows organically through discussion.

The comment IS content from birth. It has its own CID, its own bounty pool, its own potential place on the leaderboard if funded enough. A brilliant analysis of an Epstein document can itself climb the leaderboard, attracting more funding, more citations, more replies. The best comments become primary sources in their own right.

**The host operator journey (attracted by the buzz)**

Someone sees the Epstein files trending, notices the bounty pools filling, and thinks: "I have a spare VPS — I could earn sats serving these." Their path:

1. See bounty feed on leaderboard: documents with growing pools, drain rate, estimated earnings per host
2. Click "Run a Host" → node kit page. Docker one-liner, Raspberry Pi instructions, managed provisioning option.
3. Deploy node. Agent watches bounty feed, auto-mirrors profitable CIDs.
4. Within one epoch (4h): first receipts, first earnings visible in host dashboard.
5. Host appears on replica maps across content pages. Operator sees their host on the map.

Market quoting makes the operator's decision transparent: "Adding your host to this CID increases its replica count from 4 to 5. Estimated earnings: ~20 sats/epoch at current drain rate." The host dashboard shows real-time earnings, CIDs served, receipts collected.

The host operator doesn't need to care about Epstein or censorship. They need to see: "this content has money behind it, I can earn by serving it." The economics self-select hosts — same as gas stations don't care what you're driving to.

**First 90 seconds — decision tree**

```
Visitor lands on /v/<ref> via shared link (the storefront)
  └─ Open content: sees full document inline + instrument cluster + activity pulse
  └─ Paid content: sees free preview (excerpt/thumbnail/first page) + price tag + Buy button + instrument cluster
     ├─ Reads (or previews), satisfied, leaves (free rider — fine, they saw the cluster)
     ├─ Clicks Buy (paid content) → L402 payment → full content renders
     ├─ Clicks Fortify (open or paid — buys durability, not access)
     │  ├─ Has Lightning → pays → counter increments → dopamine → explores more
     │  └─ No Lightning → sees wallet guide → bookmarks → returns later (or doesn't)
     ├─ Reads document, clicks citation link → falls into cluster view → rabbit hole
     ├─ Reads document, writes comment → now has skin in the game (their comment is content)
     ├─ Clicks to leaderboard → browses collection → sorts by "needs analysis" → finds gold
     └─ Clicks "Run a Host" → sees economics → deploys node (operator conversion)

Every path except "leaves immediately" deepens engagement.
Two paths require Lightning: Fortify (funding) and Buy (paid content access).
The rest — reading open content, previewing paid content, exploring, commenting, citing — are frictionless.
```

**What this means for Step 8 (Leaderboard + Storefront) deliverables**

The new user journey implies specific additions to the Step 8 build:

- **Storefront rendering (the core reframe)**: the web app is a storefront, not a directory. `/v/<ref>` renders content inline (open) or shows preview + Buy button (paid). Server-side content fetch from gateway → render by MIME type. This is the first thing a visitor sees — it must work. See §Materializer Content Rendering in Step 8 deliverables.
- **Buy button for paid content**: price tag resolved from cheapest host in directory + L402 payment flow (reuse existing WebLN/invoice flow from FortifyButton). After payment, full content renders inline.
- **Free preview for paid content**: ≤16 KiB free-tier bytes rendered inline (text excerpt, image thumbnail, PDF first page). Shows what's behind the paywall.
- **Demand display in instrument cluster**: fetches/epoch (from receipt count) alongside funding, copies, runway. Open-access receipts count too — demand reflects real readership.
- **Directory pricing in UI**: "Served by 3 hosts · from ₿3/fetch" (paid) or "Open access · funded for ~8mo" (open). Per-host pricing on proof page.
- **Live activity feed**: SSE-powered global feed on leaderboard page + per-content feed on content pages. Low-volume padding with system events (new hosts, replica count changes).
- **Fortify onboarding**: three-tier payment flow (WebLN → QR → wallet guide). Track abandonment at each tier.
- **Orphan callouts**: "needs analysis" banners on high-funding / low-citation documents. Prominently linked from leaderboard.
- **Header network stats**: document count, total sats, host count, jurisdiction count. Updated in real-time.
- **Velocity indicators on leaderboard**: rank change arrows, trending badges, "new" labels.
- **Collection sort/filter**: sortable by funding, date, citations, type. Filter by tags.
- **Inline citation rendering**: `[ref:...]` tokens in comments rendered as clickable links to referenced content.
- **ANNOUNCE `access` field**: materializer convention. `"open"` = publisher signal for open-access; `"paid"` = L402 gated (default). Publisher *intent*, not host *constraint* (see §Dual-Mode Host Economics).
- **`PricingV1.open_min_pool_sats`**: host-configured threshold. Below it, host declines open-access serving or falls back to L402. Prevents free-CDN abuse.
- **"Free to read, pay to preserve" UI copy**: open-access content pages. Paid content pages: price tag + "Buy" + Fortify supply quote: "+X sats → est. +Y replicas."
- **Gateway persistence prerequisite**: asset/file manifests must be persisted to disk (current in-memory Map loses state on restart). Required for server-side content fetch.

### Client Interaction Model (what the browser actually does)

The browser does three things locally, always: (1) make keys (or borrow them), (2) build + sign EventV1, (3) do PoW off-main-thread. Everything else is HTTP calls to hosts/materializers. The web app (`apps/web`) is SSR (Next.js) for SEO and initial load, client-side JS for all write interactions.

**Identity + keys (Ed25519)**

Primary (normie default): generate keypair on first write action (comment, fund, announce). Store private key encrypted in indexedDB (survives browser clear better than localStorage). Public key in localStorage. Offer export (download / copy base64) and import (paste / file). Identity chip UI on every page: pubkey short-form, export/import, "use Nostr extension" if detected, "reset identity" (danger zone). This is what makes "comments are first-class content" real for normies.

Upgrade path (power users): NIP-07 (Nostr browser extension) = "Use existing key." If NIP-07 present on `window.nostr`, prefer it; otherwise fall back to local key. Same Ed25519 curve, same signing interface. Cross-device identity without custodial accounts.

"No key" mode (read-only): browse, view clusters, verify proofs, see counters, explore the leaderboard — no key needed. Any write action prompts key creation (one tap). Reading is frictionless; writing has exactly one gate.

**Event submission pipeline**

Every user write action (comment, fund, announce, list, pin) follows the same path:

*A) Compose.* Browser constructs `EventV1 { v, kind, from=pk, ref, body, sats, ts }` using the physics library (must work in browser context — it already uses `@noble/hashes` which runs in browsers).

*B) If sats > 0 (Fortify, funded comment, pin budget):*
1. Compute `event_hash = SHA256(canonical(EventV1 minus sig))` — intent binding
2. Request invoice: `POST /payreq { sats, event_hash }` — materializer returns LN invoice with event_hash in memo
3. Pay via WebLN (auto) or QR (manual)
4. Receive `payment_proof` (preimage or payment_hash confirmation)
5. Sign event, submit: `POST /event { event, payment_proof }`

Intent binding prevents pay-for-one-submit-another: the materializer rejects events whose `event_hash` doesn't match the paid invoice's memo.

*C) If sats == 0 (free comment, free announce):*
1. Compute PoW in Web Worker (never blocks UI — show "publishing..." spinner):
   - `challenge = SHA256("EV1_POW" || from || ts || kind || ref || SHA256(body))`
   - Find `nonce` where `SHA256(challenge || nonce) < EVENT_POW_TARGET`
   - EVENT_POW_TARGET calibrated for ~200ms on mobile (same ballpark as receipt PoW)
2. Attach `pow_nonce` + `pow_hash` in event body extension field
3. Sign event
4. Submit: `POST /event { event }`

Note: event PoW (spam defense for free writes) is distinct from receipt PoW (anti-sybil for epoch rewards). Different challenge prefix ("EV1_POW" vs "RECEIPT_V2"), different purpose, same mechanism.

**Real-time UX (SSR + SSE)**

- Page loads server-rendered (SEO + fast first paint) for `/`, `/v/<ref>`, `/c/<id>`, `/t/<id>`
- Client opens SSE connections:
  - `GET /sse/global` — leaderboard updates, activity feed events
  - `GET /sse/ref/<ref>` — per-content: funding counter changes, new comments, replica count updates
- On submit: optimistic UI insert (comment appears immediately with "pending" state), then reconcile when SSE echoes the confirmed event back
- SSE message types: `fund_delta` (pool balance change), `new_event` (comment/announce), `replica_change` (host added/removed), `rank_shift` (leaderboard position change)

**Browser upload flow**

Two options. Ship Option 2 first; swap to Option 1 later without breaking anything.

*Option 1 — Client-side chunking (trust-minimal, long-term):* Browser runs the physics chunker directly: `Chunk(file) → blocks[] → SHA256 per block → FileManifestV1 → AssetRootV1`. Then PUT /block, PUT /file, PUT /asset to host. Then POST kind=ANNOUNCE + optional kind=LIST events (signed client-side). Same as CLI, same trust model.

*Option 2 — Upload shim (ships fast, MVP default):* Browser does `POST /upload` (multipart) to materializer. Materializer chunks, pushes to hosts, returns `{ asset_root, file_root, blocks[] }`. Browser then signs and posts ANNOUNCE/LIST events (metadata always signed client-side — the materializer never signs on behalf of the user). Returns identical objects (manifest, asset root) so Option 1 is a drop-in replacement later.

Trust trade-off: Option 2 trusts the materializer to chunk correctly and push to honest hosts. But the returned `asset_root` is verifiable (client can re-hash locally if paranoid). Metadata events are always client-signed regardless. The materializer handles bytes; the user owns their statements.

**Client state (browser)**

| Storage | Contents | Persistence |
|---------|----------|-------------|
| indexedDB | Encrypted private key | Survives clear-browsing in most browsers |
| localStorage | Public key, last-known endpoints (materializers + hosts), cache TTL, Fortify abandonment tracking | Session-durable |
| In-memory | Current ref, known host set, cheapest host selection, optimistic thread list, pending markers | Page lifetime |
| indexedDB | Pending event queue (offline writes): signed events stored locally, replayed on reconnection, deduped by event_id | Survives offline, tab close |

The pending event queue connects to §Longevity L2 (client-side event buffer): if all materializer endpoints are unreachable, signed events queue locally and replay on reconnection. FIFO, dedup by event_id. This is how pool re-ignition works after coordinator disruption — clients replay buffered FUND events, pools refill.

**Browser-facing endpoints (MVP subset)**

Materializer:
- `POST /event` — submit signed EventV1 (with optional payment_proof or pow_nonce)
- `POST /payreq` — request LN invoice for sats-gated actions (binds to event_hash)
- `POST /upload` — upload shim (multipart → chunk → push → return asset_root)
- `GET /events?ref=&kind=&from=&since=` — event query
- `GET /content/<ref>/signals` — instrument cluster data
- `GET /feed/funded`, `GET /feed/recent` — leaderboard data
- `GET /market/quote?ref=&sats=` — supply curve quote
- `GET /sse/global`, `GET /sse/ref/<ref>` — real-time event streams

Host (direct):
- `GET /cid/{hash}` — nano-blob or small content (free preview / open access)
- `GET /asset/{root}`, `GET /file/{root}`, `GET /block/{cid}` — blob layer
- `PUT /block/{cid}`, `PUT /file/{root}`, `PUT /asset/{root}` — client-side chunking (Option 1)

---

## Success Criteria

**Content survives**: Popular content maintains copies. Unpopular content gracefully degrades.

**Verification honest**: Receipt-based payouts + optional audits. No trusted verifiers needed.

**Hosts profit**: Honest operators earn more than costs. Dishonest operators lose stake.

**Market emerges**: Multiple hosts compete on price/performance. No single point of failure.

**Permissionless**: Anyone can host, verify, attest, or pay for replication. No gatekeepers.

**Platform adopted**: External apps use Layer A for storage + demand intelligence. Pin contracts generate B2B revenue. Receipt SDK used cross-platform.

**Flywheel A turning**: More apps → more egress → more hosts → more resilience → more apps.

**Obsession metric (first 60 days)**: **funders-per-asset** — breadth of funding support, not depth. A CID funded by 100 people at 21 sats each is a stronger importance signal than one whale at 2,100 sats. This metric directly measures whether the system produces the unique signal (many people care) that no other platform generates. Secondary: sats-per-visitor (Fortify conversion rate). Every design decision for the first 60 days should be judged by whether it increases funders-per-asset. If it doesn't, skip it.

Layer B success criteria (attention pricing, discovery, graph accumulation, lineage) are in `post_mvp.md`.

---

## Post-MVP Assessment Queue

Items deferred from external review. Assess after launch once real traffic/host data exists.

### Discovery-Event Spam Pricing (#2)

Layer A.1 events (ContentAnnounce, AssetList) have no cost — potential spam surface. MVP mitigates via coordinator-side rate limits (per-pubkey, per-IP). Post-MVP, decide whether event ingest becomes a paid market (402-gated POST /event) or stays rate-limited with PoW. The decision interacts with the materializer market design: if materializers earn from ingest fees, paid events fund the decentralized discovery layer. If rate-limited, materializers need a different revenue model. PoW per event is acceptable for human-scale usage (200 PDF uploads outpace PoW compute), but high-volume automated publishers would feel it. Assess once real event volume and abuse patterns are observable.

### min_bounty_sats Quote Gaming (#3)

Hosts self-report min_bounty_sats in PricingV1. At MVP scale (5-20 hosts, founder knows each), gaming is irrelevant. Post-MVP, compute behavioral thresholds from HostServe events: observed_threshold = min bounty at which host first registered to serve a CID. Show confidence intervals (self-reported vs observed) in UI when enough data points exist per host. Separately evaluate whether "slashable signed quote offers" are worth the expanded slash surface — current spec slashes only for cryptographic fraud, and making economic commitments slashable is a philosophical change. Defer until host count > 50 and supply curve UI is live.

### Multi-Source Parallel Download (#7)

Current design: client fetches all blocks from one host, failover to next on failure. Block-level addressing (GET /block/{cid}) and multiple hosts per CID (HostServe N:1) already support parallel multi-host fetch as a client optimization — no protocol change needed. Deferred decisions: (a) partial-file payment economics (client pays host A for block 1 but host B fails block 2 — no refund mechanism), (b) block availability bitmap (hosts publish which blocks they have, changing HostServe from all-or-nothing to partial — affects directory model and epoch reward eligibility), (c) stripe strategy (round-robin vs latency-weighted vs cost-optimized). Add client-side parallel fetch as SHOULD behavior once 3+ hosts serve the same CID in production. Block availability bitmap is a separate design expansion.

---

## Constants (Tunable)

| Constant | Value | Rationale |
|----------|-------|-----------|
| BASE_FEE | 21-210 sats | Floor = spam defense; cap = peak demand; 100% to bundler |
| FOUNDER_ROYALTY_R0 | 0.15 (15%) | Starting royalty rate at genesis |
| FOUNDER_ROYALTY_V_STAR | 125,000,000 sats (1.25 BTC) | Scale constant; rate halves every ~10× volume |
| FOUNDER_ROYALTY_ALPHA | log(2)/log(9) ≈ 0.3155 | Power-law decay exponent |
| EGRESS_ROYALTY_PCT | 0.01 (1%) | Flat % of L402 egress fees to founder pubkey. Durable passive income floor. Does not taper. |
| PROVISIONING_SURCHARGE | 21% | Managed node provisioning margin (product-level) |
| OPERATOR_STAKE | 2,100 sats | Sybil resistance, accessible. Deferred — not enforced at MVP (receipt + spot-check gates sufficient at founder-vetted scale). |
| RECEIPT_MIN_COUNT | 1 | Min receipts for payout eligibility (smooth scaling replaces hard 5/3 gate) |
| RECEIPT_MIN_UNIQUE | — | Removed as hard gate. Client diversity is now a smooth log2 bonus multiplier on payout_weight, not a binary threshold. |
| POW_TARGET_BASE | 2^240 | ~200ms on mobile |
| POW_ESCALATION_THRESHOLD | 8 | Receipts/day before difficulty ramps |
| UNBONDING_PERIOD | 7 days | Catch misbehavior |
| EPOCH_LENGTH | 4h | Reward cycle + receipt aggregation (6 cycles/day) |
| EPOCH_REWARD_PCT | 2% | % of bounty pool per CID per epoch (total cap, split by score) |
| EPOCH_REWARD_BASE | 50 sats | Base cap per CID per epoch; scales with log2(bounty/base+1) |
| W_UPTIME | 0.6 | Score weight: uptime ratio (rebalanced after W_CLIENTS absorbed into payout_weight) |
| W_DIVERSITY | 0.4 | Score weight: ASN/geo diversity contribution |
| AUDIT_REWARD_PCT | 30% | Challenger's share of withheld epoch reward on proven mismatch |
| AGGREGATOR_FEE_PCT | 3% | MVP default settlement fee (deducted from epoch cap before host split). Market-determined post-MVP. |
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
| EVENT_MAX_BODY | 16,384 | 16 KiB — max EventV1.body size (inline payloads, previews) |
| EVENT_POW_TARGET | 2^240 | PoW target for free events (same ballpark as receipt PoW). ~200ms on mobile. Challenge prefix "EV1_POW". |
| PREVIEW_THUMB_WIDTH | 200 px | Default thumbnail width for image/PDF previews |
| PREVIEW_TEXT_CHARS | 500 | Max characters for text excerpt previews |
| MAX_LIST_ITEMS | 1,000 | Cap items per kind=LIST event (prevents unbounded payloads) |
| MIN_BOUNTY_SATS_DEFAULT | 50 | Default host profitability threshold for min_bounty_sats |
| OPEN_MIN_POOL_SATS_DEFAULT | 500 | Default host threshold for open-access serving; below this pool balance, host falls back to L402 |
| FREE_POW_TARGET | 2^240 | Base PoW target for free-tier reads. Scales with demand: `FREE_POW_TARGET >> floor(log2(active_readers))`. ~200ms per block at base. |
| SESSION_MIN_DEPOSIT_SATS | 21 sats | Minimum deposit to open a paid session (bar tab). Covers ~7 blocks at default pricing. |
| SESSION_MAX_BLOCKS | 4,096 | Max blocks per session (~1 GB at 256 KiB). Client must open new session for larger files. |
| SESSION_TTL | 1h | Session expires after 1 hour of inactivity. Unspent balance refundable minus SESSION_CLOSE_FEE. |
| SESSION_CLOSE_FEE | 1% | Fee on unspent session balance at close (host revenue for session state overhead). |
| ACCESS_BUDGET_MIN | 100 sats | Minimum access_sats on preserve orders (covers ~33 free reads at default pricing). |
| REVIEW_FEE | 21 sats | Deducted from escrow on PASS (compensates host for review labor). |
| REVIEW_WINDOW_EPOCHS | 6 (24h) | Host must accept/pass within this window or escrow auto-refunds. |
| STAGING_TTL_EPOCHS | 12 (48h) | Unpaid staged content auto-purged after this. |
| UPLOAD_MIN_QUOTE | 50 sats | Minimum quote a host can issue (anti-grief on review pipeline). |
| SNAPSHOT_INTERVAL_EPOCHS | 100 | State snapshot every 100 epochs (~17 days) |
| ANCHOR_INTERVAL_EPOCHS | 6 | Epoch root anchored to Bitcoin every 6 epochs (~1/day) |
| AUTO_BID_PCT | 0.02 (2%) | % of L402 egress price auto-credited to pool[fetched_cid] per receipt. Founder earns pool credit royalty on these. Tunable per-epoch. |
| CLEARING_SPREAD_PCT | 0.03 (3%) | % of matched preserve value taken by clearinghouse operator. Does not taper. Product-level toll. |
| PRESERVE_ESCROW_TIMEOUT_EPOCHS | 6 (24h) | Unmatched preserve escrow auto-refunds after this many epochs without clearing |
| PRESERVE_CANCEL_FEE_PCT | 0.02 (2%) | Time-value fee on unused escrow at cancellation (lower than PIN_CANCEL_FEE — preserve orders are renewable, not one-shot) |
| PRESERVE_GOLD_REPLICAS | 10 | Default target replicas for Gold tier |
| PRESERVE_SILVER_REPLICAS | 5 | Default target replicas for Silver tier |
| PRESERVE_BRONZE_REPLICAS | 3 | Default target replicas for Bronze tier |

**Derived (not tunable)**:
- PoW difficulty: `TARGET_BASE >> floor(log2(receipt_count + 1))`
- Block selection: `PRF(epoch_seed || file_root || client) mod num_blocks`
- Pin drain_rate: `budget_sats / duration_epochs`
- Payout weight: `total_proven_sats * (1 + log2(unique_clients))` — smooth scaling, no cliff
- Collection fan-out share: `floor(total_sats * item.size / total_collection_size)` per constituent
- Resilience score: weighted composite of replica count, host diversity, demand trend, sustainability estimate
- Importance triangle labels: percentile-based (Underpriced / Flash / Endowed — see §Signal Layer)
- Auto-bid per receipt: `price_sats * AUTO_BID_PCT` — credited to pool[cid] at settlement
- Sustainability ratio: `organic_auto_bid_income / preservation_cost` — ≥1.0 = self-sustaining
- Free-tier PoW difficulty: `FREE_POW_TARGET >> floor(log2(active_readers + 1))` — scales with concurrent demand per CID
- Session blocks_covered: `floor(budget_sats / min_request_sats)` — how many blocks a session deposit buys
- Clearing price: epoch-boundary matching of aggregate preserve demand vs host supply per CID

Layer A.1 constants are tunable at the same granularity as Layer A (epoch boundaries or local). Layer B constants (vine allocation, discovery, inbox) are in `post_mvp.md`.

Start with these. Tune based on observed behavior.

---

## Longevity (Founder-Elimination Resistance)

Protocol must survive founder removal within one epoch. Work ordered by survival impact per effort.

### L1. Distribute Mint Keys (Critical, Day 1)

Give 3-5 independent Ed25519 mint keypairs to separate operators in separate jurisdictions. Each runs a stateless signing service. Founder holds 1 key, not all. Zero protocol changes — client mint-set acceptance already supports this.

**Survival**: 2+ mints continue, receipt flow uninterrupted.

### L2. Multi-Root Discovery (Nostr-First + Bootstrap Resilience)

Clients discover hosts and materializers from multiple independent sources. Founder infrastructure is one source, not the source. Founder directory becomes optional cache, not authority.

**Bootstrap priority (parallel, first valid response wins):**
1. Local cache: `~/.dupenet/peers.json` (last-known-good endpoints, updated on every interaction)
2. Nostr relays: subscribe to HOST + MATERIALIZER events on configured relays
3. Gateway lists: fetch pinned GatewayListV1 CIDs from any reachable endpoint
4. Hardcoded bootstrap: built into client binary (founder + known community endpoints, updated each release)
5. DNS seeds: TXT records on multiple domains (multiple registrars, multiple TLDs)
6. .onion: Tor-routed access to hardcoded onion addresses
7. F2F import: `dupenet import-peers <file>` or paste from trusted contact

**Invariant**: any single source returning a valid signed HOST event is sufficient to join the network. From one host, discover more (via materializer views or Nostr subscriptions). The network is self-describing once you reach any node.

**MVP client changes (ship alongside Sprint 8 deployment):**
- Replace single gateway/coordinator URL with `endpoints[]` array + retry-with-rotation
- Maintain `~/.dupenet/peers.json` as rolling cache of verified endpoints
- Hardcode bootstrap list in client binary (founder endpoints + known community hosts)
- Ship `.onion` address in compose-production.yml from day 1
- Second domain on separate registrar/TLD
- Client-side event buffer: queue EventV1 locally if all materializer endpoints unreachable; replay on reconnection (FIFO, dedup by event_id). Prevents event loss during coordinator disruption — pool re-ignition needs the events, not just the balances.

**Post-MVP (after EventV1 stable):**
- Nostr event publishing: map HOST/MATERIALIZER events to NIP-compatible kinds
- Nostr relay subscription in client: discover hosts without the founder's coordinator
- GatewayListV1 schema: signed, content-addressed endpoint list published as a blob

**Survival**: existing clients continue from cache if founder disappears. New clients bootstrap from Nostr relays + hardcoded list. No single DNS name is critical. Hosts keep announcing on relays, clients keep discovering them.

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

### L7. Epoch Root Anchoring — PULLED INTO MVP (Step 8)

Daily Bitcoin tx commits `SHA256(epoch_summary_merkle_root || state_snapshot_hash)` via Taproot tweak. 1 tx/day covering 6 epochs. ~$0.50/day. Verify page: paste CID → inclusion proof → Bitcoin tx link.

Serves as trust anchor for state snapshots (§Event Log Growth). New nodes verify snapshots against anchored root — no replay needed.

**Survival**: fraud becomes detectable. Founder's accounting verifiable against Bitcoin-timestamped commitments. Snapshots verifiable without trusting the publisher.

### Longevity Test

> If founder is permanently removed at midnight: do receipts still mint (L1), hosts still discoverable (L2), portal still reachable (L3), state still computable (L4), epochs still settle (L5), code still buildable (L6), accounting still auditable (L7)? Can a new node bootstrap from a verified snapshot without the founder's coordinator (L7 + §Event Log Growth)? Every "no" is a failure.

> Re-ignition test: coordinator dies with non-zero pool balances. New coordinator bootstraps from snapshot. Hosts discover funded CIDs from snapshot state. Within one epoch: hosts serving, receipts minting, pools draining. Clients replay buffered events (L2). Every stall is a bug. The pool IS the recovery mechanism — funded content re-attracts hosts automatically once any coordinator is live.

R&D tracks (FROST threshold mints, on-chain bounty accounting, erasure coding, proof-of-storage, payment rail diversity) documented separately.

---

## Post-MVP Assessment Queue

Deferred design decisions from external review. Each has a trigger condition — assess when the trigger fires, not before. MVP mitigations noted where applicable.

| # | Issue | MVP Mitigation | Trigger | Design Space |
|---|-------|---------------|---------|--------------|
| 2 | Discovery-event spam (Layer A.1 events are free) | Coordinator rate-limits per pubkey/IP | Real event volume + abuse patterns visible | Paid ingest (402-gated POST /event) vs PoW per event. Interacts with materializer market — paid ingest funds materializers. PoW penalizes legitimate bulk publishers. |
| 3 | `min_bounty_sats` quote gaming | Founder knows all hosts; gaming irrelevant | Host count > 50, supply curve UI live | Behavioral inference (observed_threshold from HostServe events). Confidence intervals (self-reported vs observed). Slashable signed quotes expand slash surface beyond crypto fraud — separate decision. |
| 5 | Receipt privacy (ephemeral pubkeys) | Receipt submission opt-in; ephemeral pubkeys recommended (§Receipt Privacy) | Aggregator receives >1000 receipts/day from distinct clients | Blinded/bearer receipts (Cashu-style). PoW escalation already trivially bypassed via key rotation — economic cost is the real defense. |
| 7 | Multi-source parallel download | Single-host fetch with failover | 3+ hosts serve the same CID in production | Client-side block striping across hosts (no protocol change). Partial-file payment economics (paid host A but host B failed). Block availability bitmap changes HostServe from all-or-nothing to partial — design expansion. |
| 9 | Audit griefing / sandbagging | L402 cost gates spam audits | Audit volume > 100/day | Cap audit frequency per (host, cid, epoch). PRF-based audit target selection (auditable but unpredictable). Auditor bond separates "cost to audit" from "revenue to auditee." Regional selective failure: operational fix (Tor), not protocol fix. |
| 11 | Client safety (beyond denylist) | CID denylist + MIME gate + magic byte check (§Client Safety Layer) | First malware incident in production | Attester pack distribution model. Encrypted blob opacity to attesters. |
| 12+A | Materializer market + paid event ingest | Founder is sole materializer; MaterializerV1 schema + MaterializerPricingV1 defined; DirectoryV1 includes `materializers[]`; coordinator rate-limits for free | Second materializer operator expresses interest | Key insight: materializers are metadata hosts — same L402, same market. Ingest = PUT /block equivalent; queries = GET /block equivalent. Interface defined (§MaterializerV1). Remaining: relay-vs-materializer separation at scale, consistency model for divergent state, economic tuning (ingest fee vs query fee balance). |
| 13 | ~~Thread/collection bundles~~ **PULLED INTO MVP (Step 8)** | ThreadBundleV1 defined (§Thread Bundles). Thread fan-out + Fund Thread button + thread bundle page in Step 8 deliverables. | — | Thread bundles pulled forward. ThreadBundleV1: content-addressed snapshot of thread state (events + merkle root). Fundable/pinnable as one CID. Self-verifying completeness via ref-chain DAG. Collection bundles (non-thread) remain deferred until request overhead dominates. |
| 14 | Attester weaponization (coordinated ATTEST flooding) | Default node kit ships with empty attester follow list; operators explicitly opt in; no auto-subscribe | First observed coordinated attester campaign targeting specific CIDs | Adversary publishes ATTEST events (claim=ILLEGAL) from official-looking pubkeys → hosts with default attester lists auto-refuse. Defense: defaults empty, attester reputation (cost-weighted history, temporal burst detection), attester bond option. Social/operational risk, not protocol. |
| 15 | Payment rail diversity (LN-only dependency) | Single rail (Lightning). Accepted risk at MVP. | First LN routing disruption affecting receipt flow or pool credits | Ecash/Cashu bearer tokens for pool credits. On-chain fallback for large settlements. Fedimint integration. Custom token (long-term). No protocol change — pool credit is `sats > 0`, rail is plumbing. |
| 16 | Event stream live mirroring | Snapshots every 100 epochs (~17 days); gap = unverified state | Second materializer or independent archiver active | SSE/WebSocket event stream from coordinator. Independent parties maintain real-time replicas. Reduces recovery gap from 17 days to minutes. Prerequisite for credible re-ignition. |
| 17 | Session/tab implementation (streaming) | Per-block L402 (works for small files) | First video/media content uploaded, or per-block invoice latency > 500ms | Session state management (host-side). Top-up flow. Session receipt batching. PoW session variant. Adaptive bitrate mid-session. Seek-aware block selection for media playback. |
| 18 | PoW-gated free tier | Free preview ≤16 KiB only | First public-interest content pinned with access_sats > 0 | PoW verification on gateway (per-request or per-session). Demand-scaling difficulty. Lightweight demand markers (non-receipt). Access budget deduction accounting. |
| 19 | HTLC-based upload escrow | Materializer holds escrow (MVP) | Second independent host operator | Replace materializer escrow with HTLC conditioned on host publishing signed HostServe event. Host can only claim payment by accepting publicly. Fully trust-minimized — no escrow holder needed. |
| 20 | Author payment proof at settlement | Settler verifies proof (MVP trust point) | Multiple competing settlers active | ReceivedV1 attestation format. Lightning preimage forwarding. Automated proof submission. Dispute resolution for missing proofs. |
| B | Founder service replacement specs | Longevity section L1-L7 | Pre-launch documentation pass | For each service (directory, mints, aggregator, snapshots, provisioning, materializer): inputs, outputs, swap procedure. Test: "can a stranger replace it without contacting the founder?" |

---

## Post-MVP Revenue Layers

Deferred product layers that build on the leaderboard + protocol foundation. Each requires real adoption data. Build when trigger fires, not before. All are materializer products — zero protocol changes required.

**Day-1 data schema constraint**: The graph dataset appreciates over time. Every event, receipt, body edge extraction, graph computation, and threshold crossing must be stored in a queryable, exportable schema from day 1 — even though the API products below are built later. Commit to never losing the raw event stream (append-only immutable log). Materialized views are disposable and rebuildable from the log. Data thrown away or stored in a migration-hostile format is revenue destroyed. The institutional data schema is a day-1 design decision, not a post-MVP trigger.

### Priority Replication Auctions (convex spike capture)

Sealed-bid auction for N priority replication slots per epoch. Winners get guaranteed fast placement on diverse hosts (multiple jurisdictions/ASNs) within 1 epoch.

- **Revenue profile**: Convex. Near-zero during calm; explodes during censorship crises. 100:1 spike ratio.
- **Who pays**: Whistleblowers, publishers under legal threat, organizations archiving time-sensitive content.
- **Trigger**: 10+ independent hosts, and funders visibly frustrated by replication speed.
- **Spec**: PrioritySlotAuctionV1 — slots/epoch, sealed bids, winning bid paid, materializer-operated.

### Pin Insurance / SLA Policies (recurring whale capture)

Insurance policies guaranteeing content availability at target replica counts across specified jurisdictions for a term. Priced using network telemetry (host reliability, geographic distribution, storage market conditions). Founder is default insurer with information advantage.

- **Revenue profile**: Recurring, high-margin, growing with institutional adoption. Premiums spike during uncertainty.
- **Who pays**: Institutions, media companies, NGOs, legal teams preserving evidence.
- **Trigger**: 6+ months of host telemetry, 50+ hosts, at least one institutional customer asking for guaranteed availability.
- **Spec**: PolicyV1 — target replica set (jurisdictions/ASNs), term, premium, payout conditions, proof format.

### Namespace Auctions (cultural spike capture)

Scarce topic positions on the default leaderboard. Winner gets canonical URL (`/topic/<name>`), moderation tools, analytics dashboard, priority placement in feeds. Periodic auctions; renewals required.

- **Revenue profile**: Culturally convex. Spikes when topics explode (who controls `/epstein`?). Recurring via renewals.
- **Who pays**: Media organizations, activist groups, communities, brands.
- **Trigger**: Leaderboard has consistent traffic and people are organically trying to "own" topic pages.
- **Spec**: NamespaceV1 — auction + renewal + transfer fee; resolution rules in founder's UI. Materializer-level, not protocol.

### Institutional API + Intelligence (data monopoly)

License the real-time importance index to media companies, search engines, researchers, NGOs.

- **Revenue profile**: Recurring, high-margin, near-zero marginal cost. Grows with data depth.
- **Who pays**: News organizations ($5K-$50K/month), search engines ($100K-$1M/year), researchers ($10K-$100K/year).
- **Trigger**: Organic institutional inquiries after leaderboard has consistent traffic.
- **Spec**: `/api/v1/importance`, `/api/v1/events`, `/api/v1/attestation/<ref>` — JSON API, L402-gated, subscription management.

### Pro Dashboard (prosumer subscription)

Full battle terminal: search, historical charts, funding flow graphs, coalition maps, alerts, export.

- **Revenue profile**: Recurring. Linear with engaged user count × conversion rate.
- **Who pays**: Power users, analysts, campaigners. $21/month in sats.
- **Trigger**: Leaderboard has 1000+ daily active users.

### Attestation Service (legal/provenance monopoly)

Cryptographic attestation of content provenance + funding history. Only the canonical history keeper (you) can produce full attestations.

- **Revenue profile**: Grows with history depth. A 2026 attestation verified in 2036 has decade-old proof. Monopoly pricing.
- **Who pays**: Lawyers ($100-$10K per attestation), journalists, compliance departments, human rights organizations.
- **Delivery format**: EvidenceExportV1 bundle — self-contained, offline-verifiable, court-admissible without protocol access. `GET /evidence/<ref>` (free for basic) or premium attestation with extended provenance chain + witness co-signatures (paid).
- **Trigger**: Epoch root anchoring (L7) live, at least one external party requests provenance verification.

---

## Analogies

This system is: **PirateBay × Plex — paid bytes on demand.**

BitTorrent + Lightning + CDN economics + Proof-of-Work receipts, but the unit of commerce is the **byte-second**: not files (download-to-own), not subscriptions (all-you-can-eat), but access to bytes when someone wants them, metered at the block level.

| PirateBay aspect | Plex aspect | Dupenet mechanism |
|------------------|-------------|-------------------|
| Decentralized discovery | Library UI / media browser | Materializer (leaderboard + collections) |
| Crowd-funded availability | Always-on media server | Bounty pools + preserve orders |
| Magnet links (content-addressed) | Direct play / stream | CID + FileManifest + session fetch |
| Seeders = hosts | Transcoding / variants | AssetRoot variants + paid transcoding |
| No central point of failure | Metadata-rich experience | Materializer views (ANNOUNCE, LIST) |
| Free-as-in-speech | Not free-as-in-beer | PoW-gated free tier (CPU cost, not sats) |

Underlying primitives:
- **BitTorrent**: Content-addressed, P2P, hosts self-select
- **Lightning**: Fee market, nodes set prices, routing finds cheapest
- **CDN**: Per-GB egress, competitive market, caching emerges
- **PoW receipts**: Clients prove consumption, hosts prove service

Novel additions (Layer A):
- **Bounty pools per CID** as demand signal for replication
- **Durability / access separation** — pools fund proof-of-holding (time-based); egress funded separately (L402 / PoW / sponsor)
- **Receipt-based payouts** replace trusted verifiers with cryptographic proofs
- **Pin contracts** turn durability into a B2B market primitive
- **Session / tab model** — batched payment for streaming + browsing; hosts are stores with entrance fees
- **Receipts as portable demand** — cross-platform proof of paid consumption
- **Layer A/B split** — platform primitive (dumb blobs + paid receipts) decoupled from first-party app worldview

Layer B additions (see `post_mvp.md`): harmonic allocation, vine model, signal classes, plural discovery
