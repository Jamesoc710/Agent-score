# AgentRank — architecture

## System shape

Two measurement lanes write to one database; the frontend is a read-only view over it.

```
data/cohort.csv  (canonical cohort: question, answer, match rule per site)
      |
      ├── scripts/seed-sites.ts  ->  sites table
      |
      ├── Lane 1: scripts/lane1-lighthouse.ts
      |     Lighthouse CLI, agentic-browsing category only
      |     -> data/lighthouse-<batch>.json
      |
      └── Lane 2: scripts/lane2-agent.py
            Gemini + Playwright browser agent, N trials per site
            scored against pre-registered answers (docs/METHODOLOGY.md)
            -> data/agent-runs-<batch>.jsonl  (append-only)
                  |
                  v
      scripts/import-results.ts --batch <batch>   (the only writer)
                  |
                  v
            Supabase Postgres
                  |
                  v
      Next.js app  (lib/queries.ts is the single data layer)
        /                   leaderboard: success rate, LH score, top failure mode
        /site/[slug]        sub-audit breakdown, trial log, per-trial transcript replay,
                            answer key
        /correlation        scatter + rank correlation with bootstrap CI and n
        /correlation/audits per-sub-audit attribution, multiplicity-corrected
        /correlation/exhibit the authored Goodhart pair, off this path entirely: read
                            from committed artifacts, never in the database
```

`AGENTRANK_COHORT_CSV` points both lanes at a different pre-registered row set without
touching the frozen loop. It exists for the authored Goodhart exhibit
(`data/exhibit-cohort.csv`, `docs/EXHIBIT.md`), which is measured by the same lanes into its
own `batch_label` and is deliberately **never imported**: `lib/queries.ts` selects every row of
`sites`, so a row there would land on the cohort leaderboard and in the cohort's n. Unset, both
readers still resolve `data/cohort.csv`.

Neither lane talks to the database. They write local artifacts; `import-results.ts` loads a
batch. So an interrupted or offline run loses nothing already measured, a batch can be
re-imported at will, and exactly one file holds a credential that can write.

Aggregation (success rate, ranking, correlation) happens at read time in `lib/queries.ts`, not
in the pipeline and not in SQL views. Lanes write raw facts only.

## Data contract

Frozen in `lib/types.ts`, mirrored by `supabase/migrations/*_init_schema.sql`; lanes and
frontend build against it independently.

- **sites** — pre-registered config, written before any run, one column per `data/cohort.csv`
  column: `site_id`, `name`, `tier`, `start_url`, `question`, `answer_substring`, `match_rule`,
  `flag`, `answer_note`
- **lighthouse_results** — one per (site, batch): `site_id`, `batch_label`, `lh_total` (0-100),
  four sub-audit flags (`lh_accessibility_tree`, `lh_layout_stability`, `lh_llms_txt`,
  `lh_webmcp`), `run_at`
- **agent_runs** — one per trial: `site_id`, `agent_id`, `batch_label`, `trial_number`,
  `success`, `step_count`, `duration_seconds`, `failure_mode`, `transcript` (jsonb), `run_at`

`agent_id` exists so a multi-agent panel (Claude, GPT alongside Gemini) can be added without a
schema break. Failure modes (fixed enum): `success`, `blocked`, `timeout`, `wrong_extraction`,
`navigation_stuck`, `error`.

Both result tables are append-only, keyed by `batch_label`: a re-run writes a new batch rather
than overwriting one that cost money to produce, and a smoke batch never pollutes a published
one. `lib/dataset.ts` names the batch and agent the app publishes (`ACTIVE_BATCH`,
`ACTIVE_AGENT_ID`); every read is scoped to them, because blending two batches into one
success rate would silently merge two experiments. `lighthouse_latest` is a convenience view
over the newest batch per site, for ad-hoc inspection rather than for the app.

## Stack

- **Supabase Postgres** (project `agentrank`, ref `bfhxbvaosagfrkuhnuvp`, us-west-2) for all
  three tables. Schema changes only via git-tracked CLI migrations in `supabase/migrations/`.
- Two credentials, deliberately split. The app reads with the anon/publishable key against
  RLS select-only policies, so nothing the site renders can write. `scripts/import-results.ts`
  and `scripts/seed-sites.ts` write with the service key, which bypasses RLS. Reads happen in
  server components via `lib/supabase.ts`; the service client lives in `scripts/`, out of
  reach of anything the app bundles.
- All three data pages are `dynamic = "force-dynamic"`: results change when a batch is
  imported, not when the app is built, and a build must not need database credentials.
- **Vercel** hosts the Next.js app: project `agent-score`, production at
  <https://agent-score-weld.vercel.app>, git-connected to `Jamesoc710/Agent-score`.
  **Any push to `main` deploys production.** Preview deployments build on every other branch.
  The app's Vercel env holds only `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ACTIVE_BATCH` and `USE_FAKE_DATA` — deliberately no
  service key, since nothing the site renders is allowed to write.

## Current state vs target

- Firebase is fully removed as of Phase 1: `lib/firebase-admin.ts`, `firebase.json`,
  `firestore.rules`, `.firebaserc`, `scripts/seed-firestore.ts`, and the npm `firebase` /
  `firebase-admin` plus the Python `firebase-admin` dependencies are gone.
- Real data is the default path. Fixtures (`lib/fake-data.ts`, 3 rows sampled from the
  canonical cohort) render only when `USE_FAKE_DATA=true` — there is no silent fallback, so a
  misconfigured deploy fails loudly instead of serving invented numbers.
- `data/cohort.csv` (28 sites, verified manual pass) is the single canonical cohort, read by
  `seed-sites.ts` and by both lanes. The draft `scripts/cohort.json` was deleted in Phase 2.
- `data/lighthouse-results.json` is a pre-migration artifact from the draft cohort, kept as
  history and never imported. The published Lane 1 batch is `data/lighthouse-v1.json`; the
  published Lane 2 batch is `data/agent-runs-v1.jsonl` (280 trials, two agents).
- Lane 2 has `--resume`, which skips recorded trials and re-runs rows recorded as `error`.
- **The v1 loop is frozen** (2026-08-09). Any change to it forks the dataset.
- The authored Goodhart exhibit (2026-08-30) ran through that loop unchanged as batch
  `goodhart`: `data/exhibit-cohort.csv` (registered key), `data/lighthouse-goodhart.json`,
  `data/agent-runs-goodhart.jsonl` (20 trials) and the two pages in `public/exhibit/`. Nothing
  of it is in Supabase. See `docs/EXHIBIT.md`.

## Read-path modules added after the data landed

Aggregation still happens at read time in `lib/queries.ts`; these sit beside it as pure,
separately tested functions with no data access:

- `lib/stats.ts` — Spearman rho, Pearson, average ranks, a seeded percentile bootstrap that
  resamples sites, group sizes for binary splits. Anything uncomputable returns `null`, never
  `0`. Mirrored operation-for-operation by `scripts/stats_reference.py`, with
  `scripts/tests/stats-vectors.json` pinning the values both implementations must produce —
  the same cross-language arrangement `scoring-vectors.json` provides for the scorer.
- `lib/sub-audits.ts` — the per-audit attribution analysis behind `/correlation/audits`:
  success-rate gaps with intervals, a Westfall-Young maxT family correction, tier-stratified
  permutation for the confound test, and the power/ceiling arithmetic.
- `lib/transcript.ts` — turns one stored transcript into what can honestly be said about how
  that trial ended, including the case where nothing in the record names a failure step.
- `lib/format.ts` — one place decides how a measurement is worded.
- `lib/runs.ts` — the pre-registered denominator rule (`measuredRuns`), extracted so both
  `lib/queries.ts` and `lib/exhibit.ts` apply the identical one. `queries.ts` re-exports it.
- `lib/exhibit.ts` + `lib/exhibit-data.ts` — the authored Goodhart exhibit. The first is the
  pure fold of its lane artifacts; the second is the committed result of that fold
  (`data/exhibit-goodhart.json`, written by `scripts/build-exhibit-summary.ts`), because JSONL
  and CSV are not importable modules. `lib/exhibit.test.ts` re-derives it from the raw
  artifacts and fails on drift, and asserts the exhibit and cohort datasets are disjoint in
  both directions.

## Environment

`.env.local` (never committed), from `.env.local.example`:

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — app reads
- `SUPABASE_SERVICE_ROLE_KEY` — pipeline writes (scripts only)
- `SUPABASE_DB_PASSWORD` — Supabase CLI, for `supabase db push`
- `ACTIVE_BATCH` / `ACTIVE_AGENT_ID` — which dataset the app publishes and the lanes write
- `USE_FAKE_DATA` — `true` renders fixtures with no backend
- `GEMINI_API_KEY` — Lane 2 only

Keys come from `npx supabase projects api-keys --project-ref bfhxbvaosagfrkuhnuvp`.

## Design invariants

- The static lane shells out to the official Lighthouse CLI and parses its JSON. We
  reimplement no audits; the x-axis stays Google's.
- One agent, one prompt, one harness per dataset version. Any change to the agent loop forks
  the dataset (new `agent_id` or version tag), never silently amends it.
- The frontend must degrade gracefully with partial data: sites missing one lane's results
  render with gaps, not crashes.
