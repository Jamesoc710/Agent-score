# An external check on the Lighthouse Agentic Browsing category: two audit defects, one misreading of our own, one counterexample, and a bounded null

**AgentRank v1: 28 sites, 280 agent trials, run 19 August 2026 against Lighthouse 13.3.0. The
static axis was re-measured on 2026-09-23 at 13.3.0, 13.4.1 and 13.5.0, with a desktop-preset
companion, every raw report retained (the dated `lh-v2-20260923` batches).** Prepared for the
Lighthouse team. Written by James (`Jamesoc710/Agent-score`). Every figure below is either read
from a committed artifact or pinned in the project's two-language vector file; links are in
[§11](#11-links-and-how-to-check-any-of-this).

**One thing in the category we think you will want to fix, one place we misread your audit, one
authored counterexample, and a null with a bound on it.**

- **The denominator moves with a site's HTTP status, and now on two audits** ([§3a](#3a-the-denominator-artifact-measured-on-two-audits)).
  A clean 404 at `/llms.txt` takes the audit out of the category's denominator; a 200 with a
  non-conforming body keeps it in at 0. Six v1 sites with identical recorded sub-audits took
  category means of 100 (four of them) and 67 (two) on that difference alone. At 13.5.0 the new
  `ard-schema` audit has the same shape, and on 2026-09-23 it applied to 2 of 28 sites and scored
  0 on both: github.com, which publishes a real catalog that fails the bundled schema, fell from
  99 to 74; zalando.com, which answers the well-known path with a 200 HTML page, fell from 67 to
  50. The 26 sites that publish nothing were untouched.
- **We read a conformance test as an adoption test** ([§3b](#3b-conformance-versus-adoption-our-error)).
  The first version of this document said the `llms-txt` audit's H1 requirement was a bug and
  that Twilio "ships llms.txt". The audit is right and our reading was wrong.
- **Two authored pages with identical Lighthouse output, one of which the agent cannot use**
  ([§3c](#3c-the-goodhart-pair)). Both at category mean 100, byte-identical screenshots; one
  solved 10 of 10 trials in one step, the other 0 of 10.
- **And it generalises, within a bound** ([§4](#4-and-it-generalises-the-null), [§5](#5-the-power-bound)).
  No relationship between the category mean and measured success that 27 sites could
  distinguish from noise, and a sensitivity power analysis showing the cohort could not have
  detected an llms.txt-shaped effect had one existed.

---

## 1. What we are not claiming

Stated first, because it constrains everything after it.

- **This category has no score, and Chrome's documentation says so.** Lighthouse declares the
  category `categoryScoreDisplayMode: 'fraction'` and Chrome renders it as checks passed out of
  checks that applied. We read `categories["agentic-browsing"].score` anyway, because the CLI
  emits it under that name and because that is what any third party will do; we then treated it
  as a ranking, and we were wrong to. That we did, and the shape of the number we got, is worth
  more to you than our correlation. Throughout this document the number is the *category mean*,
  never a score.
- **This is not evidence that the audits do not predict agent success.** A study that cannot
  reach the effect size it is looking for has not measured an absence. See §5.
- **One task shape.** Navigate from a start URL and report one pre-registered fact. Nothing about
  forms, checkout, authentication, multi-page workflows or agent-initiated actions.
- **One harness, with a measured instrument term.** One prompt template, one browser loop, fixed
  step and time budgets. 24 of 280 trials died inside our own screenshot capture (§2), and the
  harness's error is named on every surface that shows it.
- **Two models from one family.** `gemini-3.5-flash-lite` and `gemini-3.6-flash`, both cheap
  tiers, deliberately. Gemini only. The two are not distinguishable on this cohort (§2).
- **28 sites, one run window.** No longitudinal data, no within-site before/after.
- **The sub-audit analysis (§4 onward) is exploratory and was not pre-registered.** The task,
  answer keys, match rules and trial protocol were. The per-audit comparison was not.

## 2. What was measured, and how

Enough detail to replicate. Full record: [`docs/METHODOLOGY.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/METHODOLOGY.md)
(pre-registration, append-only; the corrections this document relies on are its amendment
section of 2026-09-23) and [`docs/COHORT.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/COHORT.md).

**Cohort: 28 sites, biased on purpose.** [`data/cohort.csv`](https://github.com/Jamesoc710/Agent-score/blob/main/data/cohort.csv)
is canonical: 6 modern-SaaS *anchors* expected to do well on both axes, 8 government, transit
and university pages seeded to trap agents, 5 middle retail sites, 4 small businesses, 3
*off-diagonal bets* picked to disagree with the rubric (Apple, Zalando: high static, expected
low behavioral; Craigslist: the reverse), and 2 *intentional blockers* (Amazon, Ticketmaster)
where anti-bot posture is itself the finding. The documented bias rule was "prefer sites that
spread the static axis", which, as §6 shows, is exactly what made the llms.txt comparison
unanswerable.

**Static axis, v1 (2026-08-19): the unmodified Lighthouse CLI at 13.3.0.**
`npx lighthouse <url> --output=json --quiet --only-categories=agentic-browsing
--chrome-flags='--headless --no-sandbox --disable-gpu'`, one run per site,
`lighthouse@13.3.0` from the committed lockfile, Chrome unpinned. Recorded per site:
`lh_total = Math.round(categories["agentic-browsing"].score * 100)` and four 0/1 flags for
`agent-accessibility-tree`, `cumulative-layout-shift`, `llms-txt` and `webmcp-registered-tools`.
Three defects in that extraction, all ours:

1. **`score === null` was read as 0** (`scripts/lane1-lighthouse.ts:68-72` at `174f603`).
   Lighthouse returns `null` for every non-scored display mode, so two of the four flags merged
   "did not pass" with "did not apply".
2. **The CLS flag passed only at `score === 1`.** Lighthouse's own report shows the audit as
   passed at 0.90. The rule was not registered before the run. It is not changed on v1 rows; its
   consequence is in §4.
3. **No raw report was kept** (`scripts/lane1-lighthouse.ts:106` at `174f603` deletes the
   temporary file after extraction). Everything below about v1's own denominators is therefore a
   reconstruction from `lh_total` arithmetic, checked on 2026-09-23 against retained reports.

**Version scope.** At 13.3.0, the version v1 ran, the category has six audits:
`agent-accessibility-tree`, `cumulative-layout-shift`, `llms-txt`, `webmcp-registered-tools`,
`webmcp-form-coverage` and `webmcp-schema-validity`. On the 2026-09-23 re-measurement at 13.3.0,
`webmcp-registered-tools` was `informative` on 28 of 28 sites; `webmcp-form-coverage` was
`informative` on 19 and `notApplicable` on 9; `webmcp-schema-validity` was `notApplicable` on 27
and `binary`, weight 1, on the one site that registers a tool (Target); and `llms-txt` was
`binary` on 10 sites and `notApplicable` on 18. The denominator was two audits on 18 sites, three
on 9 and four on 1. At 13.5.0, current on the day this is filed, the category has seven audits,
the seventh `ard-schema` at weight 1, grouped with `llms-txt`; on 2026-09-23 it was `binary` on 2
sites and `notApplicable` on 26, and the denominator was two on 18, three on 7 and four on 3.
`webmcp-form-coverage` scores as `binary` only when every form on a page is annotated
(`core/audits/agentic/webmcp-form-coverage.js:69-74` at `v13.5.0`); no cohort page met that.

**Form factor, a second construct mismatch.** The command passes no preset, so Lighthouse used
its defaults: `formFactor: mobile`, screen emulation 412x823 at 1.75x, simulated throttling at
150 ms RTT and 4x CPU slowdown, an Android user agent. The retained 2026-09-23 reports record
this; for v1 it is inferred from the identical command. The agent, meanwhile, ran a 1280x800
desktop viewport. So the layout-shift half of the category mean was measured on an emulated
phone the agent never saw, beside the reachability-versus-comprehension mismatch already stated.
A same-day companion batch under `--preset=desktop` (1350x940 at 1x, 40 ms RTT, no CPU slowdown)
moved the category mean on 18 of 28 sites (spotify 59 to 5, tx_dmv and ssa 100 to 50, shopify
67 to 100), against 8 of 28 for each of the version companions. CLS passed Lighthouse's own
0.90 rule on 20 of 28 sites as an emulated phone and 23 of 28 as a desktop.

**Static axis, re-measured (2026-09-23).** Four dated batches, back to back from the same
residential connection: `lh-v2-20260923` at 13.3.0, which reconstructs v1, and same-day
companions at 13.4.1, 13.5.0 and the desktop preset. Chrome pinned to Playwright's Chromium
151.0.7922.34; three runs per site, every raw report retained under `data/lhr/<batch>/`; the
published row is the median run with the spread beside it; every audit's `scoreDisplayMode`,
the Lighthouse version and Chrome's own fraction recorded; a sidecar `GET` of `/llms.txt` with
status, content type and byte count. Four sites moved 10 points or more across three same-day
repeats at 13.3.0 (spotify 57 to 75, usps 36 to 50, voodoo 67 to 100, bear 12 to 40), which is
the run-to-run noise any single-run number carries. Lane 1 is not the frozen loop, so recording
all of this forks nothing. The reconstruction (`data/lhr/lh-v2-20260923/reconstruction.json`)
reproduces 76 of 112 v1 flags; every difference carries an evidenced reason (27 sites: the WebMCP
audits now apply, §8; 10: layout shift moved; 2: the `/llms.txt` status changed), except voodoo,
whose accessibility-tree audit went from 0 to 1 and mean from 14 to 100 for reasons v1's
missing report cannot separate; it is named as unexplained in the committed test.

**Behavioral axis: one frozen loop.** Playwright plus Gemini, a screenshot and the page text per
step. Frozen 2026-08-09 and unchanged since; any change forks the dataset under a new
`agent_id`. 15 steps, a 90-second clock, `temperature = 0`, JSON response mode, 8,000 characters
of page text per step, up to 3 attempts per model call with backoff excluded from the clock so
an API blip cannot become a `timeout` verdict against the site. The prompt is one template
parameterized only by the site's `question`; a test proves no registered answer can appear in
it. Every undeclared parameter the loop ran with (timeouts, the load wait, the identity it sent,
the probable browser build) is registered as run in the METHODOLOGY amendment of 2026-09-23.

**Scoring: pre-registered exact match, no post-hoc judgment.** Success means the agent's final
answer contains the site's registered `answer_substring` after a fixed normalization
(case and whitespace, currency stripping, a numeric word boundary so `$20` cannot match `$200`,
thousands-comma and trailing-`.00` handling, `any-of` alternatives, one documented decimal-comma
exception for `zalando.pt`), implemented once in
[`scripts/scoring.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/scoring.py)
and pinned by a language-neutral vector file. Answer keys were written by hand before any run and
are git-tagged (`answer-key-v3`).

**What the rate measures (registered 2026-09-23).** A site's rate is the fraction of its
measured trials in which this agent, from this vantage, reported the registered fact within 15
steps and 90 seconds. It measures reachability under a budget, not comprehension, and no trial
that ran out of time had loaded its answer page.

**Trial protocol.** 5 trials per (site, model); the metric is the site's success *rate*. 28
sites, 5 trials, 2 models: 280 trials, all with full stored transcripts.

**Run window.** Lighthouse 2026-08-19 16:04 to 16:12 UTC; agent trials 16:14 to 18:53 UTC.

**The denominator rule, which decides one site.** Failure modes are a fixed enum; an `error`
trial counts as a failure and stays in the denominator *unless the run never reached the site*,
in which case there is no behavioral measurement to score and the site is not measured. In v1:
45 error trials, 35 counted as failures. The other 10 are all of Costco, whose every trial died
at `Page.goto` with `net::ERR_HTTP2_PROTOCOL_ERROR` before the page loaded. Costco is therefore
**not measured, not scored 0%**, which is why every n below is 27 rather than 28. Scoring it 0% at
n = 28 would move the pooled llms.txt gap from +39.8 to +41.8 points and its exact p from 0.033
to 0.026, so the exclusion is, if anything, working against us.

**The error taxonomy.** The 45 `error` trials, by what threw, from `data/agent-runs-v1.jsonl`:

| what threw | trials | sites |
|---|---|---|
| `Page.screenshot`: protocol error in `captureScreenshot` (the page navigated under the capture) | 17 | trimet 10, ca_dmv 6, ticketmaster 1 |
| `Page.goto`: `net::ERR_HTTP2_PROTOCOL_ERROR` at the start URL | 10 | costco 10 |
| model response not parseable as JSON after 3 attempts | 11 | shopify 3, powells 2, ticketmaster 2, ca_dmv 1, portland 1, cloudflare 1, irs 1 |
| `Page.evaluate`: execution context destroyed (the page navigated under the text capture) | 6 | portland 6 |
| `Page.screenshot`: timeout | 1 | zalando 1 |

24 of the 45 are the harness's own capture racing a navigation it did not wait for. Those rows
are scored as failures against the site under the pre-registered rule, and the rule is not
changed after the fact; what changes is how they are labelled.

**The sensitivity table, under one registered rule.** A site is a harness-artifact site under
rule (b), every one of its v1 trials a harness error, or rule (d), named by the first complete
three-pass instrument control (below). Until that control runs, only (b) applies, and it names
TriMet (10 of 10 trials `error`). The published correlation keeps the pre-registered denominator;
the sensitivity is printed beside it, never in its place.

| frame | n | `gemini-3.5-flash-lite` rho, 95% CI | `gemini-3.6-flash` rho, 95% CI |
|---|---|---|---|
| published, pre-registered denominator | 27 | +0.106 [−0.293, +0.480] | −0.021 [−0.374, +0.332] |
| rule (b): TriMet removed | 26 | +0.129 [−0.260, +0.508] | −0.006 [−0.365, +0.356] |
| rule (d): sites the instrument control names | pending the first complete `instrument-v1`, dated when it applies | | |

**The answered-trial split.** On the 172 trials where the agent produced an answer, no answer
was a wrong fact: 146 matched the registered key; 26 were the agent's own reports of being
blocked, which v1's harness could not verify, and seven of which describe a blank page or
Google's CAPTCHA rather than the site. The four answered-trial classes are `matched` (146),
`corroborated_blocked` (not measurable on v1: the harness recorded no block signal to
corroborate with), `self_reported_blocked` (26: 3 off the site's domains, on Google's CAPTCHA;
4 on a blank capture; 19 on the site's own pages) and `wrong_answer` (0). Only `wrong_answer` is
"wrong"; the 26 are counted as unverified, never as correct. Two of the 146 matched answers were
reported from a page outside the site's domains; v1's scorer did not check the domain, and both
stand as scored. The other 108 trials produced no answer: 57 ended on the clock, 45 in a harness
error, 6 stuck in navigation.

**The two models are not distinguishable on this cohort.** Paired over the 27 measured sites,
`gemini-3.6-flash` minus `gemini-3.5-flash-lite` is +5.9 points, 95% CI [−8.89, +22.22]; 11 of
27 sites moved; the exact within-site rerandomization test gives p = 0.175.

**The instrument control (registered on 2026-09-23, not yet run).** A zero-model control that
drives the harness's browser layer with a committed action table over every start URL, three
passes, with eight registered gates (no capture failure, no capture during a navigation, no
primitive over 9,000 ms, and so on). It is what would turn "TriMet's trials look like a harness
artifact" into a dated measurement, and what would say whether Oregon State's 10 timeouts carry
an instrument term. Its protocol is in the METHODOLOGY amendment; it has not run, and nothing
here cites a verdict from it.

## 3a. The denominator artifact, measured on two audits

Both audits decide whether they are in the category's denominator by what the server says.
"In the denominator" means both Lighthouse's mean (`core/scoring.js:64-67` forces weight 0 on
`notApplicable`) and Chrome's fraction (`report/renderer/report-utils.js:319-323` skips it). Line
numbers are at tag `v13.5.0`.

`llms-txt` (`core/audits/agentic/llms-txt.js`; unchanged from 13.4.1, and 13.3.0 differs only by
a stricter H1 regex and the absent `errorMessage` branch):

| branch | condition | score | display mode | in the denominator |
|---|---|---|---|---|
| fetch error | `errorMessage` set (`:71-76`) | 0 | binary | yes |
| no status | (`:78-83`) | 0 | binary | yes |
| 5xx | (`:85-89`) | 0 | binary | yes |
| 4xx, a clean 404 included | (`:90-95`) | 1 | `notApplicable` | **no** |
| 2xx, non-conforming | no `^\s*#\s+` heading, no Markdown link, or under 50 characters; the body is parsed whatever its content type (`:101-118`) | 0 | binary | yes |
| 2xx, conforming | | 1 | binary | yes |

`ard-schema` (`core/audits/agentic/ard-schema.js`, new at 13.5.0, weight 1, grouped with
`llms-txt`):

| branch | condition | score | display mode | in the denominator |
|---|---|---|---|---|
| no catalog | no discovery signal (robots.txt `Agentmap:`, `<link rel="ai-catalog">`, a `Link: rel="ai-catalog"` header; gatherer `agentic/ard.js:30-97`) and no 200 at `/.well-known/ai-catalog.json` (`:64-76`) | 1 | `notApplicable` | **no** |
| signalled, not loadable | a signal exists but the fetch is not 200 or the body is empty (`:78-83`) | 0 | binary | yes |
| 200, invalid | conformance errors, a non-JSON body included ("Malformed JSON", `third-party/ard/ard.js:80-86`; `:120-122`) | 0 | binary | yes |
| 200, warnings only | (`:123-124`) | 0.9 | binary | yes |
| 200, clean | | 1 | binary | yes |

On both audits, absent leaves the denominator and broken stays in it at 0. So a site that
publishes a broken file scores below one that publishes none, and a server that answers an
unknown path with a clean 404 scores above one that answers it with 200 and HTML.

**The llms.txt half, on the v1 artifact.** Six v1 sites recorded identical sub-audits
(accessibility tree pass, layout shift pass, llms.txt 0, WebMCP 0) and two different category
means. v1 kept no report, so the middle column is what `lh_total` arithmetic allows; the right
columns are the retained 2026-09-23 report at 13.3.0 and its `/llms.txt` sidecar.

| site | v1 mean (2026-08-19) | denominator consistent with it | 2026-09-23 at 13.3.0 | `/llms.txt` on 2026-09-23 |
|---|---|---|---|---|
| tx_dmv | 100 | 2 audits | 100, 2 of 2 | 404 |
| ssa | 100 | 2 | 100, 2 of 2 | 404 |
| portland | 100 | 2 | 100, 2 of 2 | 404 |
| spotify | 100 | 2 | 59, 1 of 2 (layout shift moved; the denominator did not) | 404 |
| ca_dmv | 67 | 3 | 67, 2 of 3 | 200, `text/html`, 20,171 bytes: "missing a required H1 header", "does not appear to contain any links" |
| zalando | 67 | 3 | 67, 2 of 3 | 200, `text/html`, 48,385 bytes: the same two reasons |

None of the six publishes an llms.txt. Four answer the path with a 404 and take 100; two answer
it with their HTML shell and take 67. Costco is the same artifact in the other direction: its v1
mean of 49 is consistent only with a three-audit denominator (a 0 on `llms-txt`, so a fetch
error, a 5xx or a 200 body on 2026-08-19); on 2026-09-23 the path returned 404, the audit left
the denominator, and the mean was 75 with the layout-shift score essentially unchanged (0.49
against the 0.46 to 0.48 the v1 arithmetic implies).

**The `ard-schema` half, measured.** On 2026-09-23 at 13.5.0 the audit applied on 2 of 28 sites
and scored 0 on both:

- **github.com** publishes a real catalog at `/.well-known/ai-catalog.json`. It fails the bundled
  schema validation: `'displayName' is a required property at path 'entries.0'`. Its category
  mean fell from 99 at 13.3.0 to 74 at 13.5.0 (3 of 4 checks passed).
- **zalando.com** answers the well-known path with a 200 HTML page. The validator records
  "Malformed JSON in manifest: SyntaxError: Unexpected token '<'". Its mean fell from 67 to 50
  (2 of 4).
- The other 26 sites signal no catalog and serve nothing there, so the audit did not apply and
  their means did not move for this reason.

So on the day 13.5.0 shipped to the CLI, the one cohort site that had adopted the discovery
format Lighthouse now checks lost 25 points relative to the 26 that had done nothing, and a
soft-404 cost a second site 17. We are not arguing the schema check is wrong, or that a
soft-404 should pass. We are pointing at the denominator.

**Reproduction, one command per site.** With `lighthouse@13.5.0` and any Chrome:
`npx lighthouse https://www.txdmv.gov/ --output=json --only-categories=agentic-browsing
--chrome-flags='--headless'` and the same for `https://www.dmv.ca.gov/`; compare
`audits["llms-txt"].scoreDisplayMode` and `categories["agentic-browsing"].score`. Our retained
reports for all 28 sites at all four batches are under `data/lhr/`.

**The question, not a demand.** Is a clean 404 meant to score the same as a well-formed file, or
should absence be distinguishable from inapplicability? And is the same shape on the seventh
audit intended, so that publishing a catalog with one missing field ranks a site below every
site that publishes none?

## 3b. Conformance versus adoption: our error

The first version of this document said that six sites "ship llms.txt", that Twilio was "the one
anchor without the file", and that the audit's H1 requirement was a bug. All three were wrong in
the same way: we read a conformance test as an adoption test.

The audit's test at 13.3.0 was the regex `/^#\s+.+/m` on the body, plus a Markdown link and a
minimum length; 13.4.1 and 13.5.0 relax the heading test to allow leading whitespace and add an
`errorMessage` branch, and are otherwise the same. llmstxt.org makes the H1 *"the only required
section"*. So a 2xx body without an H1 is non-conformant by the format's own rule, and the audit
is right to score it 0.

On 2026-08-19 Twilio's llms.txt audit scored 0 inside a three-audit denominator (its v1 mean of
33 is consistent with no other denominator), which under the branch table means a 2xx body that
failed the check. A direct read on 2026-09-08 found a 2.3 MB `text/markdown` file at
`/llms.txt`, link-dense, with every heading an H2 and no H1; that read is in the project's notes,
not in a committed artifact. On 2026-09-23 the same path served 2,340,239 bytes of `text/plain`
that passed the audit at 13.3.0, 13.4.1 and 13.5.0; the file changed between the two reads, and
every present-tense Twilio sentence in this document is dated to the 2026-09-23 batch. ca_dmv
and zalando are the other case: a 200 with the site's HTML shell, parsed as Markdown because the
audit checks no content type, and failed for the two reasons the audit itself prints (§3a).

What the audit measures is therefore "serves a spec-conformant llms.txt", and that is stricter
than the "ships the file" we thought we were testing in §6. The error was ours; it is corrected
in the METHODOLOGY amendment and on every live page.

## 3c. The Goodhart pair

Two authored pages, registered before they were run and run through the identical frozen loop
as batch `goodhart` on 2026-08-30 (`docs/EXHIBIT.md` is their own pre-registration record). A
40-row reference table in a fixed-height scroll container showing the first 12 rows; the same
question, the same registered answer, the same styling and copy. They differ only in the render
function: Exhibit A places all 40 rows in the document and lets the container clip them; Exhibit
B places only the rows inside the visible window, with spacer rows reserving the height of the
rest, which is ordinary list virtualization.

Both pages take a category mean of 100 with identical sub-audits (accessibility tree pass,
layout shift pass, `llms-txt` and the three WebMCP audits not applicable, which is the same route
by which four real cohort sites take 100). Captured with the harness's own settings, their load
screenshots hash identically (`8870b70d7d59599242e969d113b356c7`). The agent solved Exhibit A 10
of 10 trials on the first step, both models; it solved Exhibit B 0 of 10, every trial spending
its full 15-step budget on `scroll`, each step reasoning that the target row was not visible
yet. On Exhibit B the row is not off-screen; it is absent from the DOM, the accessibility tree,
the text and the pixels.

What the exhibit does not claim, in its own words: not that the audit is gameable in general
(one authored page is n = 1; it shows the two measures can be made to come apart, not how often
they do); not that the audit is wrong (every audit in the category passed on both pages,
correctly; passing them is not sufficient for the behavioral outcome); nothing about any real
website; and nothing about a different agent, since the claim is scoped to the agent that
produced v1's y-axis.

The pair answers a question the team asked itself. In the April 2026 review of the llms.txt
audit (#16970) a reviewer noted that *"its possible people add these files just to make LH
happy"* and asked that the check be validated. The pair is that concern one level up: a page
built to satisfy every check the category makes, and satisfy them honestly, on which the agent
still cannot find the fact.

## 4. And it generalises: the null

Demoted to fourth on purpose. The three sections above are the useful part.

| model | Spearman rho | 95% CI | n |
|---|---|---|---|
| `gemini-3.5-flash-lite` (headline) | **+0.106** | [−0.293, +0.480] | 27 |
| `gemini-3.6-flash` | −0.021 | [−0.374, +0.332] | 27 |

Overall task success: 51.1% (69 of 135 measured trials) for the lite tier, 57.0% (77 of 135) for
3.6-flash; the two are not distinguishable (§2). The interval is a 10,000-iteration percentile
bootstrap resampling sites, seed 20260819. **No relationship between the category mean and
measured success that these 27 sites could distinguish from noise.** The one registered
sensitivity, TriMet removed under rule (b), is +0.129 [−0.260, +0.508] and −0.006 [−0.365,
+0.356] at n = 26 (§2); rule (d) is pending the first complete instrument control. Split the
sites by outcome instead: for the lite tier the 11 sites where every trial succeeded have a mean
category mean of 72.1 (range 12 to 100) and the 9 where every trial failed have 68.1 (33 to
100); for 3.6-flash, 13 sites at 61.4 and 8 at 64.1. The illustration, not a test: `tx_dmv` at
category mean 100 with 0 of 10 trials succeeding, every trial ending on the clock; `powells` at
3 with 8 of 10; `bear` at 12 with 10 of 10. None of the three is a harness-artifact site under
the registered rule. Live scatter: [`/correlation`](https://agent-score-weld.vercel.app/correlation).

**Why the mean is mostly layout shift.** Fourteen of the 28 sites are identical on every
agent-specific input the category records and span 3 to 50 on the category mean; the mean's
rank order follows layout shift (rho between the mean and the reconstructed CLS score +0.70,
from +0.61 to +0.77 over the 256 assignments of the eight denominators v1's arithmetic leaves
unresolved). Layout shift is a Core Web Vital measured, here, on an emulated phone.

**The sub-audit family.** Each recorded flag splits the cohort in two, so each can be asked the
mean's question directly. Estimand: the difference in mean *site* success rate between passing
and failing sites, in percentage points. Sorted by audit id, never by effect size. The CLS row is
labelled by the rule v1 actually applied.

**Gemini 3.5 Flash Lite (27 sites)**

| audit | split | gap (pts) | 95% CI | family-wise p |
|---|---|---|---|---|
| `agent-accessibility-tree` | 12 / 15 | +4.0 | [−31.8, +39.5] | 1.000 |
| `cumulative-layout-shift`, CLS = 1.00 versus below | 16 / 11 | +0.3 | [−34.7, +34.7] | 1.000 |
| `llms-txt` | 6 / 21 | **+41.4** | [−0.1, +71.7] | **0.153** |
| `webmcp-registered-tools` | 1 / 26 | *not reportable, see §8* | | |

**Gemini 3.6 Flash (27 sites)**

| audit | split | gap (pts) | 95% CI | family-wise p |
|---|---|---|---|---|
| `agent-accessibility-tree` | 12 / 15 | −9.7 | [−44.5, +25.6] | 0.995 |
| `cumulative-layout-shift`, CLS = 1.00 versus below | 16 / 11 | +16.5 | [−19.3, +50.3] | 0.926 |
| `llms-txt` | 6 / 21 | **+38.1** | [+8.3, +64.3] | **0.225** |
| `webmcp-registered-tools` | 1 / 26 | *not reportable, see §8* | | |

**The CLS row under Lighthouse's own rule.** v1 recorded the audit as passed only at a score of
1.00; Lighthouse shows pass at 0.90. That rule was not registered and is not recomputed into the
family (a second rule chosen after the result was seen would re-run a six-member joint test).
Instead, the alternative-rule sensitivity is pinned as a range over the eight sites whose v1
denominator the arithmetic cannot resolve: for the lite tier the +0.3 becomes a median of −11.0
(−31.3 to +6.7 over the 256 assignments); for 3.6-flash the +16.5 becomes −2.6 (−23.3 to +15.6).
No verdict changes against the 49.0-point critical value.

**How the multiplicity is handled.** Six comparisons were looked at (3 usable flags, 2
published agents), so m = 6 and every p above is corrected across all six by a single-step
Westfall-Young maxT permutation: one shuffle of the site-to-outcome assignment is applied to all
six comparisons at once, and each comparison's p is the share of permutations whose family
*maximum* |gap| reached its observed value. 10,000 permutations, seed 20260819, p = (count +
1) / (used + 1). The family-wise critical value is |gap| = 0.4902: 49 points is what a flag had
to buy. Bonferroni agrees (the llms.txt rows go to 0.348 and 0.485). Uncorrected, those rows are
p = 0.055 and 0.080 by exact enumeration of all C(27, 6) splits, and 0.058 and 0.081 by Monte
Carlo: uncorrected, and 1 of 6, which is the whole reason the correction exists.

The wording follows the family-wise test and nothing else. One marginal interval (3.6-flash,
llms.txt, [+8.3, +64.3]) excludes zero while its family-wise p is 0.225. We publish it rather
than hide it, and note that a percentile bootstrap on that 6-versus-21 split is anti-conservative
here: against a true null built by permuting this cohort's own outcomes it excludes zero 7.4% of
the time at a nominal 5% for 3.6-flash and 6.4% for the lite tier.

## 5. The power bound

This is a *sensitivity power analysis*, not observed power. The family-wise critical value is a
49.0-point gap in site success rate, the gap at which a study of this shape clears the bar half
the time. Eighty percent power needs 66.8 points for the lite tier (SE of the gap at the 6-of-21
split, on a site-rate standard deviation of 0.4552, is 0.2107; 0.4902 + 0.8416 x 0.2107 =
0.6675) and 66.9 for 3.6-flash. The largest gap the estimator can arithmetically return on a
6-of-27 split at a 51.1% overall rate is 62.9 points (pinning all six passing sites at 100%
forces the other 21 to a 37.1% average; 1.000 − 0.371 = 0.629), and 55.2 for 3.6-flash at
57.0%; the cohort's own `tier == anchor` pseudo-flag hits the lite ceiling exactly. 62.9 is
below 66.8, so an llms.txt-shaped effect could not have been detected here at 80% power however
well the audit worked: 20 of the 27 sites already sit at exactly 0% or 100%, where an effect has
nowhere to go. That is the honest limit of the study, and it is why neither null in this
document is evidence about the audits' predictive validity. It also means further analysis of
these same 27 sites cannot produce a new finding.

## 6. The llms.txt confound

This one generalizes past our cohort, and we would flag it to anyone, including you, who tries to
validate `llms-txt` against real-world outcomes without an experiment.

The predictor is not "ships llms.txt" but "served a spec-conformant llms.txt on 2026-08-19",
which is stricter (§3b) and, in this cohort, very nearly the same variable as the anchor tier.
The six sites whose file passed the audit in v1 are Cloudflare, GitHub, Notion, Shopify, Stripe
and Target. Five are anchors, the modern-SaaS sites the cohort deliberately recruited to do well
on both axes. Exactly one anchor's file did not pass (Twilio, §3b) and exactly one non-anchor's
did (Target). On 2026-09-23 the count at 13.3.0 was 7 passing (Twilio now among them), 2 failing
(ca_dmv, zalando), 1 fetch error (bestbuy) and 18 absent.

- **Permuting the flag within tier**, holding the tier composition of the passing group fixed
  and asking what the file buys *on top of being an anchor*, gives uncorrected p = 1.000 (lite)
  and 0.754 (3.6-flash), against 0.058 and 0.081 unstratified.
- **Inside the anchor tier the gap is not positive**: 0.0 points (lite) and −16.0 (3.6-flash), a
  5-versus-1 split, so a description and not a test, by the same rule that refuses WebMCP.
- **For `gemini-3.6-flash`, `tier == anchor` and the llms.txt flag are numerically identical
  predictors**: the same gap (+38.1), the same interval ([+8.3, +64.3]), the same p. The two site
  sets differ only by swapping Twilio for Target, and both scored 100% for that model, so the
  multiset of (predictor, outcome) pairs is literally the same.

The generalizable point: a conformant llms.txt correlates with organizational sophistication,
which correlates with everything else that makes a site work for an agent. Any observational
validation of this audit will find that association and will not be able to attribute it.
Recruiting non-anchor sites that serve a conformant file, and anchors that do not, is the
sampling change that makes the question answerable; a within-site before/after when a site
ships the file is stronger still.

## 7. The unit-of-analysis exhibit

The single most useful methodological point we can hand to anyone else running this kind of
study, and the reason the *site* is the unit of analysis everywhere above.

Across both models, 51 of 60 trials succeeded on the six sites whose llms.txt passed, against 95
of 210 on the others. Treat the trial as the unit and a pooled two-proportion z test returns
z = 5.45, p = 5.0e-8. The site-level exact permutation p on the same rows is 0.033, a factor of
649,733 from one modelling choice. Five trials on one website are not five independent
websites; a test that assumes they are manufactures an eight-sigma result out of six websites.
It is an easy mistake when a harness naturally emits one row per trial, and it is why our
bootstrap resamples sites and our means are means of site rates.

Related, and stated because anyone who downloads the artifacts will find it: averaging the two
models per site gives an llms.txt gap of +39.8 points, CI [+15.0, +62.6], exact p = 0.033, the
only sub-0.05 number in the analysis. We do not publish it as the result because it averages
away a real disagreement: rank correlation between the two models across these 27 sites is
0.59, and six sites move by 60 points or more, in both directions.

## 8. WebMCP: the column measured the browser

The first version of this document reported "1 of 28 sites passes `webmcp-registered-tools`" as
an adoption number and offered it as one of three things worth your time. It is withdrawn. No
adoption count is published from that column, and the reason is version-scoped.

At 13.3.0, the version v1 ran, `webmcp-registered-tools` is informative and returns `score: 1`
on every path where the WebMCP API is exposed; it is `notApplicable` when the Chrome that ran
Lighthouse exposes no `navigator.modelContext`. v1's flag recorded `score === 1`, so its 27 zeros
and one 1 are two states of the instrument, not a property of 27 sites and Target. On 2026-09-23,
under Chromium 151, which exposes the API, the three WebMCP audits applied on 28 of 28 sites and
`webmcp-registered-tools` scored 1 on all 28, with a registered tool listed on one (Target) and
zero tools on the other 27. "Did not apply" was the browser's state, and "applied, score 1" is
the browser's state too.

At 13.3.0 the support check also read `navigator.modelContext` while the specification and
Target's shipped bundle use `document.modelContext`; 13.4.1 and 13.5.0 check both
(`core/audits/agentic/webmcp.js:137-139` at `v13.5.0`), so that half is closed and we say so.
What remains at 13.5.0 is readability: `webmcp-registered-tools` carries the same `score: 1` for
a page with fifty tools and a page with none unless the reader opens its details table, and
`webmcp-form-coverage` passes as binary only when every form on a page is annotated (no cohort
page does), so no cohort fraction moves through either audit unless a site annotates forms.

Why no gap is reported for it: at 1 of 27 the comparison is unfalsifiable, not merely
unresolved. With a single "passing" site the exact permutation null has 27 points and this
cohort's outcomes are bimodal, so the smallest p any single-site split could have produced is
0.333 (lite) and 0.296 (3.6-flash); no outcome could have been significant. An ungated
percentile bootstrap on that 1-versus-26 split returns intervals that exclude zero, [−70.0,
−35.4] for the lite tier and [+27.2, +62.5] for 3.6-flash, in opposite directions off one site,
with 3,679 of 10,000 resamples discarded for drawing no passing site; against a true null it
excludes zero about 90% of the time. Our estimator refuses splits with fewer than 3 sites on
either side for exactly this reason.

## 9. Three questions

Questions, not verdicts, and re-based on 13.5.0, the version current on the day this is filed.

1. A clean 404 at `/llms.txt` makes the audit `notApplicable` and drops it from the category's
   denominator (13.3.0 `llms-txt.js:76-81`; 13.5.0 `:90-95`; `scoring.js:64-67` at both), while
   a soft-404 (`200 text/html`) is scored 0 and kept (13.5.0 `:101-118`). At 13.5.0 `ard-schema`
   has the same shape (`ard-schema.js:64-83`): no discovery signal and no 200 is `notApplicable`;
   a signalled catalog that fails to load, or a body that fails validation, scores 0 and stays.
   Six cohort sites showed the llms.txt half in v1 (spotify, tx_dmv, ssa and portland at 100;
   ca_dmv and zalando at 67), and two showed the `ard-schema` half on 2026-09-23 (github 99 to
   74; zalando 67 to 50). Is it intended that the better-configured server scores higher on a
   file neither has, and that publishing a broken or non-conforming file can lower a site's
   fraction relative to publishing none?
2. The audit parses whatever `/llms.txt` returns with a 2xx as Markdown, with no content-type
   check (13.3.0 `llms-txt.js:83-89`; unchanged at 13.5.0, `:95-108`); dmv.ca.gov and
   zalando.com serve their HTML shell there. Is a `text/markdown` or `text/plain` check in
   scope?
3. `webmcp-registered-tools` is informative and returns `score: 1` on every path where the API
   is exposed (13.3.0 `:57-62, 135-143`; 13.5.0 `:66-70, 144-148, 155-159`), so the report
   carries the same value for a page with fifty tools and one with none unless the reader opens
   `details`. Is `notApplicable` versus `informative` meant to carry the applicability signal,
   and should it be readable without the details table?

And one thing we would rather ask than assume: do you have internal validation we could compare
against, any behavioral data behind the category's composition, or a task set you consider
representative? If a v2 is worth doing, a pre-registered design with your input on cohort
construction, which sites and which audit cells to fill, would be a stronger test than anything
we can build alone.

## 10. Reproducibility, honestly scoped

Every published statistic is computed twice, in TypeScript (`lib/stats.ts`, `lib/sub-audits.ts`)
and in pure-stdlib Python (`scripts/stats_reference.py`), and pinned in a committed vector file
(`scripts/tests/stats-vectors.json`) that both must reproduce, so a disagreement between the two
languages fails the test suite rather than shipping. Both are seeded (20260819) and
deterministic: the intervals and p-values above reproduce exactly. Since 2026-09-23 the vector
file is also tested from the Python side, and the numerals in every METHODOLOGY amendment are
checked against it and the committed artifacts by a test.

That contract covers **the statistics**. It did not cover Lane 1's extraction of the x-axis,
which is where the `score === null` conflation and the unregistered CLS rule lived, with no
fixture and no test. As of 2026-09-23 Lane 1 has three committed fixture reports
(`scripts/tests/fixtures/lhr-twilio-13.3.0.json`, `lhr-example-13.3.0.json`,
`lhr-twilio-13.5.0.json`) and an extraction test (`scripts/tests/lane1-extract.test.ts`), and
the reconstruction of v1's flags from the retained reports is itself tested
(`scripts/tests/reconstruction.test.ts`). That is a gap this document closed, not a feature it
started with.

## 11. Links, and how to check any of this

**Live pages**

- Leaderboard and the finding cards: <https://agent-score-weld.vercel.app>
- The Goodhart pair, as a finding: <https://agent-score-weld.vercel.app/finding/goodhart>; the
  full exhibit with every transcript: <https://agent-score-weld.vercel.app/correlation/exhibit>
- The correlation, scatter and interval: <https://agent-score-weld.vercel.app/correlation>
- The sub-audit analysis with the power section, the confound test and every uncorrected p:
  <https://agent-score-weld.vercel.app/correlation/audits>
- Methodology and contact: <https://agent-score-weld.vercel.app/methodology>
- The dataset and its citation: <https://agent-score-weld.vercel.app/data>, machine-readable at
  <https://agent-score-weld.vercel.app/data/v1.json>

**Repository**: <https://github.com/Jamesoc710/Agent-score>. Dataset release: tag `dataset-v1`;
the Zenodo DOI is minted from that release and recorded on `/data` when it exists.

| what | where |
|---|---|
| Pre-registration record, with the amendment of 2026-09-23 | [`docs/METHODOLOGY.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/METHODOLOGY.md) |
| The Goodhart pair's own record | [`docs/EXHIBIT.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/EXHIBIT.md) |
| The frozen answer key, one row per site | [`data/cohort.csv`](https://github.com/Jamesoc710/Agent-score/blob/main/data/cohort.csv), git tag `answer-key-v3` |
| Per-site answer pages and rationale | [`docs/COHORT.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/COHORT.md) |
| Raw trial artifacts, 280 rows, full transcripts | [`data/agent-runs-v1.jsonl`](https://github.com/Jamesoc710/Agent-score/blob/main/data/agent-runs-v1.jsonl) |
| The v1 Lighthouse batch, 28 rows | [`data/lighthouse-v1.json`](https://github.com/Jamesoc710/Agent-score/blob/main/data/lighthouse-v1.json) |
| The 2026-09-23 re-measurement: typed rows, panel extracts, per-audit extracts, llms.txt sidecars | `data/lighthouse-lh-v2-20260923*.json` |
| Every raw Lighthouse report from 2026-09-23 (28 sites, 3 repeats, 4 batches) | `data/lhr/lh-v2-20260923*/` |
| The reconstruction of v1's flags | [`data/lhr/lh-v2-20260923/reconstruction.json`](https://github.com/Jamesoc710/Agent-score/blob/main/data/lhr/lh-v2-20260923/reconstruction.json) |
| Batch manifests, environment records and health cards | `data/manifest-lh-v2-20260923*.json`, `data/env-lh-v2-20260923*.txt`, `data/health-lh-v2-20260923*.json` |
| The same-day scanner panel (ora.ai, Cloudflare), raw responses | `data/scanners-20260923.json` |
| The frozen agent loop | [`scripts/lane2-agent.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/lane2-agent.py), [`scripts/agent_task.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/agent_task.py) |
| The Lighthouse runner, the batch launcher and the extraction module | [`scripts/lane1-lighthouse.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/lane1-lighthouse.ts), [`scripts/run-batch.sh`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/run-batch.sh), [`scripts/lane1-extract.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/lane1-extract.ts) |
| Scoring contract implementation | [`scripts/scoring.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/scoring.py) |
| Statistics, TypeScript | [`lib/stats.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/lib/stats.ts), [`lib/sub-audits.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/lib/sub-audits.ts) |
| Statistics, independent Python mirror | [`scripts/stats_reference.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/stats_reference.py) |
| The two-language contract: values both implementations must produce | [`scripts/tests/stats-vectors.json`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/tests/stats-vectors.json) |
| The instrument control's protocol (registered 2026-09-23, not yet run) | `docs/METHODOLOGY.md`, the amendment of 2026-09-23, "the instrument control" |

Corrections are welcome. The first version of this document contained several, all in how we
read your output rather than in our arithmetic, and they are in the revision history rather
than quietly removed. What comes next is stated by what has literally landed: the instrument
control is registered on 2026-09-23 and has not run; a test-retest of the identical agent and a
cross-vendor replication are designed, and each is registered before its run; the first run is
scheduled after the review that follows publication, and none has a date. Nothing here promises
a result.
