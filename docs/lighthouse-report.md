# An external behavioral check on the Lighthouse Agentic Browsing score

**AgentRank v1 — 28 sites, 280 agent trials, run 19 August 2026.**
Prepared for the Lighthouse / Chrome team. Written by James (`Jamesoc710/Agent-score`).

We ran a fixed browser agent on 28 real websites and correlated its measured task-completion
rate against each site's Lighthouse Agentic Browsing category score, collected with the
unmodified Lighthouse 13.3.0 CLI. Everything below is reproducible from committed artifacts;
links are in [§10](#10-links-and-how-to-check-any-of-this).

**Two null results, and one number that matters more than either of them.**

- The composite Agentic Browsing score showed **no relationship with behavioral success that
  this cohort could distinguish from noise** — Spearman ρ = 0.11, 95% CI [−0.29, +0.48], n = 27.
- **No individual sub-audit did either** — six comparisons, family-wise p from 0.153 to 1.000
  under a Westfall–Young maxT correction.
- **And the study could not have detected an llms.txt-shaped effect even if one existed.** The
  family-wise critical value is a 49-point success-rate gap; 80% power needs 67 points; and the
  largest gap this cohort can *arithmetically* produce on a 6-of-27 split is 62.9. That bound is
  the most useful thing in this document and it is why neither null is evidence against your
  rubric.

The three things we think are worth your time, in order: **the power bound** ([§5](#5-what-this-cohort-could-have-detected--the-real-result)),
**the llms.txt / cohort-design confound** ([§6](#6-the-llmstxt-confound-a-warning-for-anyone-validating-this-observationally))
that will hit any observational validation of that audit and not just ours, and **the WebMCP
adoption datum** ([§8](#8-webmcp-the-audit-id-is-live-and-adoption-is-1-of-28)) — 1 of 28 major
sites passes `webmcp-registered-tools`.

---

## 1. What we are not claiming

Stated first, because it constrains everything after it.

- **This is not evidence that the Agentic Browsing score does not work.** A study that cannot
  reach the effect size it is looking for has not measured an absence. See §5.
- **One task shape.** Navigate from a start URL and report one pre-registered fact. Nothing
  about forms, checkout, authentication, multi-page workflows, or agent-initiated actions.
- **One harness.** One prompt template, one browser loop, fixed step and time budgets. A more
  capable scaffold would move every y-value and could easily change the ranking.
- **Two models from one family.** `gemini-3.5-flash-lite` and `gemini-3.6-flash`. Both cheap
  tiers, deliberately — production agent traffic runs cheap models — but Gemini only.
- **28 sites, one run window.** No longitudinal data, no within-site before/after.
- **The sub-audit analysis (§4 onward) is exploratory and was not pre-registered.** The task,
  answer keys, match rules and trial protocol were. The per-audit comparison was not. It is a
  set of comparisons with intervals, and its honest use is to size the study that would test it.

The composite score may well predict things this study did not measure. We measured one thing.

## 2. What was measured, and how

Enough detail to replicate. Full spec: [`docs/METHODOLOGY.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/METHODOLOGY.md)
(pre-registration record, append-only) and [`docs/COHORT.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/COHORT.md).

**Cohort — 28 sites, biased on purpose.** [`data/cohort.csv`](https://github.com/Jamesoc710/Agent-score/blob/main/data/cohort.csv)
is canonical: 6 modern-SaaS *anchors* expected to score well on both axes, 8
government/transit/university pages seeded to trap agents, 5 middle retail sites, 4 small
businesses, 3 *off-diagonal bets* picked to disagree with the rubric (Apple, Zalando: high
static, expected low behavioral; Craigslist: the reverse), and 2 *intentional blockers* (Amazon,
Ticketmaster) where anti-bot posture is itself the finding. The documented bias rule was
**"prefer sites that spread the static axis"** — which, as §6 shows, is exactly what made the
llms.txt comparison unanswerable.

**Static axis — Lighthouse, unmodified.** `npx lighthouse <url> --output=json --quiet
--only-categories=agentic-browsing --chrome-flags='--headless --no-sandbox --disable-gpu'`,
one run per site, `lighthouse@13.3.0` (from the committed `package-lock.json`).
`lh_total = Math.round(categories["agentic-browsing"].score * 100)`. A sub-audit is recorded as
a pass only on `score === 1`: `agent-accessibility-tree`, `cumulative-layout-shift`,
`llms-txt`, `webmcp-registered-tools`. We reimplement no audits.
*Honesty gap:* the batch artifact records no `lighthouseVersion` field, so the version above
comes from the lockfile and a source comment rather than from the LHR itself. Fixing that is a
one-line change we cannot make without forking the frozen dataset.

**Behavioral axis — one frozen loop.** Playwright + Gemini, screenshot and page text per step.
Frozen 2026-08-09 and unchanged since; any change forks the dataset under a new `agent_id`.
Max 15 steps, hard 90-second wall clock, `temperature = 0`, `max_output_tokens = 512`, JSON
response mode, 8,000 characters of page text per step, up to 3 attempts per model call with
exponential backoff on transient failures (backoff time excluded from the trial clock, so an
API blip cannot become a `timeout` verdict against the site). The prompt is one
template parameterized only by the site's `question`; a test proves no registered answer can
appear in it.

**Scoring — pre-registered exact match, no post-hoc judgment.** Success = the agent's final
answer contains the site's registered `answer_substring` after a fixed normalization
(case/whitespace, currency stripping, numeric word-boundary so `$20` cannot match `$200`,
thousands-comma and trailing-`.00` handling, `any-of` alternatives, one documented decimal-comma
exception for `zalando.pt`). Implemented once in
[`scripts/scoring.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/scoring.py),
174 tests. Answer keys were written by hand before any run and are git-tagged (`answer-key-v3`).

**Trial protocol.** 5 trials per (site, model); the metric is the site's success *rate*, not a
binary. 28 sites × 5 trials × 2 models = 280 trials, all with full stored transcripts.

**The denominator rule, which decides one site.** Failure modes are a fixed enum; an `error`
trial counts as a **failure** — it stays in the denominator — *unless the run never reached the
site at all*, in which case it is excluded, because there is no behavioral measurement to score.
In v1: 45 error trials, 35 of them counted as failures. The other 10 are all of **costco**,
whose every trial died at `Page.goto` with `net::ERR_HTTP2_PROTOCOL_ERROR` before the page
loaded. Costco is therefore **excluded, not scored 0%** — inventing a 0% would be inventing a
measurement — which is why every n below is 27 rather than 28. If you disagree: scoring it 0% at
n = 28 moves the pooled llms.txt gap from +39.8 to +41.8 points and its exact p from 0.033 to
0.026, so the exclusion is if anything working against us.

**Run window.** Lighthouse 2026-08-19 16:04–16:12 UTC; agent trials 2026-08-19 16:14–18:53 UTC.

## 3. Result 1 — the composite score

| model | Spearman ρ | 95% CI | n |
|---|---|---|---|
| `gemini-3.5-flash-lite` (headline) | **+0.11** | [−0.29, +0.48] | 27 |
| `gemini-3.6-flash` | −0.02 | [−0.37, +0.33] | 27 |

Overall task success: **51.1%** (69/135 measured trials) for the lite tier, **57.0%** (77/135)
for 3.6-flash. Interval is a 10,000-iteration percentile bootstrap **resampling sites**, seed
20260819.

**No relationship distinguishable from noise at this sample size.** Both intervals span zero
comfortably. That is a statement about what 27 sites can resolve, not about your rubric.

Individual sites illustrate the spread rather than proving anything: `trimet` scores 98 and
`tx_dmv` 100 with 0% success; `powells` scores 3 with 80% and `bear` scores 12 with 100%.
Live scatter: [`/correlation`](https://agent-score-weld.vercel.app/correlation).

## 4. Result 2 — the sub-audit family

Each audit splits the cohort in two, so each can be asked the composite's question directly.
**Estimand:** the difference in mean *site* success rate between passing and failing sites, in
percentage points. Sorted by audit id, never by effect size.

**Gemini 3.5 Flash Lite (27 sites)**

| audit | split | gap (pts) | 95% CI | family-wise p |
|---|---|---|---|---|
| `agent-accessibility-tree` | 12 / 15 | +4.0 | [−31.8, +39.5] | 1.000 |
| `cumulative-layout-shift` | 16 / 11 | +0.3 | [−34.7, +34.7] | 1.000 |
| `llms-txt` | 6 / 21 | **+41.4** | [−0.1, +71.7] | **0.153** |
| `webmcp-registered-tools` | 1 / 26 | *not reportable — see §8* | | |

**Gemini 3.6 Flash (27 sites)**

| audit | split | gap (pts) | 95% CI | family-wise p |
|---|---|---|---|---|
| `agent-accessibility-tree` | 12 / 15 | −9.7 | [−44.5, +25.6] | 0.995 |
| `cumulative-layout-shift` | 16 / 11 | +16.5 | [−19.3, +50.3] | 0.926 |
| `llms-txt` | 6 / 21 | **+38.1** | [+8.3, +64.3] | **0.225** |
| `webmcp-registered-tools` | 1 / 26 | *not reportable — see §8* | | |

**How the multiplicity is handled, rather than asserted.** Six comparisons were looked at
(3 audits with a usable split × 2 published agents), so m = 6 and every p above is corrected
across all six. The correction is a single-step **Westfall–Young maxT permutation**: one shuffle
of the site→outcome assignment is applied to *all six comparisons simultaneously*, and each
comparison's p is the share of permutations whose family *maximum* |gap| reached its observed
value. Applying one shuffle to all members preserves the real correlation between overlapping
audits and between two agents measured on the same 27 sites, instead of assuming independence.
10,000 permutations, seed 20260819, p = (count + 1) / (used + 1) so no p is reported as zero.
The **family-wise critical value is |gap| = 0.4902** — 49 points is what an audit had to buy.

Bonferroni is reported alongside because it is checkable by hand, and it agrees (the llms.txt
rows go to 0.348 and 0.485). Uncorrected, those rows are p = 0.055 / 0.080 by exact enumeration
of all C(27, 6) splits and 0.058 / 0.081 by Monte Carlo — **uncorrected, and 1 of 6**, which is
the whole reason the correction exists.

**The wording follows the family-wise test and nothing else** — not the point estimate, not the
marginal interval. One marginal interval (3.6-flash, llms.txt, [+8.3, +64.3]) does exclude zero
while its family-wise p is 0.225. We publish it rather than hide it, and note that a percentile
bootstrap on that exact 6-vs-21 split is measurably anti-conservative: against a true null built
by permuting this cohort's own outcomes, it excludes zero 7.4% of the time at a nominal 5%.

## 5. What this cohort could have detected — the real result

This is the section we would most like a Lighthouse engineer to read, because it bounds every
claim above and would bound anyone else's replication too.

Three numbers, and the third is the point:

| model | family-wise critical value | gap needed for 80% power | largest gap physically possible | detectable? |
|---|---|---|---|---|
| Gemini 3.5 Flash Lite | +49.0 pts | +66.8 pts | **+62.9 pts** | **no** |
| Gemini 3.6 Flash | +49.0 pts | +66.9 pts | **+55.2 pts** | **no** |

1. **49 points is a *critical value*, not a minimum detectable effect.** It is the gap at which
   a study of this shape clears the family-wise bar half the time. Reporting it as an MDE — as
   our own first draft did — understates a follow-up's sample size by a factor of 1.85.
2. **80% power needs 66.8 points.** SE(gap) at the 6/21 split, on the lite tier's site-rate
   standard deviation of 0.4552, is 0.2107; 0.4902 + 0.8416 × 0.2107 = 0.6675.
3. **The ceiling is 62.9 points, and it is arithmetic rather than statistics.** At 51.1% overall
   success, pinning all six passing sites at 100% forces the remaining 21 down to a 37.1%
   average. 1.000 − 0.371 = 0.629. That is the *largest number the estimator can return* on a
   6-of-27 split at this success rate, whatever the audit does. The cohort's own `tier == anchor`
   pseudo-audit hits it exactly.

**62.9 < 66.8. An llms.txt-shaped audit could not have been detected in this cohort at 80%
power no matter how well it worked.** Not because the effect was small — because a 6-of-27
split at a 51% base rate has nowhere to put an 80%-power effect underneath a 100% ceiling.

We state this plainly rather than in a footnote because it is the honest limit of the study:
**neither null in this report is evidence that the audits do not predict task completion.**
It also means further analysis of these same 27 sites cannot produce a new finding.

## 6. The llms.txt confound: a warning for anyone validating this observationally

This one generalizes past our cohort, and we would flag it to anyone — including you — who
tries to validate `llms-txt` against real-world outcomes without an experiment.

The six sites in this batch that ship llms.txt are **Cloudflare, GitHub, Notion, Shopify,
Stripe, Target**. Five of the six are anchor-tier: the modern-SaaS sites the cohort deliberately
recruited to score well on both axes. There is **exactly one anchor without the file** (Twilio)
and **exactly one non-anchor with it** (Target).

So "ships llms.txt" and "is a well-built modern SaaS site" are very nearly the same variable
here, and we tested that rather than asserting it:

- **Permuting the audit label within tier** — holding the tier composition of the passing group
  fixed, and asking what the file buys *on top of being an anchor* — gives uncorrected
  p = **1.000** (lite) and **0.754** (3.6-flash), against 0.058 and 0.081 unstratified.
- **Inside the anchor tier the gap is not positive**: 0.0 points (lite) and −16.0 (3.6). That is
  a 5-vs-1 split, so it is a description and not a test, by the same rule that refuses WebMCP.
- **For `gemini-3.6-flash`, `tier == anchor` and `lh_llms_txt` are numerically identical
  predictors** — same gap (+38.1), same interval ([+8.3, +64.3]), same p. The two site sets
  differ only by swapping Twilio for Target, and both of those scored 100% for that model, so
  the multiset of (predictor, outcome) pairs is literally the same. For that agent this cohort
  *cannot* tell the file from the tier, because they are one variable.

The generalizable point: llms.txt adoption correlates hard with organizational sophistication,
which correlates with everything else that makes a site work for an agent. Any observational
validation of this audit — ours, yours, or a third party's — will find that association and will
not be able to attribute it. Deliberately recruiting **non-anchor sites that ship llms.txt, and
anchors that do not** is the sampling change that makes the question answerable; a within-site
before/after when a site ships the file is stronger still.

## 7. The unit-of-analysis exhibit

The single most useful methodological point we can hand to anyone else running this kind of
study, and the reason the *site* is the unit of analysis everywhere above.

Across both models, **51 of 60 trials succeeded on the six llms.txt sites, against 95 of 210
without it**. Treat the trial as the unit of analysis and a pooled two-proportion z test
returns:

> **z = 5.45, p = 5.0 × 10⁻⁸**

The correct site-level exact permutation p on the *same rows* is **0.033** — a factor of
**649,733**, from one modelling choice.

Five trials on one website are not five independent websites. A test that assumes they are
manufactures an eight-sigma result out of six websites. This is an easy mistake to make when a
harness naturally emits one row per trial, and it is why our bootstrap resamples sites and our
means are means of site rates.

(Related, and stated because anyone who downloads our artifacts will find it: **averaging the
two models per site** produces an llms.txt gap of +39.8 points, CI [+15.0, +62.6], exact
p = 0.033 — the only sub-0.05 number in the whole analysis. We do not publish it as the result
because it averages away a real disagreement: rank correlation between the two models across
these 27 sites is only 0.59, and six sites move by 60 points or more, in both directions.)

## 8. WebMCP: the audit id is live, and adoption is 1 of 28

Three things here, and we think the first two are useful to you.

**First, an adoption number.** Exactly **1 of the 28 sites passes `webmcp-registered-tools`**
(Target). This is not a statistical claim, it is a count across a cohort that includes Stripe,
Shopify, GitHub, Notion, Cloudflare, Twilio, Apple, Amazon, Target, Best Buy, IKEA and Spotify.

**Second, it resolves an open item on our side that was recorded against you.** Our
`METHODOLOGY.md` flags an all-zero `lh_webmcp` column in an earlier draft batch as *possibly a
broken audit id on our end*. In v1 the column is not all zero — so **the audit id is live and
firing, and near-zero adoption is real-world data about WebMCP uptake rather than a measurement
fault on our side.** We are recording that here rather than leaving a "maybe their audit is
broken" note in a public repository.

**Third, and this is why we report no gap for it: at 1-of-27 the comparison is *unfalsifiable*,
not merely unresolved.** With a single passing site, the exact permutation null has only 27
points, and this cohort's outcomes are bimodal, so the most extreme |gap| is shared by every
site tied at the extreme. The **smallest p any single-site split could have produced** is
**0.333** (lite), **0.296** (3.6-flash), and **0.259** even pooling both models' trials. No
outcome — Target at 0%, at 100%, or any other site in its place — could have been significant.
"Not enough sites" invites "so run more trials on Target"; the accurate statement is that the
question was unanswerable as posed.

It also makes a nice cautionary exhibit. Run an ungated percentile bootstrap on that 1-vs-26
split and it returns intervals that *exclude zero* — [−70.0, −35.4] for the lite tier and
[+27.2, +62.5] for 3.6-flash, in **opposite directions**, off one site — with 3,679 of 10,000
resamples discarded for drawing no passing site at all. Simulated against a true null, that
interval excludes zero about **90%** of the time on that split. Our estimator refuses splits
with fewer than 3 sites on either side for exactly this reason.

## 9. What would settle it

**Sizing a study that could actually answer the question.** Scaling the observed family-wise
critical value as √(1/n₁ + 1/n₀) and adding the power term:

| true gap | audit prevalence | sites at 50% power | **sites at 80% power** |
|---|---|---|---|
| 30 points | balanced (50%) | 50 | **93** |
| 30 points | 22% — v1's llms.txt rate | 73 | **134** |
| 20 points | balanced (50%) | 113 | **208** |
| 20 points | 22% | 163 | **301** |

**And 80% power is a floor, not a target.** That table assumes a normal sampling distribution
and an effect that fully materializes. Simulate instead with this cohort's actual outcome
distribution — site base rates drawn from the measured 27, the audit adding 30 points to a
site's success *probability* capped at 100%, 5 Bernoulli trials per site, 20,000 replicates —
and n = 50 gives **14%** power and n = 93 gives **29%**, not 50% and 80%. The mechanism is the
same ceiling as §5: 20 of 27 sites already sit at exactly 0% or 100%, where 30 extra points have
nowhere to go, so a nominal +30 audit delivers a realized gap averaging **+17.4**.

Two design implications, which we would rather agree on with you than assume:

1. **Stratify the cohort on the sub-audits themselves**, not only on the composite score. Our
   "spread the static axis" rule is precisely what produced a 1-vs-26 WebMCP split and an
   llms.txt split indistinguishable from the anchor tier.
2. **More trials per site does not substitute for more sites** on the between-site question,
   though it would tighten every interval: at 5 trials, a site at a true 50% carries a standard
   error of about 22 points on its own.

**Two questions for you, and they are questions rather than a verdict.**

- **Is the Agentic Browsing category score intended to be predictive of agent task completion
  at all**, or is it a conformance/best-practice rubric whose value is not meant to show up as a
  task-completion correlation? That changes what a null like ours even means, and we would
  rather ask than assume.
- **Do you have internal validation we could compare against** — any behavioral data behind the
  category weighting, or a task set you consider representative?

**The offer.** The cohort, the answer keys, the raw trials with full transcripts, the scorer and
both statistics implementations are public and re-runnable. If a v2 is worth doing, a
**pre-registered** design with your input on cohort construction — which sites, which audit cells
to fill, what task shapes count — would be a substantially stronger test than anything we can
build alone. We would happily run any cohort you consider fair.

## 10. Links, and how to check any of this

**Live pages**

- Leaderboard and headline result — <https://agent-score-weld.vercel.app>
- Composite correlation, scatter and interval — <https://agent-score-weld.vercel.app/correlation>
- **The full sub-audit analysis, with the power section, the confound test, the calibration
  simulations and every uncorrected p** — <https://agent-score-weld.vercel.app/correlation/audits>

**Repository** — <https://github.com/Jamesoc710/Agent-score>

| what | where |
|---|---|
| Pre-registration record (task, scoring contract, trial protocol, cohort design) | [`docs/METHODOLOGY.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/METHODOLOGY.md) |
| The frozen answer key, one row per site | [`data/cohort.csv`](https://github.com/Jamesoc710/Agent-score/blob/main/data/cohort.csv), git tag `answer-key-v3` |
| Per-site answer pages and rationale | [`docs/COHORT.md`](https://github.com/Jamesoc710/Agent-score/blob/main/docs/COHORT.md) |
| Raw trial artifacts — 280 rows, full transcripts | [`data/agent-runs-v1.jsonl`](https://github.com/Jamesoc710/Agent-score/blob/main/data/agent-runs-v1.jsonl) |
| Raw Lighthouse batch — 28 rows | [`data/lighthouse-v1.json`](https://github.com/Jamesoc710/Agent-score/blob/main/data/lighthouse-v1.json) |
| The frozen agent loop | [`scripts/lane2-agent.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/lane2-agent.py), [`scripts/agent_task.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/agent_task.py) |
| The Lighthouse runner | [`scripts/lane1-lighthouse.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/lane1-lighthouse.ts) |
| Scoring contract implementation (174 tests) | [`scripts/scoring.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/scoring.py) |
| Statistics — TypeScript | [`lib/stats.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/lib/stats.ts), [`lib/sub-audits.ts`](https://github.com/Jamesoc710/Agent-score/blob/main/lib/sub-audits.ts) |
| Statistics — independent Python mirror | [`scripts/stats_reference.py`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/stats_reference.py) |
| The two-language contract: values both implementations must produce | [`scripts/tests/stats-vectors.json`](https://github.com/Jamesoc710/Agent-score/blob/main/scripts/tests/stats-vectors.json) |

Every published statistic is computed twice, in TypeScript and in pure-stdlib Python, and pinned
to 12 digits in a committed vector file, so a disagreement between the two languages fails the
test suite rather than shipping. Both are seeded (20260819) and deterministic: the intervals and
p-values above reproduce exactly, not approximately.

Corrections are welcome, and an arithmetic error here would be worth more to us than the result.
