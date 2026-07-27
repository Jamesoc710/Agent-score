# AgentRank

**Is the web ready for agents?**

AgentRank ranks real websites by how often a browser agent can actually complete a real task on them, and tests whether static "agent-readiness" scores (like Google's Lighthouse Agentic Browsing audit) predict measured agent success.

Static scanners inspect your site and guess. AgentRank runs the agent and measures.

## Why this exists

- Agent traffic is a real and fast-growing share of web traffic, on a web built for humans clicking buttons.
- Lighthouse 13.3 shipped an Agentic Browsing audit category (accessibility-tree quality, layout stability, llms.txt, WebMCP) but publishes pass/fail signals without validating that they predict real task completion.
- Existing agent benchmarks (WebArena, TAU-bench) hold the website constant and score the agent. AgentRank inverts that: we hold the agent constant and score the website.
- Nobody has joined the two axes: static readiness score (x) vs measured behavioral success (y). That correlation, across real named sites, is the headline result.

See [docs/PRODUCT.md](./docs/PRODUCT.md) for the full thesis and market landscape.

## How it works

1. **Static lane** (`scripts/lane1-lighthouse.ts`): runs the official Lighthouse CLI with the Agentic Browsing category against each cohort site. We reimplement nothing; the static layer is Google's.
2. **Behavioral lane** (`scripts/lane2-agent.py`): a fixed browser agent (Gemini + Playwright, one model, one prompt, one harness) attempts a fixed-shape task on each site, 5 trials per site. Success is scored against answers pre-registered by hand before any run. See [docs/METHODOLOGY.md](./docs/METHODOLOGY.md).
3. **Leaderboard + correlation** (Next.js app): sites ranked by measured success rate, per-site failure breakdowns, and the scatter of static score vs behavioral success.

The cohort is 28 real sites chosen for score spread, from Stripe to legacy government portals: [docs/COHORT.md](./docs/COHORT.md), canonical data in [data/cohort.csv](./data/cohort.csv).

## Status

Active buildout toward the first public leaderboard on real data. Current state, honestly: the frontend is complete but renders fixture data by default; Lighthouse scores exist for the earlier draft cohort; the behavioral lane has not yet produced real runs. The data layer is migrating from Firebase to Supabase + Vercel. Phases and sequencing live in [docs/ROADMAP.md](./docs/ROADMAP.md).

## Quick start (local dev, fixture data)

```bash
cp .env.local.example .env.local   # ships with USE_FAKE_DATA=true, no backend needed
npm install
npm run dev
# -> http://localhost:3000
```

### Pipeline commands

```bash
npm run lane1                      # Lighthouse over the cohort -> data/lighthouse-results.json (+ DB when configured)
npx tsx scripts/lane1-lighthouse.ts stripe vercel   # specific sites

pip install -r scripts/requirements.txt && playwright install chromium
GEMINI_API_KEY=... python scripts/lane2-agent.py --sites stripe --trials 3   # behavioral runs (needs DB configured)
```

## Repo map

| Path | What it is |
|---|---|
| `app/`, `components/`, `lib/` | Next.js frontend; `lib/types.ts` is the frozen data contract, `lib/queries.ts` the single data layer |
| `scripts/` | The two pipeline lanes + seed scripts |
| `data/cohort.csv` | Canonical cohort: per-site question, pre-registered answer, match rule |
| `data/lighthouse-results.json` | Latest local Lighthouse output |
| `docs/` | Product, architecture, methodology, cohort, roadmap |

## Docs

| Doc | What it covers |
|---|---|
| [docs/PRODUCT.md](./docs/PRODUCT.md) | Thesis, market landscape, product direction |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design, data contract, environment |
| [docs/METHODOLOGY.md](./docs/METHODOLOGY.md) | The pre-registered scoring contract and trial protocol |
| [docs/COHORT.md](./docs/COHORT.md) | The 28-site cohort, site by site |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Build phases and future work |
