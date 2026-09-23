# AgentRank roadmap

AgentRank measures whether one fixed browser agent can complete one fixed-shape task on real, named websites,
with every answer registered before any run, and checks static agent-readiness scores against that
measurement. It is meant to be a fixed, dated, pre-registered measuring stick that agent-readiness rubrics can
be checked against. It sells no score and no scan.

This file is the public summary of the working plan: what has been measured, what is being corrected, and
what could be measured next and on what condition. Phase ids (P4, P6a, P5, P11, K and the rest) are names
carried from the plan, not positions; they are listed in the order they run. The v1 build's own Phases 1 to 5,
finished in August 2026, keep their numbers at the foot of this file.

**Status as of 2026-09-23.** v1 was measured and published on 2026-08-19. P4 (the static axis re-measured) and P6a
(every new number this release prints, computed in two languages) are done. P5, the corrections release that
ships this file, merged on 2026-09-23. P11, publishing, comes next. Then a kill review, K, decides whether any
further work happens. Nothing after K is scheduled, and none of it is promised.

**The rule that still binds.** `docs/METHODOLOGY.md` fixes one agent, one prompt and one harness per dataset
version. The v1 loop froze on 2026-08-09, and the run completed on 2026-08-19. Any change to the loop forks the
dataset under a new agent id or batch label; nothing is amended in place, and result tables are append-only by
batch. `docs/METHODOLOGY.md` and `docs/EXHIBIT.md` are themselves append-only: corrections are dated sections
added at the end.

## Where v1 stands

Batch `v1`: 28 named sites, one task shape (start at the site's registered URL, find one pre-registered fact,
report it), 5 trials per site for each of 2 Gemini models, 280 trials, from one residential connection. The
answers were registered by hand and receipted by git tag before the run. The static axis is the Lighthouse
Agentic Browsing category at 13.3.0, the version v1 ran.

What v1 found, in the only wording this project uses for it:

- **No relationship between the Lighthouse category mean and measured success that the 27 measured sites could
  distinguish from noise** (Spearman rho 0.11, 95% CI [-0.29, 0.48], n = 27, on `gemini-3.5-flash-lite`; the
  null holds on `gemini-3.6-flash` too). The 27 is the pre-registered denominator and keeps TriMet. One
  sensitivity, under a single registered exclusion rule, is printed beside it, never in its place: removing sites
  whose every trial was the harness's own error (TriMet) gives n = 26, rho +0.129 and
  −0.006. A sensitivity power analysis (on `/correlation/audits`) shows that this cohort could not
  have detected an llms.txt-shaped effect, so the null is bounded, not an absence. It is not evidence that
  Lighthouse does not predict agent success.
- **Success means the pre-registered fact was reported within 15 steps and 90 seconds, by this agent, from this
  vantage.** It measures reachability under a budget, not comprehension.
- **The Agentic Browsing category is a fraction of applicable checks, not a score.** Chrome displays it as
  checks passed out of checks that applied. The mean the CLI also emits has a denominator that moves with a
  site's HTTP status at `/llms.txt`, so v1 sites with identical recorded sub-audits received different category
  means.
- **Two authored pages with byte-identical screenshots and identical Lighthouse output: the agent solved one
  10/10 in one step, and the other 0/10** (`/correlation/exhibit`, registered in `docs/EXHIBIT.md`). It is one
  authored counterexample, not a claim that the audit can be gamed in general.
- **On the 172 trials where the agent produced an answer, no answer was a wrong fact:** 146
  matched the registered key; 26 were the agent's own reports of being blocked, which v1's
  harness could not verify, and seven of which describe a blank page or Google's CAPTCHA rather than
  the site. The self-reports are counted as unverified, never as correct.
- **The two Gemini models are not distinguishable on this cohort** (paired CI [−8.89, +22.22] points).
- **TriMet and Costco have no valid behavioral measurement in v1.** Every TriMet trial ended in the harness's
  own error; the pre-registered denominator rule keeps its rate as published, and its site page says what the
  rate measures. Costco was never reached, so it is not measured rather than 0%. Oregon State's timeouts are a
  suspected harness artifact that the instrument control (P2) would test; the control is registered on 2026-09-23 and has not
  run, so the row stands as measured.
- **The llms.txt audit measures conformance, not adoption.** On 2026-09-08 Twilio served an llms.txt with no H1
  heading, which the format makes the one required section, and the audit was right to fail it; on 2026-09-23
  the same path served a file that passes the audit at every version measured.
- **At 13.3.0, the version v1 ran, the WebMCP audits report the same value for a page with many registered
  tools and a page with none,** and the support check read an older API surface (`navigator.modelContext`)
  rather than the one the specification uses (`document.modelContext`); 13.4.1 and 13.5.0 check both. No
  adoption count is published from that column. This file's earlier statement that one site's pass was adoption
  data is withdrawn.

What v1 got wrong about its own static axis, and where it is corrected: it read the category mean as a score;
two of its recorded flags merge "failed" with "did not apply"; its layout-shift flag passed only at a perfect
score, stricter than Lighthouse's own rule and not registered before the run; the Lighthouse command used its
default mobile emulation (inferred from the command, since v1 kept no raw report to confirm it) while the agent
used a desktop viewport; and v1 kept no raw Lighthouse report at all. No published v1
value changes. P4 re-measured the axis with every report kept, and P5 relabels every surface and registers the
corrections.

## Before the kill review

These phases run in this order, each after the one before, and none spends on model API calls: the work is
build time, unattended Lighthouse runs on one laptop, and James's review. The order puts the work that goes
stale first (the Lighthouse category changed twice after v1 ran, and the site contradicted its own finding),
and it holds two rules: no number is printed before it is computed in both languages and pinned, and no
protocol is registered after the run it governs.

### P4: Re-measure the static axis (done 2026-09-23)

- **Shipped:** dated Lighthouse batches, all run on 2026-09-23: one at 13.3.0, the version v1 ran, so every v1
  flag could be checked, and same-day companions at 13.4.1, 13.5.0 and Lighthouse's desktop preset.
  Repeated runs per site with every raw report kept; each audit's display mode, the Lighthouse version and
  Chrome's own fraction recorded; Lane 1's Chrome pinned to the Chromium build the agent lane uses; a fixture
  report and an extraction test for Lane 1, which had none; a reconstruction of every v1 flag; and the ora.ai
  and Cloudflare scanner scores fetched the same day, for a declared test of whether the three scanners agree.
  Lighthouse batch labels carry their date and are never re-used, and the importer refuses a label it already
  holds. From P4 on, 13.5.0 is the pinned version, and any later version change is bridged by a same-day pair.
- **Cost:** no API spend.
- **Gate:** all 28 sites have retained reports; every v1 flag reproduces or differs for an evidenced reason; the
  layout-shift pass-rule decision is recorded.

### P6a: The statistics contract, first half (done)

- **Shipped:** a Python-side test of the committed vector file, so the two-language contract is checked in both
  directions (it was checked in one); and, in `lib/stats.ts` and `scripts/stats_reference.py` with pinned
  vectors, every new number a P5 or P11 surface prints: the answered-trial classes and v1's split of the
  self-reported blocks, the group split and the one registered sensitivity, the paired interval between the two
  models, and the decomposition of the category mean, including the layout-shift alternative-rule range.
- **Cost:** no API spend.
- **Gate:** both test suites green; the new vectors committed.

### P5: Corrections and the public surface (this release)

- **Ships:** README, PRODUCT, ARCHITECTURE and this roadmap corrected, and the Lighthouse report rewritten as a
  bug report with a study attached; dated sections appended to `docs/METHODOLOGY.md` (see "What is
  registered"). On the live site: the Lighthouse number relabelled "category mean" everywhere; the WebMCP chip
  and the adoption count removed; v1's `blocked` labelled a self-reported block; ties on the leaderboard no
  longer ordered by the category mean; TriMet's harness-artifact note, derived from the trial record by a registered
  rule; Oregon State's note that the control is pending; Costco unchanged; the Goodhart pair as a finding card
  with its own page. New routes and files: `/methodology`, `/data`, `/data/v1.json` with a
  citation block, `robots.txt`, a sitemap and a Dataset JSON-LD block; a GitHub Issue Form and a contact
  address; page-view analytics; a daily keep-alive for the database; and a tagged release, `dataset-v1`, from
  which a Zenodo DOI is minted after the merge.
- **The Issue Form is a request channel and a count, not an intake.** While cohort expansion is out of scope, a
  submitted site is answered and counted, and no site is added.
- **Cost:** no API spend.
- **Gate:** every rendered claim checked against the honesty checklist (does any value assert a measurement, a
  grade, an ordering or a rate the data does not support?); no numeral enters a METHODOLOGY section before it
  is pinned in the vector file or a committed artifact, checked by a test; typecheck, lint, build and both test
  suites green. Merging deploys production.

### P11: Publishing

- **Ships:** an issue on the Lighthouse repository, filed through its Agentic Web template and linking the
  rewritten report; a comment on a Chrome Labs WebMCP evaluation thread; a public post led by the Goodhart
  pair; and audits of other projects' public agent-behavior data, each raised with its maintainers before any
  post about it, with the analyses and their reproduction scripts committed under `data/external/`. The order is
  the issue, then the comment, then the post after a grace period, then the dataset audits. Every external text
  is written and sent by James in his own name.
- **Cost:** no API spend.
- **Gate:** every figure in the report regenerated from P4's and P6a's artifacts; every text read against the
  list of things this project never says; the report and the issue re-based on the Lighthouse version
  PageSpeed Insights serves on the filing day.

### K: The kill review

The criterion is recorded here on 2026-09-23, before the Lighthouse issue is filed, and is not edited after.

- **Engagement, E.** On the Lighthouse issue, the Chrome Labs comment and the dataset-audit issue, counted from
  their GitHub records: a comment by a repository owner, member or collaborator (bots excluded); a label
  applied; an assignee or milestone set; a pull request or commit that references the issue. Also any reply,
  on any channel, from a named recipient of the dataset-audit texts. Each distinct event counts once, and a
  routine triage label is recorded as exactly that.
- **Audience, A.** Countable artifacts from the people this project is for (maintainers, vendors, researchers
  and agent builders), each counted once: a view or download of the DOI record; a referrer to `/data`,
  `/methodology`, `/correlation` or the post that is not a search engine, a social network, the repository or
  the site itself; an email to the contact address from a vendor, researcher or agent builder about the method,
  the data or a reuse; a citation, inbound link or reuse of the dataset, the transcripts or the scripts, found
  by searching for the DOI, the repository path or `dataset-v1` on the review day.
- **Counted in neither.** Site owners' "run it on my site" requests (Issue Form submissions, comments, emails)
  are tallied separately and reported beside E and A; they never decide the review. Sales mail and page views
  count nowhere.
- **Window.** 45 days from the last of the Lighthouse issue, the public post and the dataset-audit issue. If
  one slips, the review moves with it.
- **Rule.** Continue if E or A is non-zero.
- **If it says continue,** the phases below become eligible, in order, each behind its own gate and its own
  dated registration. That makes them possible, not scheduled.
- **If it says stop,** there is no paid batch, no probe series, no panel and no further build. The report, the
  DOI, the corrections and the data stay published; before the repository is archived as a methodology
  reference, the data pages switch to the committed edition snapshot, so a paused database cannot take the
  site down.
- **Recording.** The counts, every event with its date and source, and the verdict are recorded on the review
  day, and this file is updated with the verdict.

## After the kill review, only if it says continue

Nothing in this section is scheduled. Each phase runs only if the review says continue, and then only after its
protocol is appended to `docs/METHODOLOGY.md` with its date, before its run. "Paid" means model API calls; the
rest is build work and unattended runs. If the review says stop, none of it runs.

- **P1, run infrastructure.** The batch launcher's remaining lanes and checks, including a refusal to run the
  frozen loop on any browser build but the one v1 probably ran; an answer-key preflight that checks each
  registered answer candidate on its page; a dated human check of the answer rows most likely to drift; a
  health card with pre-registered gates on every batch. No API spend. Gate: a dry batch produces its manifest
  and health card.
- **P2, the instrument control.** `instrument-v1`: the v1 browser layer driven by a committed script with no
  model, in repeated passes over every start URL, published as the instrument's own error bar beside the v1
  results and never mixed into a cohort statistic. This is what would settle Oregon State's caveat, with its
  date. No API spend. Gate: its protocol registered before the first pass; every unreached site named.
- **P6b, the statistics contract, second half.** Every function only a later phase would print, in both
  languages, before any of them runs. No API spend.
- **P3, test-retest of the frozen loop.** The identical v1 agent on both models, 5 trials per site, from the same
  vantage and browser build: how many sites' success counts move between two runs of the same agent, printed
  beside the sites the registered rules exclude and beside what trial noise alone would move, with an exact
  test as the verdict. The honest error bar on a leaderboard row. Paid, the smallest paid item. Gate: its
  protocol registered and tagged before the batch, naming the excluded sites by rule; any answer key whose page
  has moved (Apple's moved in September 2026) re-registered by tagged receipt; a same-day answer-key check; any
  wrong answer stops publication until explained. Ticketmaster's registered fact names an October 10, 2026 show,
  so a retest on or after that date excludes it by rule.
- **P0, the identity probe, as a canary.** On the morning of any paid batch, from that batch's vantage, a
  model-free check of whether each site serves a fixed browser declaring each of several identities: a plain
  browser and an unnamed honest bot as controls, the harness's own identities, and the published user-agent
  strings of named agents. Reachability only, never a rate; when a control is refused, the site is "not
  measurable from this vantage", never "blocked". No daily series. No API spend.
- **P7, harness v2 and the same-day delta.** The v1 loop with its browser layer, model-call layer, clock and
  block detection repaired, under new agent ids, run only after its own instrument control passes every
  registered gate; then v1 and v2 on every site on the same day. The per-site difference is attributed to the
  whole bundle of changes, never one of them, and printed beside the v2 arm re-scored under v1's rules. Paid.
- **P8, arms on v2.** An extraction-only baseline (the agent placed on each site's registered answer page for one
  read, which measures accuracy given reach rather than navigation) and the Goodhart pair re-run under v2 as a
  regression check. An arm in which the agent declares an operator name waits until a verifiable identity
  exists. Paid.
- **P9, a cross-vendor panel.** Gemini, Claude and OpenAI models behind harness v2 on the same sites, with a
  published table of every way their calling contracts differ in place of any claim of an identical loop: the
  site-by-agent matrix and how far agents disagree beyond trial noise, never a vendor ranking or a cross-agent
  site score. Paid, the largest paid item. API credits have not been requested; any would be asked for only once
  the panel had a date, and disclosed before the batch they pay for.
- **P10, the front page as a dated finding.** The edition masthead and metadata row, the group split as the lede,
  the remaining finding cards, the leaderboard partitioned by success count with every trial's outcome shown,
  and a per-site interval on site pages. No API spend. Gate: no rendered value asserts a measurement that does
  not exist.
- **P12, the free lanes on GitHub Actions.** The answer-key preflight and Lighthouse on a weekly or
  hand-dispatched workflow, and the identity probe by hand only, uploading artifacts and never holding a
  database write key. No API spend.
- **P13, a large-n test of static scores against fresh behavior.** Closed unless a maintainer of the external
  dataset replies to the offer made in P11.

## Out of scope, by decision

Not in any phase unless a dated decision changes it:

- **A paid scan, and the products built on one:** a scan-your-site report, competitor comparisons, remediation
  cards and monitoring, a behavioral CI check. Others sell these; this project measures and publishes.
- **A visual redesign** of the site.
- **A quantified-loss model** ("what agent failures cost you"): the inputs it needs are not available.
- **A cohort expansion.** Adding sites changes every cohort statistic, and a cohort large enough to detect an
  effect of the size v1 looked for is beyond what hand-registered answers allow.
- **An adoption tracker.** Cloudflare Radar already publishes a superset every week.
- **A badge or registry** ("Agent-Ready: measured").
- **A before/after around Cloudflare's 2026-09-15 default-block change.** A change in the frozen loop's results
  could not be attributed to it; the test-retest measures the loop's own drift instead.

Deferred indefinitely: a probe endpoint (`POST /probe`). The Issue Form is the request path.

## What is registered

A protocol is registered on the day its section is appended to `docs/METHODOLOGY.md` or `docs/EXHIBIT.md`. The
commit precedes the run it governs, and the run's manifest records that commit. Nothing is called registered
without its date, and nothing is called in progress without a scheduled run date.

- **Before v1:** the task shape, the trial protocol, the scoring contract and the answer keys
  (`docs/METHODOLOGY.md`, `docs/COHORT.md`, `data/cohort.csv`), receipted by git tags up to `answer-key-v3`;
  the loop frozen on 2026-08-09.
- **The Goodhart exhibit:** `docs/EXHIBIT.md`, receipted by the tag `exhibit-key-v1` on 2026-08-30, before its
  batch ran.
- **With this release, on 2026-09-23:** corrections to the stale lines in the original record, each named with its
  original kept; the static axis stated as Lighthouse states it, the WebMCP open item reopened and resolved, and
  the layout-shift pass rule, with no v1 value changed; what the v1 freeze covers and what it does not; the
  identity posture and how complaints are handled; the sponsorship and credits disclosure (none as of 2026-09-23).
- **What the behavioral rate measures:** registered on 2026-09-23.
- **The instrument control:** registered on 2026-09-23. **The v1 loop's parameters as run:** registered on 2026-09-23.
- **Designed, and registered before its run if it runs:** the test-retest, harness v2 and its scoring rules, the
  same-day delta, the extraction baseline, the Goodhart re-run under v2, the identity probe and the cross-vendor
  panel. The operator-identity arm is not registered before a verifiable identity exists.
- **The kill criterion:** recorded in this file on 2026-09-23.

## Where things are

`docs/METHODOLOGY.md` (the pre-registration record), `docs/COHORT.md` and `data/cohort.csv` (the 28 sites;
the CSV is canonical), `docs/EXHIBIT.md` (the Goodhart exhibit's own record), `docs/lighthouse-report.md` (the
report), `docs/ARCHITECTURE.md` (system design and the data contract). The site:
<https://agent-score-weld.vercel.app>.

## Finished: the v1 build (Phases 1 to 5)

<details><summary>The record, kept as it happened</summary>

- **Phase 1, Supabase and Vercel foundation (2026-08-01).** Schema as git-tracked migrations (`sites`,
  `lighthouse_results`, `agent_runs`); result tables append-only by `batch_label`; the app reads under
  select-only row-level security, and only `scripts/` holds a key that can write. Deployed at
  <https://agent-score-weld.vercel.app>; any push to `main` deploys production.
- **Phase 2, cohort, scoring and harness correctness (2026-08-09).** `scripts/scoring.py` implements the
  METHODOLOGY match rules against a language-neutral vector file; both lanes read `data/cohort.csv`; the prompt
  carries each site's `question`; harness validity fixes and `--resume`. The loop froze at the end of this phase.
- **Phase 3, real data (2026-08-19).** Lane 1 across all 28 sites, Lane 2 at 28 sites, 5 trials and 2 models
  (280 trials), imported as batch `v1`, the answer-key receipt tagged before the run.
- **Phase 4, leaderboard launch (2026-08-30).** Real data by default; Spearman rho with a seeded percentile
  bootstrap interval and an explicit n, computed in `lib/stats.ts` and cross-checked against an independent
  Python implementation through a committed vector file; an agent toggle; a "not measured" state distinct from
  0%.
- **Phase 5, presentation (2026-08-30).** Per-step transcript replay; a design pass with light and dark themes,
  AA contrast and three breakpoints. Trials ended by the clock or the step budget read "Failure point: not
  recorded" rather than blaming the last action. Leaderboard sorting and filtering was not built; the table's
  ordering is addressed by P5 and P10 instead.
- **Sub-audit attribution (2026-08-30),** at `/correlation/audits`: no individual sub-audit is distinguishable
  from noise under a family-wise correction, and the sensitivity power analysis there bounds what this cohort
  could detect. Its WebMCP reading is superseded by the correction above.
- **The Goodhart exhibit (2026-08-30),** at `/correlation/exhibit`: the matched pair, registered first, run
  through the unchanged frozen loop as batch `goodhart`, never imported and in no cohort statistic.

</details>
