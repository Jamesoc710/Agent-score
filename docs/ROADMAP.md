# AgentRank — roadmap

Sequenced phases first, then the product backlog. The active working plan with per-session
state lives in `.claude/plans/buildout.md`.

**The one hard deadline in this document:** `docs/METHODOLOGY.md` fixes one agent, one prompt,
one harness per dataset version — any change to the agent loop forks the dataset. So every
harness change has to land *before* the Phase 3 run. Afterwards the choice is re-running 28
sites × 5 trials or carrying a known-weak dataset forever. UI work has no such deadline, which
is why it sits after the data rather than before it.

## Phase 1 — Supabase + Vercel foundation ✅ complete (2026-08-01)

- Schema as git-tracked CLI migrations: `sites`, `lighthouse_results`, `agent_runs`. Result
  tables are append-only, keyed by `batch_label`; RLS is select-only and only `scripts/` holds
  a key that can write.
- `lib/queries.ts` and both lanes off Firestore; fixtures behind `USE_FAKE_DATA=true` with no
  silent fallback. All Firebase code, config and dependencies removed.
- Deployed: <https://agent-score-weld.vercel.app>. Any push to `main` deploys production.

## Phase 2 — Cohort, scoring, and harness correctness

Everything here is a prerequisite for the run, not a nice-to-have. The loop is frozen at the
end of this phase.

**Cohort**

- Wire `data/cohort.csv` (28 sites, canonical) into both lanes and retire
  `scripts/cohort.json`. Its ids (`dmv_ca`, `irs_gov`) do not even foreign-key into the seeded
  cohort, so `import-results.ts` currently rejects anything the lanes produce.
- Resolve the 6 `[confirm exact URL]` entries in `docs/COHORT.md` — `bestbuy`, `ikea`,
  `powells`, `zalando`, `amazon`, `ticketmaster` (manual, James). Confirm the registered answer
  still holds for `shopify`, `github`, `notion`, `zalando`. (METHODOLOGY.md says 8; the real
  count is 6 — correction flagged, not yet applied, because that file is the pre-registration
  record.)

**Scoring**

- Implement the METHODOLOGY.md contract as a shared, unit-tested module and wire it into the
  harness, replacing the naive substring check.

**Harness validity** — the y-axis is only as trustworthy as the loop that produces it

- **A Gemini API failure is currently recorded as the site's failure.** `lane2-agent.py:153`
  swallows every exception and returns `answer: ""`, which line 210 scores as
  `wrong_extraction`. Rate limits and blips therefore inflate site failure rates for reasons
  unrelated to agent-readiness. Must become `failure_mode: "error"`.
- Retry with backoff around the model call. There is none today.
- Structured output (JSON mode) instead of regex-stripping code fences off a text response.
- Parameterize the prompt with the per-site `question`, as METHODOLOGY already specifies; the
  harness still uses `task_hint` from the draft cohort.
- Consent/cookie handling — the cohort deliberately includes a consent-wall site, so today that
  obstacle tests the harness rather than the site.
- Click robustness: scroll-into-view, iframe awareness, popup/new-tab handling. The current
  fallback is a CSS selector, then a text match, then give up.
- Revisit the 2000-character page-text truncation, which can cut the answer out of the model's
  context on long pages.
- Local JSONL persistence: done in Phase 1. `--resume` still outstanding.

**Cheap presentation fixes** — pulled forward only because the link is already public

- Favicon (404s today) and an OG image, since the URL is shareable now.
- Show each site's `question` on `/site/[slug]` — the task the agent was given is currently
  invisible.
- Surface `tier` and `flag` on the leaderboard. Both are in the database and rendered nowhere,
  so "Amazon 0%" reads as a broken benchmark instead of `intentional blocker (expect blocked)`.

## Phase 3 — Real data

The harness is frozen for the duration of this phase.

- Verify the `agentic-browsing` audit IDs against current Lighthouse (all-zero `lh_webmcp` in
  the draft batch is unexplained), then run Lane 1 across the full 28-site cohort.
- Re-verify the volatile registered prices immediately before the run: `bestbuy`, `ikea`,
  `zalando`, `amazon`.
- Prove the loop on 5 sites as its own `batch_label`, then the full run: 5 trials × 28 sites.
- Commit the pre-registration receipt (git-hashed answer key) before the full run.

## Phase 4 — Leaderboard launch

- Frontend on real data by default; graceful gaps for sites missing a lane.
- Replace bare Pearson with Spearman rank correlation + bootstrap 95% CI + explicit n.
- `loading` / `error` / `not-found` states (none exist today).

## Phase 5 — Presentation

Deliberately after the data: a leaderboard should be designed around real distributions, not
around 28 zeroes.

- **Per-step transcript replay.** Transcripts are already stored and nothing renders them.
  Render the timeline and mark the step that flipped the run into its failure mode. Makes
  failure labels auditable and is the single most convincing demo asset.
- A real design pass on all three pages. What exists is a functional first draft.
- Leaderboard sorting and filtering — by tier, by failure mode, by either axis.
- Responsive and dark-mode behaviour, neither of which has ever been checked.

## Backlog — hardening the result

Roughly ordered by credibility-per-hour:

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
  The `batch_label` schema already supports this.
