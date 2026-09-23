# AgentRank — methodology

This is the pre-registration record. The answer keys and match rules below were written by
hand, before any agent run, during the manual cohort pass. Treat this document as append-only:
changing a rule or an answer after runs exist invalidates those runs. It pairs with
`data/cohort.csv` (canonical cohort data) and `docs/COHORT.md` (readable per-site companion).

## The fixed task

One task shape, run on every site: **navigate from the start URL to find one pre-registered
fact and report it.** Each site carries its own specific question (the `question` column), so
the target fact varies but the task shape never does. The per-site question is required for
informational/government pages, where "extract any claim" would unfairly fail a capable agent
that extracts a different true fact.

The website is the unit of analysis, so everything about the agent is held constant: one model
(Gemini Flash), one prompt template, one harness, fixed step and time limits. If the agent
loop changes in any way, the dataset forks (new `agent_id`/version), it is never silently
amended.

Two URLs matter per site and they are different on purpose:
- `start_url` (in the CSV): where the agent starts. Usually the site root; the navigation is
  part of the test.
- The answer page (documented per site in COHORT.md): where the fact lives. Used for the
  manual pass and for scripted/extraction-only baselines, never given to the agent.

The agent's prompt must never contain the answer or a hint that leaks it. The `task_hint`
names the target ("find the price of the Basic plan"), never the value.

## Trial protocol

- 5 trials per (site, task) pair; success rate is the metric, not a binary.
- Per-trial caps: fixed max steps and a hard timeout (see `scripts/lane2-agent.py`).
- Every trial writes one `agent_runs` row: success, step count, duration, failure mode,
  full transcript. Transcripts are always stored; they make the failure labels auditable.
- Failure modes (fixed enum): `success`, `blocked` (anti-bot/login wall), `timeout`,
  `wrong_extraction` (navigated fine, wrong or no answer), `navigation_stuck` (never found
  the path), `error` (harness/technical, excluded from success-rate denominators only if the
  run never reached the site).

## The scoring contract

Success on a single run = the agent's final output contains the site's pre-registered
`answer_substring`, after the normalization below. Deterministic, reproducible, no human
judgment after the fact.

Normalization (applied to both the agent output and the registered value before matching):

1. Case-insensitive; trim and collapse whitespace.
2. Strip currency symbols ($, euro) before matching.
3. Numeric word-boundary match: a numeric value must not match as a sub-run of a longer
   number. "$20" must NOT match "$200"; "$65" must NOT match "$650".
4. Whole-dollar prices: strip thousands commas and a trailing ".00" on both sides, then match
   the digit core. "1848" matches "$1,848.00", "$1,848", and "$1848".
5. Prices with meaningful cents: keep the decimal. "12.89", "0.78", "5.60".
6. any-of: a site may register several acceptable substrings (separated by " | " in the CSV).
   Success = the output contains ANY one of them.
7. Per-site question: the agent prompt is parameterized with the site's `question`; the task
   shape is constant, only the target fact changes.

Each site's `match_rule` column says which rules apply to that row. The scorer implementation
must be a shared, unit-tested module used by the harness (implementation status: see
ROADMAP.md; the current harness still uses a naive substring check and must not be used for
publishable runs until it implements this contract).

### Exceptions and special handling

- **Zalando (zalando.pt):** the comma is the DECIMAL separator ("69,95"). Do NOT apply
  comma-stripping to this row; match "69,95" or "69.95" via any-of.
- **Voodoo Doughnut:** ZIP is the primary answer. The phone-number alternative needs
  digit-only normalization (strip all non-digits) to match "5032414704".
- **Promo prices are never the answer.** Where a page shows a promo next to the standing
  price (Spotify "$0 for 3 months", Amazon store-card offers), the registered value is always
  the standing/recurring price.

## Cohort design

28 sites (see COHORT.md), chosen for variance on both axes, not just fame:

- **Anchors:** modern SaaS/dev-tool sites expected to score high on both axes.
- **Seeded bottom:** legacy government, transit, and university pages expected to trap agents
  (buried facts, accordions, consent walls).
- **Off-diagonal bets:** sites picked to disagree with the rubric. Apple and Zalando (high
  static score expected, low behavioral success likely: heavy SPA, language confound);
  Craigslist (low static score, high behavioral success likely: plain HTML). These are the
  "does the rubric actually predict" exhibits.
- **Intentional blockers (kept to <= 5):** Amazon, Ticketmaster. Expected `failure_mode =
  blocked`. Near-zero success there is a finding (anti-bot posture is itself an
  agent-readiness factor), not measurement error.
- Domino's and NYT were dropped during the manual pass (gated/promo pricing).

Bias rule when forced to choose: prefer sites that spread the static (Lighthouse) axis,
because behavioral spread can be tuned via task difficulty after the fact and static scores
cannot.

## Stability and re-verification

- Re-verify volatile registered values shortly before a full run (product prices drift:
  Best Buy, IKEA, Zalando, Amazon).
- Every registered answer must be confirmed against the exact answer page used in the manual
  pass; product/event URLs marked `[confirm ...]` in COHORT.md must be pinned to the specific
  page before runs.
- Runs are dated (`run_at`); published results state the run window. Site redesigns between
  batches are expected and are part of what longitudinal re-runs measure.

## Known integrity gaps (open items)

- 8 cohort entries still have `[confirm exact URL]` placeholders (see COHORT.md).
- The rich match rules above are documented but not yet implemented in the harness scorer.
- `lh_webmcp` scored 0 for every site in the draft-cohort Lighthouse batch; verify the audit
  ID is current before treating that as adoption data rather than a harness bug.
- A timestamped pre-registration receipt (git hash of the answer key shown on the site) is
  planned so the "decided before any run" claim is checkable by strangers.

## Amendments (2026-09-23)

Everything above this heading is the record as it stood before v1 ran, and it is not edited.
The blocks below were appended together on 2026-09-23, in the corrections release, and each
states the day it was registered. Every numeral in them is a registered protocol constant, a
value pinned in `scripts/tests/stats-vectors.json`, or a value in a committed artifact under
`data/`, and `scripts/tests/test_appends_pinned.py` checks that on every run of the suite. A
protocol is registered on the day its block lands; a block's commit precedes the manifest
`started_at` of any run it governs, and that manifest records the commit.

### 2026-09-23: four lines above that were already false (registered on 2026-09-23)

The record above is not edited. Four of its lines stopped being true before or during the v1
run, and each is corrected here with the original left in place.

- `docs/METHODOLOGY.md:108` says eight cohort entries carried `[confirm exact URL]`
  placeholders. The count was six (`bestbuy`, `ikea`, `powells`, `zalando`, `amazon`,
  `ticketmaster`), and all six were resolved in Phase 2, before the answer key was tagged
  `answer-key-v3` and before any published trial ran. None remains in `docs/COHORT.md`.
- `docs/METHODOLOGY.md:109` says the match rules are documented but not implemented in the
  harness scorer. `scripts/scoring.py` has implemented them since 2026-08-09, with
  `scripts/tests/test_scoring.py` and `scripts/tests/scoring-vectors.json` pinning every rule,
  and the frozen loop imports it (`from scoring import score_answer`) and scored v1 through it.
- `docs/METHODOLOGY.md:110-111` asks that the `lh_webmcp` audit id be verified before an
  all-zero column is read as adoption data. The v1 report closed the item on the ground that one
  site passed. That closure is withdrawn, and the item is re-resolved in the `lh_webmcp`
  subsection below: the column measured the browser, not the sites, and no adoption count is
  published from it.
- `docs/METHODOLOGY.md:63-64` says the harness "still uses a naive substring check and must not
  be used for publishable runs until it implements this contract". That was true when written
  and false from 2026-08-09, ten days before v1 ran: the harness scores through
  `scripts/scoring.py`, which implements the contract above. Every published v1 trial was scored
  under this contract.

### 2026-09-23: the static axis, stated as Lighthouse states it (registered on 2026-09-23)

#### The static axis

`lh_total` is the arithmetic mean Lighthouse computes over the Agentic Browsing audits that
applied to a page, read from `categories["agentic-browsing"].score`. Chrome displays this
category as a fraction of checks passed and publishes no score. At Lighthouse 13.3.0, the
version v1 ran, the category has six audits: two of them (`webmcp-registered-tools`,
`webmcp-form-coverage`) informative and never weighted on any cohort page, one
(`webmcp-schema-validity`) weighted only where a page registers a tool, and the mean's
denominator is two audits for a site whose `/llms.txt` returns 4xx and three when it returns
anything else. At 13.5.0 the category has seven audits; the seventh, `ard-schema`, leaves the
denominator when no catalog is signalled or served and stays in it, scored 0, when a signalled
catalog fails to load or to validate. This was true of v1 and is stated here without changing
any v1 value.

From the dated batches of 2026-09-23 (`lh-v2-20260923` at 13.3.0, which reconstructs v1, with
the same-day companions `lh-v2-20260923-13.4.1`, `lh-v2-20260923-13.5.0` and
`lh-v2-20260923-desktop`): Lighthouse is pinned, 13.5.0 is the pin from that date, and every
later version change is bridged by a same-day pair under a new dated label; the Chrome binary is
Playwright's Chromium 151.0.7922.34 and is recorded in the batch manifest; three runs per site
are retained as raw reports under `data/lhr/<batch>/`; the row is the median run with the
spread beside it; every audit's `scoreDisplayMode` is recorded; and Chrome's fraction is
recorded as a numerator and a denominator. Lane 1 labels carry their date and are never re-used.
The defaults the command implies (mobile emulation at 412x823 and 1.75x, simulated throttling)
are recorded from each report, and the desktop companion records Lighthouse's desktop preset
the same way. Comparisons over the static panel are three families, each declared before it is
computed: (A) agreement among the three static scanners (the Lighthouse category mean, ora.ai's
score and Cloudflare's level), m = 3, Spearman rho with a bootstrap interval per pair; (B) each
static score against the site success rate of each published agent, the absolute Spearman rho
under a Westfall-Young maxT correction at 0.05, with a within-tier permutation as the confound
check; and (C) three DOM-content measures against the site rate under the same test. None of the
three has been computed as of 2026-09-23; the scanner columns for Family A were fetched on
2026-09-23 (`data/scanners-20260923.json`) and a family is published only once its vectors are
pinned in both languages.

#### The `lh_webmcp` open item, reopened and resolved

The open item above ("verify the audit id is current before treating that as adoption data")
was closed in the v1 report on the ground that one site passed. The audit id is live. The
column measured the browser: `webmcp-registered-tools` is informative, returns 1 on every path
where the WebMCP API is exposed, and is `notApplicable` when the Chrome that ran Lighthouse
exposes no `navigator.modelContext`. Its two values are two states of the instrument. On
2026-09-23, under Chromium 151.0.7922.34, the audit applied on 28 of 28 sites and scored 1 on
all 28, with a registered tool listed on one. No adoption count is published from it; from the
dated batches the row records whether the audits applied and, when they did, the number of
tools listed.

#### The CLS pass rule

v1 recorded `cumulative-layout-shift` as passed only at score 1.00; Lighthouse's report shows
pass at 0.90. The rule was not registered here before v1 ran. It is not changed on v1 rows.
Under Lighthouse's rule the v1 CLS row's point estimate is negative for both agents and no
verdict changes; the alternative-rule sensitivity is recorded as a range over the eight
unresolved denominators in the `x_axis_decomposition` block of
`scripts/tests/stats-vectors.json`, and the figures here are read from that block: for
`gemini-3.5-flash-lite` the published gap of +0.3 points becomes a median of −11.0 (range −31.3
to +6.7 over the 256 assignments); for `gemini-3.6-flash` +16.5 becomes −2.6 (range −23.3 to
+15.6). Neither reaches the family-wise critical value of 49.0 points. From the dated batches
the continuous score is recorded; the binary column keeps the 1.00 rule so it never means two
things, and any family measured on those rows uses Lighthouse's 0.90 verdict as the CLS
predictor with the 1.00 split as a stated sensitivity.

### 2026-09-23: the v1 loop's parameters as run, and what the freeze covers (registered on 2026-09-23)

#### The v1 loop's parameters as run

`scripts/lane2-agent.py` at `655f4d2` through `174f603` ran with these values, none of which
the trial-protocol section registered. They are registered here as-is so the frozen line can be
re-run identically: start goto 30 s to domcontentloaded; navigate 20 s; the wait after click and
type is `wait_for_load_state`, which returns in 0-1 ms and does not wait for the navigation the
action caused; fill with Playwright's default 30 s timeout; click as CSS then visible text, first
match only, main frame plus up to five child frames, 3 s per attempt; screenshot with the
default 30 s timeout; no settle before any capture; 15 steps; a 90 s clock that includes page
time and every successful model call and excludes failed attempts and backoff; 8,000 characters
of page text; a 1280x800 viewport PNG; `temperature=0` and `max_output_tokens=512` as set in
the frozen file, JSON mime type, bare `json.loads`, three retries on any failure; a `Chrome/124`
Windows user agent beside the browser's own `HeadlessChrome;v=151` client hint and `macOS`
platform hint; `blocked` assigned when the model answered `BLOCKED`; two agent processes
appending to one file concurrently for part of the run; Playwright 1.62.0 and Chromium
151.0.7922.34 (probable, unrecorded). Its instrument control is `instrument-v1`. Every later run
of this loop uses that Playwright and Chromium build, enforced by the batch script, and its
manifest records the commit of this block. `blocked` on v1 rows is the agent's own report, which
this harness could not verify; v1 rows are published with that report recorded as self-reported,
never as corroborated.

#### What the freeze covers

The v1 loop was frozen on 2026-08-09. This section names, without changing anything, what that
freeze covers and what it does not, so that operational work is never mistaken for a fork.

Frozen. A change here forks the dataset (new `agent_id`, new batch) and is registered by its
own appended section before it runs: the model and its generation config; the prompt template
and the order of its parts; the action vocabulary; the step cap and the trial clock, including
what the clock does and does not subtract; the observation the model receives; the scoring
contract and every match rule; the answer key and its per-site values; the declared identity
(user agent and client hints) as sent, including the browser build that sets the client hints;
and the vantage the run is measured from.

Not frozen. A change here is an operations change, is recorded in the run manifest, and forks
nothing: the file and directory layout of local artifacts; resume and retry of uncompleted
trials; the answer-key preflight and the human pass; health checks and their gates; the run
manifest and what it records; process orchestration and locking; where a non-frozen process
(Lane 1, the preflight, the identity probe, the keep-alive) runs; and the version pinning that
makes any of the above reproducible.

Three consequences. Pinning Playwright and recording the Chromium build changes no frozen
parameter but makes the frozen ones checkable, so both are required from the first batch after
this date. On the frozen line the build is enforced, not only recorded: a batch runs only on the
Playwright version pinned in `scripts/requirements.txt` and the Chromium build that version
installs, the build the frozen loop probably ran (it was not recorded at the time), and the
launcher refuses any other. And because the vantage is frozen, a batch measured from a cloud
runner is a different measurement: it carries its own batch label and its own manifest, and is
never merged with a batch measured from the residential vantage.

### 2026-09-23: the instrument control (registered on 2026-09-23, before the first pass; not yet run)

Every behavioral batch after v1 is preceded, on the same day and from the same vantage, by a
zero-model instrument control: the harness's browser layer (goto, capture, type, click, scroll,
navigate) driven by the committed action table `data/instrument-actions.csv`, committed before
the first pass, against every cohort start URL, three passes, no model call. Its record is
`data/instrument-<harness>.jsonl` with a manifest naming the harness commit, Playwright and
Chromium versions, the identity sent, and the vantage. It is never imported and never enters a
cohort statistic. The first is `instrument-v1`, published as the instrument error beside the v1
results. As of 2026-09-23 it is registered and has not run: no pass exists, and no surface cites
a verdict from it until the first complete three-pass run is committed with its date.

A harness build may run a paid batch only if its control passes all of: G1 no capture call
fails; G2 no post-action capture is taken during, or before, the navigation the action caused
(3.0 s settle); G3 no capture, type, click or scroll call exceeds 9,000 ms, an absolute
threshold that does not change with the trial clock; G4 no click leaves a matched, visible
target unclicked; G5 no primitive raises anything but a timeout; G6 no first capture is empty
while the settled page is not; G7 the user agent and client hints declare the same browser
version; G8 every site reached by the previous published control is still reached, and every
unreached site is named with its status or error. Each is a count against a registered
threshold, computed identically in both languages (`lib/instrument.ts` and
`scripts/instrument_gates.py`, which land with the control).

The v1 loop is exempt: it is frozen for test-retest and its control is published beside it, not
used to stop it. Thresholds change only by a further dated amendment here. The published
`instrument-v1` is the first complete three-pass run; any exclusion or caveat derived from it
names that run and its date, and is never re-derived from a later control. This block's commit
precedes the control's manifest `started_at`, and the manifest records the commit.

### 2026-09-23: what the behavioral rate measures (registered on 2026-09-23)

A site's rate is the fraction of its measured trials in which the named, frozen agent, starting
at the registered start URL under the registered identity and vantage, reported the
pre-registered fact from a page on the site's own domains within 15 steps and the registered
clock. It measures reachability under a budget, not comprehension: in v1 every substantive
answer matched its key (146 of 146) and no trial that ran out of time had loaded the answer
page. Sentences about this axis say "reached" or "found within the budget", never "understood"
or "correct".

### 2026-09-23: the leaderboard, the harness-artifact exclusion rule, and answered trials (registered on 2026-09-23)

The leaderboard shows each trial's outcome, groups sites by success count, breaks ties by name,
and carries no rank; the Lighthouse category mean is never an ordering key. A site is a
harness-artifact site under one rule: (b) every one of its v1 trials is a harness error; or
(d) the first complete three-pass `instrument-v1` names it as failing G1, G4 or G5 in two of
three passes, applied by a dated amendment when that control runs and never re-derived from a
later one. Until the control runs, only (b) applies; on 2026-09-23 rule (b) names TriMet (10 of
10 trials `error`) and no other site. The published correlation keeps v1's pre-registered
denominator (n = 27); the sensitivity with harness-artifact sites removed is printed beside it,
never in its place (under rule (b), n = 26: Spearman rho +0.129 for `gemini-3.5-flash-lite` and
−0.006 for `gemini-3.6-flash`), and the all-succeeded and all-failed groups are reported with
their Lighthouse category means and ranges with the excluded sites named. Over trials that
produced an answer, answers are classed as matched, corroborated block, self-reported block or
wrong answer; only a non-matching fact is called wrong, and self-reported blocks are counted
beside the matched answers as unverified, never as correct. On v1 every block is self-reported
(26 of the 172 answered trials; 146 matched; none wrong), and the self-reported blocks are
split by where the trial ended: off the site's domains (3), on a blank capture (4), or on the
site's domains (19).

### 2026-09-23: identity posture and complaints (registered on 2026-09-23)

Batch `v1` ran under an undeclared, self-contradictory browser identity that honoured no
robots.txt and signed nothing; that is registered as-is above. From harness v2 the default
identity is the browser's own version and platform declaring no operator, and every paid batch
is preceded that morning by the identity probe (whose own protocol is registered here before its
first run), so the record for every site shows how it treated the harness's honest identity and
nine others; a declared-identity arm is registered separately, before it runs, once a verified
identity exists, and none has run as of 2026-09-23. The probe sends the published user-agent
strings of named third-party agents from this project's own address, for reachability only. A
site may stop the declared arm for future batches with a robots.txt rule addressed to
`AgentRank` or in writing; the result is recorded as not measured by policy. Published rows are
never removed; framing errors are corrected by dated amendment; a complaint is acknowledged
within five business days and answered within 30; a legal demand pauses new measurement of that
site pending review and takes nothing down by itself.

### 2026-09-23: sponsorship and credits disclosure (registered on 2026-09-23)

Any API credits, sponsorship or in-kind support are named here with the date and the amount
before the first batch they pay for. No funder sees a result before publication, no funder
chooses the cohort, the task or the agents, and a funded arm is published whatever it measures.
As of 2026-09-23: none.
