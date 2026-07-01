---
name: mantle-data-indexer
description: Retrieve historical and current Mantle ecosystem data — protocol TVL, chain-wide TVL, and wallet activity — for use in blockchain research, comparison, and reporting workflows. Use this skill whenever a task requires factual onchain evidence about a protocol deployed on Mantle, the Mantle chain itself, or a specific wallet address, rather than reasoning from general knowledge. Do not use for real-time price feeds, order-book data, or any chain other than Mantle.
version: 0.1.18-community
---

# mantle-data-indexer

## Purpose

This skill is the single source of truth for onchain facts in any Mantle
research workflow. Callers (LLM agents, apps) MUST NOT fabricate protocol
names, TVL figures, wallet histories, or endpoint URLs — every factual claim
about Mantle onchain activity should trace back to a call defined here.

This implementation is a community-built compatibility layer: it exposes the
same request/response contract the Mantle Data Indexer is expected to provide
(see "Contract" below), backed today by public, no-auth data providers
(DefiLlama for TVL, Mantlescan for wallet/tx data). If the official indexer
becomes available, only the internals of `api/lib/dataSources.js` need to
change — the contract stays stable.

## When to use this skill

- A question asks "why did TVL change" for a Mantle protocol
- A question asks about a specific 0x... wallet's activity on Mantle
- A question asks about the Mantle chain's aggregate TVL trend
- A question compares two protocols on Mantle

## When NOT to use this skill

- Non-Mantle chains
- Real-time price/orderbook data (not covered)
- Governance/proposal text (not covered)

## Contract

### Request Normalization
Every call must resolve relative time phrases ("last 90 days") into an
absolute UTC `[start, end]` range before querying. Never pass relative time
strings to the underlying provider.

### Operations

**`resolveMantleProtocol(nameGuess: string) -> Protocol | null`**
Resolves a loose name to a protocol confirmed to be deployed on Mantle.
Returns `null` (not a guess) if no confident match exists.

**`getProtocolTvlHistory(slug: string) -> { points, currentTvl, scope, source }`**
Time series of TVL. `scope` is `"mantle-only"` when the provider can isolate
Mantle-chain TVL specifically, or `"all-chains"` as a fallback — this must be
surfaced to the end user, never silently treated as Mantle-only.

**`getMantleChainTvlHistory() -> { points, currentTvl, source }`**
Chain-wide historical TVL for Mantle.

**`getWalletActivity(address: string) -> { txCount, firstTx, lastTx, transactions, source, blocked?, empty? }`**
Recent transaction history for a wallet. Sets `blocked: true` (with a
`reason`) if the endpoint is unreachable or misconfigured, and `empty: true`
if the query succeeded but returned no data — these are explicitly different
outcomes and must never be collapsed into one.

### Endpoint Handling
Never fabricate a GraphQL/SQL endpoint. If a required endpoint is
unavailable or unauthenticated beyond rate limits, return a blocked result
with a `reason` field — this is a configuration gap, not "no data exists,"
and callers must present it that way to the user.

### Output Requirements
Every result that reaches a report MUST retain: source URL, UTC fetch time
implicit in the caller's query, and (for TVL) the `scope` field. Reports
built on this evidence must cite the source host, not just say "the data
shows."

## Known limitations (be upfront about these)

- Protocol resolution depends on DefiLlama's chain tagging, which can lag
  new Mantle deployments.
- Wallet activity depth is capped (last ~50 txs) — sufficient for behavior
  summaries, not exhaustive forensic audits.
- No governance, staking-reward, or bridge-specific endpoints yet — the PRD's
  full Wallet/Protocol Intelligence feature set (risk signals, restaking
  activity, counterparty graphs) is out of scope for this compatibility
  layer and would need the official indexer or additional providers.
