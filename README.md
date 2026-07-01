# Mantle Atlas — MVP

> The Intelligence Layer for Onchain Research. This is a scoped MVP of the
> full Mantle Atlas PRD, built for the Mantle AI Track 2 (Research Agent)
> submission.

## What this ships

**One flow, done properly:** ask a research question in plain English →
Mantle Atlas extracts intent, pulls real onchain evidence, validates it, and
returns an institutional-format report with a confidence rating and cited
sources.

Supported question types:
- Protocol TVL analysis — *"Why did Ondo TVL increase over the last 90 days?"*
- Two-protocol comparison — *"Compare mETH and Ondo TVL over the last 60 days"*
- Mantle chain-wide TVL trend — *"What's the Mantle chain TVL trend this month?"*
- Wallet lookup — paste any `0x...` address

## What's intentionally out of scope for the MVP

The full PRD (Wallet/Protocol Intelligence screens, whale tracking, saved
report dashboard, PDF/JSON export, risk-signal scoring) is a multi-week
build. This MVP proves the hardest and most differentiating part end to end:
**retrieval-grounded, explainable, institutional-quality reasoning** — the
thing that separates this from a dashboard. Everything else in the PRD is
additive UI on top of a pipeline that already works.

## Why real data sources instead of a mocked `mantle-data-indexer`

The PRD names `mantle-data-indexer v0.1.18` as the data layer, but there's no
publicly discoverable spec for it. Rather than build against a fictional API
(which would demo fine and then return nothing real), this MVP wires up
**real, live, public data**:

- [DefiLlama](https://defillama.com) — protocol + Mantle chain TVL history, no key required
- [Mantlescan](https://mantlescan.xyz) — wallet transaction history, works without a key at low volume

Both are wrapped behind the exact contract described in
[`skills/mantle-data-indexer/SKILL.md`](./skills/mantle-data-indexer/SKILL.md),
so this is a genuine, working AI Agent Skill — if the official indexer ships,
only `api/lib/dataSources.js` needs to change.

## Architecture

```
Frontend (static HTML/CSS/JS)
        │
        ▼
POST /api/research  (Vercel serverless function)
        │
        ├─ 1. extractIntent()      — Gemini call: question → structured plan
        ├─ 2. dataSources.js       — real evidence via DefiLlama / Mantlescan
        ├─ 3. evidence validation  — confidence scoring, caveat flagging
        └─ 4. generateReport()     — Gemini call: evidence → institutional report
        │
        ▼
Markdown report + evidence ledger (query time, range, sources, confidence)
```

Retrieval and reasoning are deliberately separate calls: the model that
writes the report is never given room to invent a number it wasn't handed.

## Local setup

```bash
npm install -g vercel
cd mantle-atlas
cp .env.example .env
# add your GEMINI_API_KEY to .env (free, no card — aistudio.google.com/apikey)
vercel dev
```

## Deploy (same pattern as your other Vercel projects)

```bash
vercel --prod
```

Then in the Vercel dashboard, set environment variables:
- `GEMINI_API_KEY` (required, free tier — get one at aistudio.google.com/apikey)
- `MANTLESCAN_API_KEY` (optional, raises wallet-lookup rate limits)

## File map

```
api/
  research.js              — main pipeline orchestration
  lib/
    dataSources.js         — DefiLlama + Mantlescan fetchers
    promptEngine.js         — Gemini calls: intent extraction + report generation
public/
  index.html               — research terminal UI
  style.css                — design system (ink/parchment/brass ledger aesthetic)
  app.js                   — submit flow, evidence ledger rendering
skills/
  mantle-data-indexer/
    SKILL.md                — the Agent Skill contract
```

## Known limitations to disclose in the submission

- TVL-only evidence for now — no swap volume, staking APY, or governance data yet.
- Wallet lookups return the last ~50 transactions, not a full forensic history.
- Protocol name resolution depends on DefiLlama's chain tagging, which can
  lag brand-new Mantle deployments by a few days.
- No persistence — every query is stateless (no saved reports, no session
  history) in this MVP cut.
