# AgentRank — architecture

## System shape

Two measurement lanes write to one database; the frontend is a read-only view over it.

```
data/cohort.csv  (canonical cohort: question, answer, match rule per site)
      |
      ├── Lane 1: scripts/lane1-lighthouse.ts
      |     Lighthouse CLI, agentic-browsing category only
      |     -> lighthouse_results (one row per site)  + data/lighthouse-results.json (local artifact)
      |
      └── Lane 2: scripts/lane2-agent.py
            Gemini + Playwright browser agent, N trials per site
            scored against pre-registered answers (docs/METHODOLOGY.md)
            -> agent_runs (one row per trial)  + local JSONL artifact (planned)
                  |
                  v
            Database (target: Supabase Postgres)
                  |
                  v
      Next.js app  (lib/queries.ts is the single data layer)
        /            leaderboard: success rate, LH score, top failure mode
        /site/[slug] sub-audit breakdown, trial log, answer key
        /correlation scatter + correlation stats + sub-audit ranking
```

Aggregation (success rate, ranking, correlation) happens at read time in `lib/queries.ts`, not
in the pipeline. Lanes write raw facts only.

## Data contract

Frozen in `lib/types.ts`; lanes and frontend build against it independently.

- **sites** — pre-registered config, written before any run: `site_id`, `name`, `url`,
  `answer_substring`, `answer_note`
- **lighthouse_results** — one per site: `site_id`, `lh_total` (0-100), four sub-audit flags
  (`lh_accessibility_tree`, `lh_layout_stability`, `lh_llms_txt`, `lh_webmcp`), `run_at`
- **agent_runs** — one per trial: `site_id`, `agent_id`, `trial_number`, `success`,
  `step_count`, `duration_seconds`, `failure_mode`, `transcript`, `run_at`

`agent_id` exists so a multi-agent panel (Claude, GPT alongside Gemini) can be added without a
schema break. Failure modes (fixed enum): `success`, `blocked`, `timeout`, `wrong_extraction`,
`navigation_stuck`, `error`.

## Target stack (migration in progress, see ROADMAP Phase 1)

- **Supabase Postgres** for all three tables. Schema changes only via git-tracked CLI
  migrations. Client reads use the server-side Supabase client inside server components;
  pipeline writes use the service role key from scripts.
- **Vercel** for hosting the Next.js app. Note: once the repo is connected, pushes to `main`
  deploy production.
- Being removed with the migration: `lib/firebase-admin.ts`, `firebase.json`,
  `firestore.rules`, `.firebaserc`, the `firebase`/`firebase-admin` deps, and the Firestore
  branches in `lib/queries.ts` and both lanes.

## Current state vs target

- The app today reads fixture data by default: `lib/queries.ts` falls back to
  `lib/fake-data.ts` (3 hand-written sites) unless DB credentials are present. After Phase 1
  the real DB becomes the default and fixtures live behind an explicit dev flag.
- `scripts/cohort.json` is the stale draft cohort (30 sites, mostly unverified) that the
  scripts still read. `data/cohort.csv` (28 sites, verified manual pass) is canonical and gets
  wired in during Phase 2. Do not add sites to cohort.json.
- Lane 2 currently persists only to the database; a local JSONL artifact + `--resume` is
  planned so a full cohort run survives interruption.

## Environment

`.env.local` (never committed), from `.env.local.example`:

- `USE_FAKE_DATA` — `true` renders fixtures with no backend
- Supabase URL + service role key (replaces the Firebase credential vars after Phase 1)
- `GEMINI_API_KEY` — Lane 2 only

## Design invariants

- The static lane shells out to the official Lighthouse CLI and parses its JSON. We
  reimplement no audits; the x-axis stays Google's.
- One agent, one prompt, one harness per dataset version. Any change to the agent loop forks
  the dataset (new `agent_id` or version tag), never silently amends it.
- The frontend must degrade gracefully with partial data: sites missing one lane's results
  render with gaps, not crashes.
