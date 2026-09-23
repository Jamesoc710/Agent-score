# AgentRank

**Is the web ready for agents?**

AgentRank measures how often one fixed browser agent can complete one fixed-shape task on real, named websites, with every answer registered before any run, and checks whether static "agent-readiness" scores (Google's Lighthouse Agentic Browsing category among them) predict that measured success.

Static scanners inspect your site and guess. AgentRank runs the agent and measures.

## Why this exists

- Agent traffic is a real and fast-growing share of web traffic, on a web built for humans clicking buttons.
- Lighthouse ships an Agentic Browsing category: six audits at 13.3.0, the version v1 ran (`agent-accessibility-tree`, `cumulative-layout-shift`, `llms-txt`, and three WebMCP audits, two of them informative and never scored); seven at 13.5.0, the version pinned since the re-measurement of 2026-09-23, with `ard-schema` added. Chrome displays the category as a fraction of applicable checks and publishes no score, and nothing in it has been validated against real task completion.
- Existing agent benchmarks (WebArena, TAU-bench) hold the website constant and score the agent. AgentRank inverts that: we hold the agent constant and score the website.
- Nobody has joined the two axes: static readiness score (x) vs measured behavioral success (y). That correlation, across real named sites, is the headline result.

See [docs/PRODUCT.md](./docs/PRODUCT.md) for the full thesis and market landscape.

## How it works

1. **Static lane** (`scripts/lane1-lighthouse.ts`, launched by `scripts/run-batch.sh`): runs the official Lighthouse CLI with the Agentic Browsing category against each cohort site. We run the official CLI unmodified and record what it returns, including where its own audits do not apply. Since 2026-09-23 every raw report is retained under `data/lhr/<batch>/`, three runs per site, with the version, Chrome build and every audit's display mode recorded.
2. **Behavioral lane** (`scripts/lane2-agent.py`): a fixed browser agent (Gemini + Playwright, one model, one prompt, one harness) attempts a fixed-shape task on each site, 5 trials per site. Success is scored against answers pre-registered by hand before any run. See [docs/METHODOLOGY.md](./docs/METHODOLOGY.md).
3. **Leaderboard + correlation** (Next.js app): sites listed by measured success rate with no rank column, per-site failure breakdowns, and the scatter of the Lighthouse category mean against behavioral success.

The cohort is 28 real sites chosen for score spread, from Stripe to legacy government portals: [docs/COHORT.md](./docs/COHORT.md), canonical data in [data/cohort.csv](./data/cohort.csv).

## Status

v1 was measured on 19 August 2026: 28 sites, 280 trials, two Gemini arms behind one frozen harness, scored against answers registered and git-tagged before the run. It is live at [agent-score-weld.vercel.app](https://agent-score-weld.vercel.app) (the dataset and its citation block at [/data](https://agent-score-weld.vercel.app/data); the pre-registration record and contact at [/methodology](https://agent-score-weld.vercel.app/methodology)) and released as the git tag `dataset-v1`, archived on Zenodo as [doi:10.5281/zenodo.22924988](https://doi.org/10.5281/zenodo.22924988) (the concept DOI [10.5281/zenodo.22924987](https://doi.org/10.5281/zenodo.22924987) always resolves to the latest version). The static axis was re-measured on 2026-09-23 with every report kept, and the corrections that followed are dated sections in [docs/METHODOLOGY.md](./docs/METHODOLOGY.md). Pushes to `main` deploy production. What is done, what is registered and what could run next, on what condition, is in [docs/ROADMAP.md](./docs/ROADMAP.md).

## Quick start (local dev, fixture data)

```bash
cp .env.local.example .env.local   # ships with USE_FAKE_DATA=true, no backend needed
npm install
npm run dev
# -> http://localhost:3000
```

### Pipeline commands

```bash
npm run seed:sites                 # data/cohort.csv -> sites table (needs service key)

npm run lane1                      # Lighthouse over the cohort -> data/lighthouse-<batch>.json
npx tsx scripts/lane1-lighthouse.ts stripe vercel   # specific sites
bash scripts/run-batch.sh --lane lighthouse --vantage residential --batch lh-v2-<yyyymmdd>
                                   # a dated batch with manifest, health card and retained reports

pip install -r scripts/requirements.txt && playwright install chromium
GEMINI_API_KEY=... python scripts/lane2-agent.py --sites stripe --trials 3
# -> data/agent-runs-<batch>.jsonl

npm run import                     # load a batch's artifacts into Supabase
```

Neither lane writes to the database. They produce local artifacts and `import-results.ts` loads
them, so an interrupted run keeps everything already measured and a batch can be re-imported.

## Repo map

| Path | What it is |
|---|---|
| `app/`, `components/`, `lib/` | Next.js frontend; `lib/types.ts` is the frozen data contract, `lib/queries.ts` the single data layer |
| `scripts/` | The two pipeline lanes, the cohort seeder, and the one script that writes to the DB |
| `supabase/migrations/` | Schema, git-tracked, applied with the Supabase CLI |
| `data/cohort.csv` | Canonical cohort: per-site question, pre-registered answer, match rule |
| `data/lighthouse-*.json`, `data/agent-runs-*.jsonl` | Per-batch lane artifacts (the record of a run) |
| `data/lhr/<batch>/`, `data/manifest-*.json`, `data/env-*.txt`, `data/health-*.json` | Retained raw Lighthouse reports, batch manifests, environment records and health cards, from the dated batches of 2026-09-23 on |
| `data/scanners-<date>.json` | The same-day scanner panel (ora.ai, Cloudflare), raw responses, fetched data never imported |
| `public/exhibit/` | The two authored pages of the Goodhart pair |
| `docs/` | Product, architecture, methodology, cohort, the exhibit's record, roadmap, and the Lighthouse report |

## Docs

| Doc | What it covers |
|---|---|
| [docs/PRODUCT.md](./docs/PRODUCT.md) | Thesis, market landscape, product direction |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design, data contract, environment |
| [docs/METHODOLOGY.md](./docs/METHODOLOGY.md) | The pre-registered scoring contract and trial protocol |
| [docs/COHORT.md](./docs/COHORT.md) | The 28-site cohort, site by site |
| [docs/EXHIBIT.md](./docs/EXHIBIT.md) | The authored Goodhart pair: its own pre-registration record and measured result |
| [docs/lighthouse-report.md](./docs/lighthouse-report.md) | The report for the Lighthouse team: the audit defects, the corrections, the counterexample and the bounded null |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | What is done, what is registered, the kill review, and what could run next |
