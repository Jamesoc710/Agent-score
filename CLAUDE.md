# AgentRank — project context for Claude Code

Behavioral agent-readiness scoring for websites. A fixed browser agent runs a fixed-shape task
on real sites; success is scored against pre-registered answers and correlated with static
agent-readiness scores (Lighthouse Agentic Browsing). Public leaderboard first; on-demand site
scanning is the product direction. Solo project (James), built with Claude in the loop.

## Read before large changes

- `docs/ARCHITECTURE.md` — system design, data contract, env vars
- `docs/METHODOLOGY.md` — scoring contract and trial protocol. Pre-registered: changing match
  rules or answer keys after runs exist invalidates results. Treat as append-only; flag any
  change to James.
- `docs/COHORT.md` + `data/cohort.csv` — the 28-site cohort. The CSV is canonical.
- `docs/EXHIBIT.md` — the authored Goodhart exhibit's own pre-registration record. Two pages
  in `public/exhibit/`, measured by the same lanes into batch `goodhart`, never imported and
  never part of a cohort statistic. Append-only, same as METHODOLOGY.
- `docs/ROADMAP.md` — current phase and sequencing
- `.claude/plans/buildout.md` — active working plan and state log; update it at session end

## Stack

- Next.js 14 App Router, TypeScript strict, Tailwind. All pages are server components; the one
  client component is the Recharts correlation chart.
- Data layer: Supabase Postgres, schema via git-tracked CLI migrations in
  `supabase/migrations/`. Firebase is gone. Real data is the default read path; fixtures only
  with `USE_FAKE_DATA=true` (`lib/queries.ts`). Deployed on Vercel (project `agent-score`,
  <https://agent-score-weld.vercel.app>) — **any push to `main` deploys production**.
- The app reads with the anon key under RLS select-only policies (`lib/supabase.ts`); only
  `scripts/` holds the service key (`scripts/supabase-admin.ts`). Do not import the service
  client from `app/` or `lib/`.
- Pipeline lanes: `scripts/lane1-lighthouse.ts` (Lighthouse CLI, static x-axis) and
  `scripts/lane2-agent.py` (Gemini + Playwright, behavioral y-axis, Python). Both write local
  per-batch artifacts under `data/`; `scripts/import-results.ts` is the only DB writer.
- Published statistics live in `lib/stats.ts` and `lib/sub-audits.ts` as pure functions,
  mirrored by `scripts/stats_reference.py` and pinned by `scripts/tests/stats-vectors.json`.
  **A number the site publishes is computed twice, in two languages, and the test suite fails
  if they disagree.** Extend that contract rather than working around it. Tests:
  `npm test` (pytest, the scoring contract) and `npm run test:unit` (vitest, the read path).
- Result tables are append-only, keyed by `batch_label`; `lib/dataset.ts` names the batch and
  agent the app publishes.

## Commands

- `npm run dev` / `npm run build` / `npm run lint`; typecheck with `npx tsc --noEmit`
- `npm run seed:sites` — `data/cohort.csv` -> `sites` (supports `--dry-run`)
- `npm run lane1` — Lighthouse across the cohort; `lane1:single` for one site
- `python scripts/lane2-agent.py --sites <ids> --trials <n>` — behavioral runs
- `npm run import` — load a batch's local artifacts into Supabase (`--batch <label>`)
- Python deps: `pip install -r scripts/requirements.txt && playwright install chromium`

## Ground rules

- `lib/types.ts` is the frozen data contract between lanes and frontend. Schema changes are a
  James decision, not a refactor.
- The `runs`/`agent_runs` schema keeps `agent_id` so a multi-agent panel can be added without
  migration pain.
- Never put a site's `answer_substring` (or any hint of it) into `task_hint` or an agent
  prompt. The agent must earn the answer by browsing; leakage invalidates the run.
- Scoring changes require tests. The match rules in `docs/METHODOLOGY.md` are the spec.
- Real agent runs and Lighthouse batches cost time/money and produce data others may cite:
  confirm with James before full-cohort runs.
- Both items of known debt from 2026-07 are cleared: `scripts/scoring.py` implements the
  documented match rules and `scripts/cohort.json` is deleted. **The live debt as of
  2026-08-30 is different: v1 is published and its loop is frozen, so the cheap work is
  finished and the open questions all cost money or change the claim.** See
  `docs/ROADMAP.md` for the state of each phase and `.claude/plans/buildout.md` for the
  session log.
