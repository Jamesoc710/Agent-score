# AgentRank — roadmap

Sequenced phases first, then the product backlog. The active working plan with per-session
state lives in `.claude/plans/buildout.md`.

## Phase 1 — Supabase + Vercel foundation

- Create the Supabase project; schema via git-tracked CLI migrations: `sites`,
  `lighthouse_results`, `agent_runs` (with `agent_id`).
- Swap `lib/queries.ts` and both lanes from Firestore to the Supabase client; fixtures move
  behind an explicit dev flag instead of being the silent default.
- Remove all Firebase code, config, and dependencies. Connect Vercel.

## Phase 2 — Cohort + scoring correctness

- Wire `data/cohort.csv` (28 sites, canonical) into the lanes and seeds; retire
  `scripts/cohort.json`.
- Resolve the 8 `[confirm exact URL]` entries in `docs/COHORT.md` (manual, James).
- Implement the METHODOLOGY.md scoring contract as a shared, unit-tested module and wire it
  into the harness, replacing the naive substring check.

## Phase 3 — Real data

- Verify the `agentic-browsing` audit IDs against current Lighthouse (all-zero `lh_webmcp` in
  the draft batch is unexplained), then run Lane 1 across the full 28-site cohort.
- Harden Lane 2: local JSONL persistence + `--resume`. Prove the loop on 5 sites, then the
  full run: 5 trials x 28 sites.
- Commit the pre-registration receipt (git-hashed answer key) before the full run.

## Phase 4 — Leaderboard launch

- Frontend on real data by default; graceful gaps for sites missing a lane.
- Replace bare Pearson with Spearman rank correlation + bootstrap 95% CI + explicit n.
- `loading` / `error` / `not-found` states; deploy to Vercel.

## Backlog — hardening the result

Roughly ordered by credibility-per-hour:

- **Per-step transcript replay.** Transcripts are already stored; render the timeline and mark
  the step that flipped the run into its failure mode. Makes failure labels auditable and is
  the single most convincing demo asset.
- **Sub-audit attribution.** Split the cohort by pass/fail on each Lighthouse sub-audit and
  show the success-rate gap each buys (with CI). Produces the quotable finding ("only
  accessibility-tree predicted success").
- **Difficulty-residual baseline.** Run extraction-only (direct nav to the answer page) per
  site; full-agent minus extraction-only isolates navigation difficulty from "is the fact
  hard to read." Defuses the main methodological objection.
- **The Goodhart exhibit.** One authored page that scores high on the static audit but
  reliably defeats the agent (answer behind a JS gate). The static-scores-can-be-gamed
  critique as a literal, plotted counterexample.
- **Cross-agent replication.** Claude/GPT behind the identical loop as additional `agent_id`
  columns. Upgrades the claim from "Gemini behaves this way" to "agents behave this way," and
  is the first step toward the panel.
- **Report to the Lighthouse/Chrome team.** Package the sub-audit analysis as an issue on the
  Lighthouse repo with the dataset linked: the first external validation of their audit.

## Backlog — productization

- **Probe endpoint.** `POST /probe {url, question, answer_substring, trials}` returning the
  standard run document. Un-hardcodes the cohort; every product feature below is a client of
  this one endpoint.
- **Scan-your-site report.** Instant Lighthouse score + a real agent attempt with transcript,
  packaged as a shareable report. The wedge product.
- **Competitor comparison.** Same scan across a named competitor set, presented side by side.
- **Remediation cards.** Per-site "the agent got lost at exactly this step; here is the fix,"
  grounded in observed transcripts rather than generic audit advice.
- **Behavioral CI check.** GitHub Action that probes critical URLs on each PR and fails the
  build if agent success drops below threshold. Lighthouse-CI ergonomics, behavioral metric.
- **Quantified-loss model.** The "what this costs you" number for the pitch. Gated on real
  inputs (agent-traffic share, failure rates, conversion values); not claimable before then.

## The long-term vision — AgentRank-Bench

A canonical, versioned behavioral benchmark for the agentic web: the frozen data contract as
the schema, a datasheet pinning agent + task template + scoring rule per version, and:

- **Submit-your-site flywheel** — one cohort row in, queued for the fixed agent, rendered
  into the public leaderboard. Canonical benchmarks are the ones sites want to be measured by.
- **Behavior-earned badge + API** — an embeddable "Agent-Ready: measured" badge backed by a
  public transcript, positioned alongside Lighthouse rather than against it.
- **Longitudinal re-runs** — dated batches turn the scatter into a time series; a within-site
  before/after when a site ships llms.txt or WebMCP is the closest available causal claim.
