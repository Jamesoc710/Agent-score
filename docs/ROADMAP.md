# AgentRank — roadmap

Sequenced phases first, then the product backlog. The active working plan with per-session
state lives in `.claude/plans/buildout.md`.

**Status as of 2026-08-30:** Phases 1-4 are complete and deployed, Phase 5 is complete except
for leaderboard sorting/filtering, and the first backlog item (sub-audit attribution) has
shipped. The measurement side of the project has produced two null results and a power
analysis showing this cohort could not have detected the effect it was built to look for; the
open decisions are therefore about what to measure next, not how to present v1. Phase numbers
in this file are the only canonical ones — session notes elsewhere have occasionally numbered
the sub-audit work "Phase 6", which does not exist here.

**The hard deadline this document was built around has passed, and the rule it came from still
binds:** `docs/METHODOLOGY.md` fixes one agent, one prompt, one harness per dataset version.
The v1 loop froze on 2026-08-09 and the run completed on 2026-08-19, so **any change to the
agent loop from here forks the dataset** — a new `agent_id` or `batch_label`, never an
amendment in place.

## Phase 1 — Supabase + Vercel foundation ✅ complete (2026-08-01)

- Schema as git-tracked CLI migrations: `sites`, `lighthouse_results`, `agent_runs`. Result
  tables are append-only, keyed by `batch_label`; RLS is select-only and only `scripts/` holds
  a key that can write.
- `lib/queries.ts` and both lanes off Firestore; fixtures behind `USE_FAKE_DATA=true` with no
  silent fallback. All Firebase code, config and dependencies removed.
- Deployed: <https://agent-score-weld.vercel.app>. Any push to `main` deploys production.

## Phase 2 — Cohort, scoring, and harness correctness ✅ complete (2026-08-09)

Delivered: `scripts/scoring.py` implements the METHODOLOGY contract with 174 pytest cases and
a language-neutral vector file; `scripts/cohort.json` deleted and both lanes read
`data/cohort.csv`; the prompt parameterized with each site's `question`; every harness
validity fix below landed, including `--resume`; the six `[confirm exact URL]` entries
resolved. The loop was frozen at the end of this phase and has not changed since.

<details><summary>The original scope, kept as the record</summary>

Everything here was a prerequisite for the run, not a nice-to-have.

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

</details>

## Phase 3 — Real data ✅ complete (2026-08-19)

Delivered: Lane 1 across all 28 sites, Lane 2 at 28 x 5 trials x 2 models (280 trials),
imported as batch `v1`, pre-registration receipt tagged. **Headline result: the Lighthouse
Agentic Browsing score showed no relationship with behavioral success that this cohort could
distinguish from noise** (rho = 0.11, 95% CI [-0.29, 0.48], n = 27; the 28th site was never
reached and is excluded rather than scored 0%). Overall success: 51% for
`gemini-3.5-flash-lite`, 57% for `gemini-3.6-flash`.

<details><summary>The original scope, kept as the record</summary>

The harness was frozen for the duration of this phase.

- Verify the `agentic-browsing` audit IDs against current Lighthouse (all-zero `lh_webmcp` in
  the draft batch is unexplained), then run Lane 1 across the full 28-site cohort.
- Re-verify the volatile registered prices immediately before the run: `bestbuy`, `ikea`,
  `zalando`, `amazon`.
- Prove the loop on 5 sites as its own `batch_label`, then the full run: 5 trials × 28 sites.
- Commit the pre-registration receipt (git-hashed answer key) before the full run.

</details>

## Phase 4 — Leaderboard launch ✅ complete (2026-08-30)

- Frontend on real data by default; graceful gaps for sites missing a lane. ✅
- Bare Pearson replaced with Spearman rho + a seeded percentile bootstrap 95% CI + explicit n,
  in `lib/stats.ts`, cross-checked against an independent Python implementation
  (`scripts/stats_reference.py`) through a committed vector file. ✅
- `loading` / `error` / `not-found` for every route. ✅
- Beyond the original scope: an agent toggle (`?agent=`) publishing either model of the panel,
  and a "not measured" affordance distinguishing "no measurement exists" from "0% success".

## Phase 5 — Presentation — mostly complete (2026-08-30)

Deliberately after the data: a leaderboard should be designed around real distributions, not
around 28 zeroes.

- **Per-step transcript replay.** ✅ Every trial in the log expands into the steps it
  recorded, deep-linkable at `?trial=N`, with no client component. The original wording of
  this item ("mark the step that flipped the run into its failure mode") turned out to be
  unsupportable: 63 of 280 v1 trials are ended from *outside* the transcript, by the wall
  clock or the step budget, and nothing in the record names a cause. Those read "Failure
  point: not recorded" rather than pointing at whatever action happened to be last.
- A real design pass on all pages. ✅ Semantic colour tokens, dark mode via
  `prefers-color-scheme`, AA contrast verified across every route in both themes (the fine
  print went from 2.56:1 to 5.39:1), responsive at 375/768/1280.
- Responsive and dark-mode behaviour. ✅ (folded into the design pass)
- Leaderboard sorting and filtering — **still open, and deliberately deprioritized**: at 28
  rows it buys little, and the table is already deterministically ordered.

## Backlog — hardening the result

Roughly ordered by credibility-per-hour:

- ~~**Sub-audit attribution.**~~ ✅ **Done (2026-08-30), and the quotable finding is not
  there.** Live at `/correlation/audits`. Six comparisons (four audits, two agents; two
  audits usable per agent plus one unfalsifiable), family-wise p from 0.153 to 1.000 under a
  Westfall-Young maxT correction — **no individual sub-audit is distinguishable from noise
  either.** Three results worth more than the headline: (a) the family-wise critical value is
  a 49-point success gap and the 80%-power threshold is 67, while the largest gap this cohort
  can *physically* produce on a 6-of-27 split is 62.9 — so an llms.txt-shaped effect could not
  have been detected here at all; (b) llms.txt is confounded past rescue with cohort design
  (tier-stratified p = 1.000 / 0.754, and for `gemini-3.6-flash` `tier == anchor` and
  `lh_llms_txt` are numerically identical predictors); (c) `lh_webmcp` is unfalsifiable at
  1-of-27 — the smallest p any arrangement of that split could produce is 0.259. This also
  resolves the METHODOLOGY open item about all-zero `lh_webmcp`: the audit id is live, and
  1 of 28 passing is adoption data rather than a harness bug.
- **Difficulty-residual baseline.** Run extraction-only (direct nav to the answer page) per
  site; full-agent minus extraction-only isolates navigation difficulty from "is the fact
  hard to read." Defuses the main methodological objection.
- ~~**The Goodhart exhibit.**~~ ✅ **Done (2026-08-30).** Live at `/correlation/exhibit`, with
  its own pre-registration record in `docs/EXHIBIT.md`. Built as a **matched pair** rather than
  the single page originally scoped, because one page invites "your agent is just bad" and a
  pair answers it: two authored pages that render the identical screenshot byte for byte, both
  score **100** on the Agentic Browsing category with identical sub-audits, and differ only in
  whether the rows outside a scroll box are placed in the document. Registered first (git tag
  `exhibit-key-v1`, commit `7a4ae51`), then run through the **unchanged** frozen loop as batch
  `goodhart`: 2 pages × 5 trials × 2 agents = 20 trials, zero harness errors. Control 10/10
  success in 1 step; gated 0/10, every trial spending its full 15-step budget on `scroll`. What
  it shows is one authored counterexample, not that the audit is gameable in general (see the
  page's own limits section). Never imported into Supabase and in no cohort statistic; the v1
  artifacts and `stats-vectors.json` are byte-identical after the work.
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
