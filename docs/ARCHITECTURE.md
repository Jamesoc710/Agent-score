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
        /            leaderboard: success rate, LH score, top failure mode
        /site/[slug] sub-audit breakdown, trial log, answer key
        /correlation scatter + correlation stats + sub-audit ranking
```

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
- **Vercel** for hosting the Next.js app (not yet connected). Note: once the repo is
  connected, pushes to `main` deploy production.

## Current state vs target

- Firebase is fully removed as of Phase 1: `lib/firebase-admin.ts`, `firebase.json`,
  `firestore.rules`, `.firebaserc`, `scripts/seed-firestore.ts`, and the npm `firebase` /
  `firebase-admin` plus the Python `firebase-admin` dependencies are gone.
- Real data is the default path. Fixtures (`lib/fake-data.ts`, 3 rows sampled from the
  canonical cohort) render only when `USE_FAKE_DATA=true` — there is no silent fallback, so a
  misconfigured deploy fails loudly instead of serving invented numbers.
- `scripts/cohort.json` is the stale draft cohort (30 sites, mostly unverified) that both
  lanes still read. `data/cohort.csv` (28 sites, verified manual pass) is canonical, is what
  `seed-sites.ts` loads, and gets wired into the lanes in Phase 2. Do not add sites to
  cohort.json. Until then the lanes emit draft-cohort `site_id`s, which
  `import-results.ts` rejects with an explicit list rather than a foreign-key error.
- `data/lighthouse-results.json` is a pre-migration artifact from the draft cohort, kept as
  history and not imported; Lane 1 is re-run against the canonical cohort in Phase 3.
- Lane 2 has no `--resume` yet, but its artifact is an append log, so a re-run only duplicates
  trials the importer would dedupe anyway.

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
