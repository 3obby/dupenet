# Content Availability MVP — Nostr-Native

**Purpose**: Durable sovereign content via economic incentives. Paying attention mechanically increases availability. Build the pool, the receipt, and the leaderboard. Borrow everything else from Nostr.

**Predecessor**: `mvp_plan.md` (2,309 lines). This document preserves all economics, all novel primitives, all product surfaces. It replaces custom infrastructure with Nostr/Blossom/Cashu and reframes the architecture around core NIPs + one product.

---

## Core Thesis

1. **Spam is a pricing problem** — Mandatory minimum fees filter infinite spam.
2. **Censorship is an availability market** — Replication funded by those who care.
3. **Infrastructure is a commodity** — Borrow it. Nostr relays distribute events. Blossom servers store blobs. Lightning/Cashu handle payments. Nostr keys handle identity. All already deployed, already distributed, already resilient.
4. **The importance index is the product** — The real-time, economically-weighted ranking of what humanity values enough to pay to preserve. No other system produces this signal. The protocol is plumbing; the index is the product.
5. **Funding is broadcasting** — Sats attached to a hash don't just buy copies — they buy visibility. Pool balance feeds importance score, importance feeds discovery, discovery feeds consumption, consumption auto-bids back into the pool. Fortify is a strategic action in an attention competition, not a donation.
6. **Agents are the dominant consumption vector** — Human consumption is linear; agent consumption scales with compute. Every agent L402 fetch generates a receipt, an auto-bid, and a royalty event at machine speed. The importance index is a demand oracle for agent capital allocation. The system that tells agents what to consume — and proves they consumed it — is the coordination layer for the agent attention economy.
7. **Protocol surface area is the enemy** — Proof-of-service (receipts + byte correctness + pool drains) is sacred. Everything else — threading, ranking, author payouts, moderation, discovery — is a materializer view, changeable without a fork.
8. **Durability and access are separate products** — Pools fund proof-of-holding (time-based drain). Egress is funded separately: L402 (paid), PoW (free-as-in-CPU), or funder-sponsored budget. Hosts are stores, not libraries.
9. **Competing indexes improve the system** — Multiple materializers compute importance from the same public event stream. Users and agents choose which index to follow. Competition improves quality. Every competing index that drives consumption generates protocol royalties. Indexes are brokers; the protocol is the exchange.

---

## What Dupenet Invented (Novel Contributions)

Four things no existing system provides:

1. **A pool attached to a hash** — money bound to content identity, not to an author or server
2. **Receipts as proof of service** — cryptographic evidence that a host served real bytes to a real payer
3. **Pool drain to receipt-holders** — hosts earn from pools proportional to proven service
4. **The importance index** — the ranking derived from 1-3: commitment × demand × centrality

Everything else is borrowed infrastructure.

---

## Architecture: Nostr-Native Economic Layer

### What's borrowed

| Layer | Provider | Already deployed |
|-------|----------|-----------------|
| Event distribution | Nostr relays (hundreds, multi-jurisdiction) | Yes |
| Blob storage | Blossom servers (BUD-01 through BUD-06) | Yes |
| Identity / keys | Nostr Ed25519 keys + NIP-07 browser extensions | Yes (millions of users) |
| Payment rails | Lightning (Zaps), Cashu (bearer tokens) | Yes |
| Discovery | Nostr relay subscriptions + kind 10063 | Yes |

### What's built (the novel pieces)

| Component | Purpose | Replaces |
|-----------|---------|----------|
| **NIP-POOL** | Pool credit events (bind sats to content hash) | Custom EventV1 ingestion + pool accounting |
| **NIP-RECEIPT** | Proof of service (Blossom server addon) | Custom L402 gate + receipt submission |
| **NIP-SETTLE** | Epoch settlement (deterministic from public events) | Custom coordinator settlement |
| **NIP-PRESERVE** | Structured preservation bid (demand side, escrowed) | Same product |
| **NIP-OFFER** | Host supply commitment (supply side, bonded) | Same product |
| **NIP-CLEARING** | Epoch-boundary clearing result (published by clearinghouse) | Same product |
| **Importance index** | Leaderboard + API + widget | Same product, different plumbing |
| **Clearinghouse** | Preserve order matching | Same product |

### Trust Assumptions (MVP)

- Founder operates: settler, materializer/leaderboard, clearinghouse, 1 of 3-5 receipt mints
- Peers operate: 2-4 receipt mints (different jurisdictions), additional settlers (cross-verification)
- Nostr relays handle: event distribution (pool credits, receipts, settlements, announcements)
- Blossom servers handle: blob storage and serving (with optional NIP-RECEIPT for pool economics)
- All settlement is deterministic and auditable from public relay events — anyone can recompute from day 1
- **Competing settlers and competing importance indexes are permitted and encouraged from day 1**
- Goal: prove market dynamics AND survive loss of any single operator, including the founder

### Symbiosis

Dupenet solves Nostr's unsolved problems:
- **Blossom servers** have no revenue model → NIP-RECEIPT gives them pool income
- **Relay operators** have no sustainability path → economically meaningful events (pool credits, receipts, settlements) create traffic worth persisting
- **Nostr clients** have no economic ranking signal → importance scores are a new feature any client can subscribe to
- **The Dupenet layer makes the Nostr layer more sustainable. The Nostr layer makes the Dupenet layer more resilient. Positive-sum.**

---

## Core NIPs

### NIP-POOL — Pool Credit Event

A Nostr event (custom kind) that binds sats to a content hash.

```
kind: NIP_POOL_KIND (custom range 30000+)
pubkey: funder
tags:
  ["r", "<sha256>"]           # content hash (the pool key)
  ["amount", "<sats>"]        # sats committed
  ["proof", "<zap_receipt | cashu_token>"]  # payment proof
content: optional JSON (metadata, strategy hints)
sig: funder signature
```

**Protocol rule**: settler watches relays for NIP-POOL events. For each valid event: `pool[ref] += (sats - royalty)`. Royalty computed per §Founder Royalty formula.

**Pool key** = SHA256 hash. Can be a content CID, an event ID, or a topic hash. Protocol doesn't care what it references — it credits and drains.

Replaces: EventV1 kind=FUND, custom POST /event endpoint, custom pool accounting.

### NIP-RECEIPT — Proof of Service

A Blossom server that implements this NIP gates fetches, mints receipt tokens, and publishes receipt events.

**Receipt token** (the cryptographic core — unchanged from prior design):
```
receipt_token = Sign_mint_sk(
  "R2" || host_pubkey || epoch || block_cid || response_hash || price_sats || payment_hash
)
```

**Receipt event** (published to relays):
```
kind: NIP_RECEIPT_KIND
pubkey: client
tags:
  ["r", "<sha256>"]                    # content hash served
  ["host", "<host_pubkey>"]            # who served
  ["receipt_token", "<token>"]         # mint-signed bearer proof
  ["price", "<sats>"]                  # amount paid
  ["epoch", "<epoch_number>"]          # settlement period
  ["response_hash", "<hash>"]          # proves correct bytes
  ["pow", "<nonce>", "<pow_hash>"]     # anti-sybil
  ["index", "<index_pubkey>"]          # which index drove this consumption (optional)
  ["index_proof", "<signed_token>"]     # Sign_index_sk(index_pubkey || nonce || epoch)
content: ""
sig: client signature
```

**Index attribution**: Optional. If present, settler verifies `index_proof` (Ed25519 verify against index pubkey, token epoch valid). Only then does the receipt count toward that index's royalty share. Unattributed receipts forfeit index royalty (goes to dev fund).

**Verification**: O(1), permissionless. `Ed25519_verify(receipt_token, mint_pubkey)` + `pow_hash < TARGET` + `sig check`. No LN state, no network calls.

**PoW difficulty schedule** (per client pubkey, per host, per day):

| Receipts | Difficulty | Mobile time |
|----------|------------|-------------|
| 1-8 | 1× | ≤200ms |
| 9-16 | 2× | ~400ms |
| 17-32 | 4× | ~800ms |
| 33+ | 8×+ | exponential |

**Blossom server integration**: Any Blossom server can opt into the receipt economy by running the NIP-RECEIPT addon. Servers that don't just serve blobs for free (altruistic, like current relays). Servers that do earn from pool economics. Adoption gradient: opt in when profitable.

### NIP-SETTLE — Epoch Settlement

A service that subscribes to pool + receipt events, computes epoch rewards, publishes settlement summaries.

```
kind: NIP_SETTLE_KIND
pubkey: settler
tags:
  ["epoch", "<epoch_number>"]
  ["host", "<host_pubkey>"]
  ["r", "<sha256>"]
  ["reward", "<sats>"]
  ["receipt_merkle_root", "<root>"]
  ["receipt_count", "<n>"]
  ["unique_clients", "<n>"]
  ["index_payout", "<index_pubkey>", "<sats>", "<unique_clients>", "<receipt_count>"]  # per-index attribution
content: JSON settlement details
sig: settler signature
```

**Index attribution accounting**: For each index with valid `index_proof` receipts: `payout(index_i) ∝ U_i × log2(1 + R_i)` — unique attributed clients dominant, volume sublinear. Routed from ROYALTY_SPLIT_INDEX (10%).

**Properties**:
- Deterministic: same inputs → same outputs. Anyone can verify.
- Multiple settlers can run simultaneously and cross-verify.
- Settlement events are signed, timestamped, publicly auditable.
- **This is L5 (permissionless aggregation) from day 1**, not post-MVP.

### NIP-PRESERVE — Structured Preservation Bid (Demand Side)

Structured bid for replication outcome. Distinct from NIP-POOL: escrowed, refundable on cancellation, cleared at epoch boundary.

```
kind: NIP_PRESERVE_KIND
pubkey: funder
tags:
  ["r", "<sha256>"]                      # content hash
  ["tier", "gold|silver|bronze|custom"]  # preset or custom
  ["replicas", "<n>"]                    # target replica count
  ["jurisdictions", "<n>"]               # minimum jurisdiction diversity
  ["duration", "<epochs>"]                # how long
  ["max_price", "<sats_per_replica_per_epoch>"]
  ["escrow_proof", "<cashu_token|payment_hash>"]  # sats locked
content: optional JSON (auto_renew, access_sats)
sig: funder signature
```

Tiers: Gold (10 replicas, 3 jurisdictions, 6mo) / Silver / Bronze / Custom.

### NIP-OFFER — Host Supply Commitment (Supply Side)

Host commits bonded capacity. Earns clearing price (typically higher than residual pool drain). Two-tier host market: commodity (spot) vs committed (bonded).

```
kind: NIP_OFFER_KIND
pubkey: host
tags:
  ["r", "<sha256>"]                      # content hash (or "*" for general capacity)
  ["replicas", "<n>"]                    # capacity offered
  ["regions", "<region_list>"]           # where
  ["price", "<sats_per_replica_per_epoch>"]
  ["bond", "<sats>"]                     # forfeited on failure
  ["duration", "<epochs>"]
  ["bond_proof", "<cashu_token|payment_hash>"]
sig: host signature
```

### NIP-CLEARING — Epoch Boundary Clearing Result

Published by clearinghouse at epoch boundary. Deterministic, auditable — anyone can verify matching from public PRESERVE + OFFER events.

```
kind: NIP_CLEARING_KIND
pubkey: clearinghouse
tags:
  ["epoch", "<epoch_number>"]
  ["r", "<sha256>"]                      # content hash
  ["clearing_price", "<sats_per_replica_per_epoch>"]
  ["matched_replicas", "<n>"]
  ["spread", "<sats>"]                   # 3% of matched value
  ["pool_credit", "<sats>"]              # net credited to pool
  ["preserve_ids", "<event_id_list>"]
  ["offer_ids", "<event_id_list>"]
content: JSON clearing details
sig: clearinghouse signature
```

---

## Pool Mechanics (Unchanged Economics)

### Accumulation

Three paths for sats to enter a pool:

1. **Auto-bids from traffic** — Every L402 paid fetch generates `auto_bid = price_sats × AUTO_BID_PCT`. Credited to pool at settlement. Content becomes self-sustaining when auto-bid income ≥ preservation cost. Consumption funds preservation — the core loop.
2. **Preserve orders** — Structured bids: `{cid, tier, replicas, duration, max_price}`. Multiple funders aggregate. Sats escrowed until clearing. Clearinghouse takes CLEARING_SPREAD_PCT on matched value.
3. **Raw NIP-POOL events** — Direct pool credit. Irrevocable. The power-user / programmatic path. Tip/upvote/fortify are all pool credits with different amounts.

### Release

Hosts earn by proving they hold + serve content:

```
cid_epoch_cap = min(pool[cid] × EPOCH_REWARD_PCT,
                    EPOCH_REWARD_BASE × (1 + floor(log2(pool[cid] / EPOCH_REWARD_BASE + 1))))

payout_weight(host) = total_proven_sats × (1 + log2(unique_clients))
host_share = cid_epoch_cap × score(host) / Σ score(eligible_hosts)
```

- Cap scales with `log2(pool)` — bigger pools drain sublinearly (endowment behavior)
- More replicas = more competition for same cap, not faster depletion
- Log-scaled caps prevent whale-funded CIDs from monopolizing host attention

### Sustainability Ratio

Per CID: `sustainability_ratio = organic_auto_bid_income / preservation_cost`. If ≥ 1.0: content is self-sustaining from traffic alone. Displayed on every content page. Novel metric — no other system measures "at what point does content earn its own survival."

---

## The Importance Index (The Product)

### Three Axes (The Importance Triangle)

| Axis | Source | Measures |
|------|--------|----------|
| **Commitment** | Pool balance (NIP-POOL events) | How much money is behind this |
| **Demand** | Receipt velocity (NIP-RECEIPT events/epoch) | How much people are consuming right now |
| **Centrality** | Graph importance (citation DAG from body edges) | How structurally connected to other funded content |

### Divergence Labels (The Games)

| Label | Condition | Incentive created |
|-------|-----------|-------------------|
| **Underpriced** | High centrality + low pool | "Fund it before others do" — funding arbitrage |
| **Flash** | High demand + low pool | "Popular but unfunded — will it survive?" — urgency |
| **Endowed** | High pool + low centrality + low demand | "Big money, no analysis — be the first" — analyst gold rush |

Every divergence creates an incentive to close it. The system self-corrects through economically motivated behavior without governance.

### Citation Graph

**Edges** (three types, from Nostr events):

| Edge type | Source | Created by |
|-----------|--------|------------|
| **ref edge** | event ref field | Every event points to one parent |
| **body edge** | `[ref:bytes32]` in content | Materializer extracts at ingest |
| **list edge** | LIST event items | Each item creates edge to constituent |

**Graph importance** (materializer-computed, display signal only):
```
importance(node) = direct_pool(node)
                 + Σ (edge_weight × importance(neighbor)) × decay
```

PageRank with economic weights. The graph appreciates over time — old content increases in importance as new analyses reference it. This is the data moat.

### Competing Indexes

Multiple materializers compute importance from the same public relay events. Each publishes scores as Nostr events:

```
kind: NIP_IMPORTANCE_KIND
tags: [["r", "<sha256>"], ["commitment", "<float>"], ["demand", "<float>"], ["centrality", "<float>"]]
```

- **Reference index** (founder): full importance triangle, deepest data moat
- **Demand-weighted indexes**: emphasize receipt velocity. Better for trending content.
- **Centrality-first indexes**: emphasize graph structure. Better for research agents.
- **Topic-scoped indexes**: deep niche signal for specific domains.

Indexes earn from: API fees, widget hosting, institutional licensing. Users/agents choose which to follow. Competition improves quality. Every index that drives consumption generates protocol royalties. **More indexes = more royalties.**

---

## Receipt System (Unchanged Cryptography)

### Why Receipts Work

| Attack | Defense |
|--------|---------|
| Fake demand (sybil clients) | Each receipt costs L402 payment + PoW compute |
| Wash trading (host pays self) | Still costs real sats + compute = demand subsidy at cost |
| Precompute receipts | payment_hash unknown until invoice issued |
| Replay receipts | epoch-bound, single use |
| Fake bytes served | response_hash must match actual content |
| Forge receipt_token | Requires mint private key (Ed25519) |

### Receipt Mints (Fragmented Day 1)

3-5 independent Ed25519 mint keypairs distributed to operators in different jurisdictions. Each runs a stateless signing service. Founder holds 1 key. Zero coordination between mints. Any 2 surviving mints = receipts keep flowing.

---

## Fee Model

### Founder Royalty (Protocol-Level)

Two components, both to FOUNDER_PUBKEY in genesis config:

**1. Pool credit royalty** — deducted at settlement when computing pool balances:
```
r(v) = 0.15 × (1 + v / 125,000,000)^(-0.3155)

v = cumulative sats credited to all pools since genesis
Rate halves every ~10× volume. Deterministic. Auditable.
```

| Cumulative volume | Rate | Cumulative founder income |
|-------------------|------|--------------------------|
| 0 | 15.00% | 0 |
| 1 BTC | 10.53% | ~0.13 BTC |
| 10 BTC | 7.50% | ~0.96 BTC |
| 100 BTC | 3.75% | ~5.27 BTC |
| 1,000 BTC | 1.82% | ~26.3 BTC |

**2. Egress royalty** — 1% flat on all L402 egress from NIP-RECEIPT-implementing servers. Never tapers. The durable passive income floor. Applies across the entire Blossom ecosystem, not just founder-operated servers.

**Enforcement**: the importance index only counts pool credits from compliant settlers. Funding through non-compliant settlers doesn't buy visibility. Since visibility is the point of funding, the royalty is the price of admission to the canonical importance index. At 1% egress, below any fork threshold.

**Royalty split** (at settlement):

| Recipient | Share | Rationale |
|-----------|-------|-----------|
| Founder | 60% | Protocol creator, data moat maintainer |
| Settler operator | 20% | Incentivizes peer settlers |
| Index operator | 10% | Routed by attributed unique clients per NIP-SETTLE; incentivizes competing indexes |
| Development fund | 10% | Ecosystem maintenance |

### Value Capture (Toll Booths)

| Toll | Type | Rate | Who earns |
|------|------|------|-----------|
| Pool credit royalty | Protocol | Volume-tapering (15% → ~0%) | Founder (split per above) |
| Egress royalty | Protocol | Flat 1% | Founder (split per above) |
| Pool payouts | Protocol | Score-weighted | Receipt-holding hosts/Blossom servers |
| Settlement fee | Market | Settler-set | Epoch settler |
| Clearing spread | Product | 3% of matched preserve value | Clearinghouse operator |
| Importance API | Product | Tiered pricing | Index operator |
| Widget licensing | Product | Volume-based | Index operator |
| Institutional API | Product | $5K-$1M/year | Index operator |
| Preserve clearing | Product | 3%, non-tapering | Clearinghouse |
| Auto-bid royalty | Protocol (indirect) | AUTO_BID_PCT of egress → pool credit (subject to credit royalty) | Founder |

**Clearing spread defensibility**: Non-tapering, compounds with volume, naturally monopolistic (liquidity begets liquidity). Orderbook doesn't migrate with a fork. Structurally the most defensible revenue stream.

---

## Content Policy

No governance. No global moderation. Operators apply local policy.

- **Blossom servers**: choose what to store/serve. Publish refusal lists.
- **Index operators**: choose what to rank. Apply local filtering.
- **Clients**: choose what to display. Import/export filter lists.
- **Protocol**: doesn't know or care what content is. Knows: hash, pool balance, receipt count.

If all hosts refuse a CID: show "not served" + "offer bounty to attract hosts who will." Availability market preserved.

---

## Agent Economy (First-Class Participants)

Agents use the same NIP-POOL, NIP-RECEIPT endpoints as humans. Three additions unlock the agent economy:

### 1. Delegation

A human authorizes an agent to act within a budget (Nostr event):
```
tags:
  ["agent", "<agent_pubkey>"]
  ["budget", "<sats_per_epoch>"]
  ["kinds", "<allowed_event_kinds>"]
  ["max_per_event", "<sats>"]
  ["expires", "<epoch>"]
```

Agent signs events with its own key. Materializer validates delegation scope. Protocol sees normal events. Revocation: delegation with budget 0.

### 2. Structured Edges

Agent-produced citation graph entries in event content:
```json
{"_edges": [{"ref": "hex64", "rel": "cites|contradicts|corroborates|supersedes", "w": 0.92}]}
```

### 3. Receipt-as-Credential

An agent's receipt portfolio is a public Nostr event stream — machine-verifiable research credential. "This agent consumed 500 filings, spent 50,000 sats, across 30 hosts, over 6 months." Receipts prove diligence and spend, not correctness.

### Agent Loop

```
Discover (importance index) → Consume (L402 fetch) → Analyze (structured edges)
  → Fund (delegation budget) → receipts feed importance → loop
```

At scale, agents are the dominant receipt generators, analysis producers, and capital allocators.

---

## Human Interface (Minimal)

**Principle:** The product is the economic visualization plus one action (Fortify). Content lives on Blossom. Discussion lives on Nostr. Identity lives in NIP-07. Borrow everything else.

### Core Surfaces

| Surface | Purpose | Phase |
|---------|---------|-------|
| Leaderboard feed (mobile-first) | Ranked list, expandable cards, Fortify inline | MVP |
| Content detail page | Blossom embed + instrument cluster + discussion + Fortify | MVP |
| Widget (Web Component) | Embeddable anywhere, mobile-responsive | MVP |
| Ref resolver | Paste URL/hash/file → resolve to importance data | MVP |
| Citation list (flat) | "Cited by" / "Cites" lists (not full graph viz) | MVP |
| Graph visualization | Full animated citation network | Phase 1.5 |

### UX Constraints

**Paid content:** Content page stays canonical. App fetches L402 invoice from Blossom server, displays in-page (or modal), user pays, bytes arrive, render inline. No redirect to host.

**Identity:** Default NIP-07 (or Amber on mobile). Ephemeral key allowed for first Fortify to reduce friction. Immediately offer "Claim this funding" — one signature linking ephemeral event to persistent pubkey. Preserves funder diversity metrics and portfolio.

**Comment ordering:** Baseline = recency + author trust (receipt portfolio as lightweight signal). Boost = sats on comment event. Don't weight by sats alone — prevents paid reply spam. Body edges (`[ref:bytes32]`) create citation structure regardless of sats.

**Ref resolver (canonicalization):** Must answer "what is the ref?" Inputs: Blossom URL (extract SHA256), direct file (hash in browser via Web Crypto API), Nostr event (extract `r` tag). Prominent input on leaderboard: paste URL/hash/drop file → resolve → show importance or "Not indexed — be first to Fortify."

**"Not served" / "Not indexed" states:** First-class. Show pool balance, target bounty to attract first host, who refused (optional). One button: Fortify to summon hosts. Censorship-as-market made visible.

**"Not indexed" state:** Content exists on Blossom but no ANNOUNCE. Ref resolver encounters this → "Be the first to index" → one-tap ANNOUNCE + optional Fortify.

**Widget:** Ship on CDN first. Dogfood (Blossom-hosted widget) later when reliability proven.

**Mobile:** Target global mobile users. Fortify = deep link (`lightning:`) for mobile wallets; QR for cross-device. Leaderboard + expandable cards = primary flow; content detail = deep-dive. Offline: cache last ranking, queue Fortify events for reconnect, show instrument cluster even when content embed unavailable.

**OG cards / social preview:** Share `/v/{hash}` → rich preview with importance data, funder count, sustainability. The link IS the pitch.

### Distribution (Interface Everywhere)

Importance scores published as Nostr events → any Nostr client can consume. Widget embeddable on any page. OG cards for social shares. Importance API for agents. No browser extension at MVP (mobile-first target).

---

## MVP Build Order

### Phase 1: Prior Work (Complete)

File layer, L402, node kit, receipt SDK, pin contracts. See `progress_overview.txt`. Partially reusable — receipt cryptography, physics library, chunking logic carry forward. Custom coordinator/gateway infrastructure is superseded by Nostr-native design.

### Phase 2: Protocol (Core NIPs)

**Step 1: NIP-POOL spec + reference settler**
- Define pool credit event kind
- Reference settler: subscribes to relays, maintains pool state in Postgres, applies royalty formula
- Pool query API: `GET /pool/<hash>` → balance, funder count, drain rate
- Open source from day 1

**Step 2: NIP-RECEIPT spec + Blossom addon**
- Define receipt event kind
- Blossom server addon: L402 gate, receipt token minting, receipt event publishing
- Distribute 3-5 mint keypairs to peers in different jurisdictions
- Receipt verification SDK (standalone, zero deps — carry forward from Phase 1)

**Step 3: NIP-SETTLE spec + settlement service**
- Settler subscribes to pool + receipt events
- Computes epoch rewards (log-scaled caps, score-weighted splits, royalty deduction)
- Publishes settlement summaries as Nostr events
- Cross-verification: multiple settlers, same inputs, same outputs
- Bitcoin anchoring: daily tx commits epoch root + snapshot hash

### Phase 3: Product (The Importance Index)

**Step 4: Leaderboard + storefront**

Core surface:
- Global leaderboard: `/` — content ranked by importance triangle (commitment × demand × centrality). Mobile-first: scrollable feed, expandable cards, Fortify inline.
- Content page: `/v/<ref>` — Blossom embed (left) + instrument cluster (right). Paid content: fetch L402 invoice in-page, user pays, render inline. No redirect.
- Ref resolver: paste URL/hash/drop file → resolve to importance. Handles "Not indexed" (no ANNOUNCE yet) and "Not served" (pool exists, zero hosts).
- Instrument cluster: funding counter, funder count, demand, replicas, sustainability ratio, citations, active preserve backers, aggregate tier, supply curve, sustainability projection
- **Fortify CTA** (three options): (1) **Preserve** (primary) — tier selector Gold/Silver/Bronze → NIP-PRESERVE with escrowed sats. (2) **Fortify** (secondary) — raw NIP-POOL, irrevocable, immediate. (3) **Fund** (power-user) — freeform sats.
- Fortify button: Lightning payment → NIP-POOL event → counter increments in <60s. Mobile: deep link (`lightning:`). Ephemeral key allowed; prompt "Claim this funding" (link to NIP-07).
- Preserve tiers: Gold (10 replicas, 3 jurisdictions, 6mo) / Silver / Bronze
- Discussion: Nostr events with ref=content hash. Order: recency + author trust + sats boost. `[ref:bytes32]` rendered as citation links.
- Citation list: "Cited by" / "Cites" (flat lists). Full graph viz deferred to Phase 1.5.
- Orphan view: funded but under-analyzed content ("needs analysis" callouts)
- OG cards: share `/v/{hash}` → rich preview with importance data, funder count, sustainability

Embeddable widget:
- Compact leaderboard + Fortify button for external sites
- Web Component, mobile-responsive. Ship on CDN first (Blossom-hosted later)
- Multi-host resolution, localStorage caching, self-updating
- Ship before media outreach — every embed is a distribution + funding channel

Real-time:
- SSE from materializer: leaderboard + content pages update within seconds
- Live activity feed: funding events, new hosts, replica changes
- Header stats: document count, total sats, host count, jurisdictions

Bitcoin integrity anchor:
- Daily tx: Taproot tweak with epoch root + snapshot hash
- Verify page: `/verify/<ref>` → inclusion proof → Bitcoin tx link
- The "integrity radiator" — institutions won't touch you without it

**Step 5: Importance API + competing index support**
- Publish IMPORTANCE event kind spec
- Reference importance computation: open source
- API: `/api/v1/importance`, `/api/v1/events` — L402-gated, tiered pricing
- Free tier for Nostr clients (drives adoption)
- Paid tier for institutional consumers and agent platforms

**Step 6: Clearinghouse** (parallel with Step 4, not after Step 5)

Matching engine: subscribes to NIP-PRESERVE + NIP-OFFER events, aggregates demand per CID, matches at epoch boundary, publishes NIP-CLEARING. Settler treats clearing events as pool credits (minus spread). 3% CLEARING_SPREAD_PCT on matched value.

- **Escrow**: MVP trust-based (clearinghouse holds sats via Lightning address). Post-MVP: Cashu ecash escrow.
- **Bid aggregation display**: preserve backers count, aggregate tier, supply curve, sustainability projection in instrument cluster.
- **Two-tier host market**: commodity (spot, pool drain only) vs committed (bonded OFFER, earns clearing price).
- **MVP simplification**: No bond enforcement (host fails → preserve degrades to best-effort spot). No multi-sig — founder-operated. Add when second operator joins.

**Phase 1.5:**
- Graph visualization: full animated citation network (deferred until enough edges justify it)

### Parallelism

```
Phase 2 (protocol):
[1 NIP-POOL + settler] ──────────►
     [2 NIP-RECEIPT + Blossom addon] ──────────►
          [3 NIP-SETTLE] ────────►

Phase 3 (product — parallel with Phase 2):
  [4 Leaderboard + storefront] ──────────────────►
  [6 Clearinghouse (basic)] ──────────►          # parallel with 4
       [5 Importance API] ──────────►
```

---

## Role Fragmentation (Founder-Elimination Resistance)

Every role is profitable to operate independently — peers earn, not volunteer.

| Role | Day 1 operators | Revenue | Failure mode |
|------|----------------|---------|--------------|
| Receipt mints | 3-5 peers, different jurisdictions | Mint fee (market-set) | Any 2 survive = receipts flow |
| Settlers | Founder + 1-2 peers | 20% of royalty split | Any 1 survives = settlements continue |
| Importance indexes | Founder + competing operators | API fees per index | Any 1 survives = rankings exist |
| Clearinghouse | Founder + 1-2 peers (multi-sig) | Clearing spread (split) | Degrades to raw pool credits |
| Royalty recipient | Threshold key (2-of-3) | Protocol royalties | Remaining holders access funds |
| Code / DNS | 2-3 maintainers, multi-platform | None | Any 1 survives = code available |

### Longevity Properties (Day 1 by Architecture)

| Property | How | Prior plan status |
|----------|-----|-------------------|
| Multi-root discovery (L2) | Nostr relays are already multi-root | Was post-MVP |
| Self-verifying state (L4) | Pool + receipt events are public on relays | Was post-MVP |
| Permissionless aggregation (L5) | Anyone can run settler from public events | Was post-MVP |
| Distributed mints (L1) | 3-5 peers from day 1 | Was day 1 |
| Deterministic builds (L6) | Nix flake / pinned Docker | Unchanged |
| Bitcoin anchoring (L7) | Daily tx with epoch root | Unchanged |

### The Longevity Test

> If founder is permanently removed at midnight: do receipts still mint (distributed mints), events still propagate (Nostr relays), blobs still serve (Blossom servers), state still computable (public events), epochs still settle (peer settlers), indexes still rank (competing materializers), code still buildable (multi-platform repos)? Every "no" is a failure. Every "yes" is achieved by architecture, not by deferred engineering.

---

## Go-to-Market

### Positioning

Not "decentralized storage." Not "censorship-resistant platform."

**"The economic indexing layer for content consumption — human and agent."**

We don't store content (Blossom servers do). We don't distribute events (Nostr relays do). We don't operate payment rails (Lightning/Cashu do). We settle the economy, compute the index, and match preservation demand to supply.

For consumers: **"Content that can't be killed, priced by the people who care."**

For institutions: **"Proof URLs — verifiable evidence links with Bitcoin-anchored timestamps."**

For agent platforms: **"The demand oracle — what should your agent consume next?"**

### Bootstrap Sequence

```
Week 1:    Founder uploads Tier 1 seed content (Epstein files, deplatformed archives)
           Founder seeds citation graph: 200+ body edges, 50+ docs, controversy clusters
           Settler live, watching relays. Importance index computing.
           Leaderboard goes live. Fortify button works via NIP-POOL events.
           Widget ships (embeddable on any page).
           3-5 receipt mints distributed across jurisdictions.

Week 2:    Share leaderboard on Nostr, Bitcoin Twitter, journalism communities.
           Contact independent media: "embed this widget."
           Nostr users can Zap content hashes from any client → pools credit → rankings update.
           First organic funding → leaderboard updates real-time → viral loop starts.

Week 3-4:  First Blossom servers implement NIP-RECEIPT (attracted by pool revenue).
           Media embeds drive traffic. Widget on 10+ external pages.
           First censorship event amplifies leaderboard.
           First peer settler running (cross-verification live).

Month 2:   First competing importance index (different weighting formula).
           Widget on 50+ pages. Receipt volume validates economics.
           Agent platforms inquire about importance API.

Month 3+:  Blossom servers earning pool revenue they can't get elsewhere.
           Nostr clients integrating importance scores as ranking signal.
           Preserve clearinghouse matching demand to supply.
           The system grows without founder effort — incentives do the work.
```

### What NOT to Do

- Don't curate. Operate infrastructure, not editorial.
- Don't moderate globally. Hosts/indexes choose locally.
- Don't build social features first. Economics first, social later.
- Don't chase volume. Chase intensity. 100 people × 21 sats > 10,000 free impressions.
- Don't explain the protocol. Show the content. "47 people funded this document's survival" is the entire pitch.
- Don't build custom infrastructure that Nostr already provides.

### Obsession Metric (First 60 Days)

**Funders-per-asset** — breadth of funding support. A CID funded by 100 people at 21 sats is stronger than 1 whale at 2,100. Every design decision judged by: does it increase funders-per-asset?

---

## Content on Blossom (MVP Simplification)

MVP content (documents, images, text <100 MB) uses Blossom whole-file storage. `PUT /upload` → SHA256. `GET /<sha256>` → bytes. Multiple servers already deployed. Nostr auth (NIP-98).

**Deferred**: Block-level chunking (FileManifest, AssetRoot, 256 KiB blocks) deferred to post-MVP when streaming media requires it. Receipt granularity at MVP is per-file, not per-block. Acceptable for MVP content scale — court filings, PDFs, images, text.

**Post-MVP chunking**: Manifest events listing chunk hashes on top of Blossom. Enables seek-aware playback, adaptive bitrate, block-level receipt granularity. Buildable when needed, not at launch.

---

## Constants (Tunable)

| Constant | Value | Rationale |
|----------|-------|-----------|
| FOUNDER_ROYALTY_R0 | 0.15 (15%) | Starting royalty at genesis |
| FOUNDER_ROYALTY_V_STAR | 125,000,000 sats (1.25 BTC) | Scale constant |
| FOUNDER_ROYALTY_ALPHA | log(2)/log(9) ≈ 0.3155 | Halves every ~10× volume |
| EGRESS_ROYALTY_PCT | 0.01 (1%) | Flat, never tapers |
| EPOCH_LENGTH | 4h | 6 payout cycles/day |
| EPOCH_REWARD_PCT | 2% | Cap per CID per epoch |
| EPOCH_REWARD_BASE | 50 sats | Base cap; scales log2 |
| POW_TARGET_BASE | 2^240 | ~200ms mobile |
| AUTO_BID_PCT | 0.02 (2%) | Egress → pool feedback |
| CLEARING_SPREAD_PCT | 0.03 (3%) | Clearinghouse toll |
| ROYALTY_SPLIT_FOUNDER | 0.60 | 60% to founder |
| ROYALTY_SPLIT_SETTLER | 0.20 | 20% to settler operator |
| ROYALTY_SPLIT_INDEX | 0.10 | 10% routed by attributed unique clients per NIP-SETTLE |
| ROYALTY_SPLIT_DEV | 0.10 | 10% to development fund |

Full constant table from `mvp_plan.md` §Constants carries forward for deferred features (sessions, PoW free tier, preserve tiers, etc.).

---

## Post-MVP

### Deferred (build when triggered)

- Block-level chunking on Blossom (trigger: streaming media demand)
- Session/tab model for streaming (trigger: video content)
- PoW-gated free tier (trigger: public-interest content with access budgets)
- Formal preserve clearing + host commitments (trigger: host count > 20)
- Author revenue share enforcement at settlement (trigger: multiple competing settlers)
- Vine model + harmonic allocation (Layer B — see `post_mvp.md`)
- Paid inbox, topic hashes, plural discovery (Layer B)

### Revenue Layers (build when triggered)

| Layer | Trigger | Revenue profile |
|-------|---------|-----------------|
| Priority replication auctions | 10+ hosts, replication speed frustration | Convex (crisis spikes) |
| Pin insurance / SLA | 6mo telemetry, 50+ hosts, institutional demand | Recurring, high-margin |
| Namespace auctions | Organic "topic ownership" attempts | Culturally convex |
| Institutional API | Organic inquiries after consistent traffic | Recurring, near-zero marginal cost |
| Pro dashboard | 1000+ daily active users | Recurring, linear |
| Attestation service | L7 live, first provenance request | Grows with history depth |

### Day-1 Data Constraint

The graph dataset appreciates over time. Every event, receipt, body edge, graph computation, and threshold crossing stored in queryable, exportable schema from day 1. Materialized views are disposable. The raw event stream is sacred. Data lost is revenue destroyed.

---

## The One-Sentence Version

**Build the pool, the receipt, the settler, and the leaderboard. Borrow everything else from Nostr. Earn protocol royalties from the entire ecosystem. The importance index is the product.**
