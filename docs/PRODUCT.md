# AgentRank: product

## Position

AgentRank is the fixed, dated, pre-registered behavioral measuring stick that the agent-readiness
rubrics are checked against. It is the only agent-readiness measurement that publishes a
site-level success rate with a denominator (the correlation carries an interval today; a
per-site interval is designed for a later edition and promised to no date), a frozen agent, an
answer key registered before any run, statistics computed twice in two languages, and a
willingness to publish a null about the rubric it tests. It sells no score and no scan.
"Validator of the scanners" is not a finishable sentence because the leading rubric revises its
checks whenever behavior changes; "the measuring stick the rubrics move against" is.

**What is unowned, as read on 2026-09-08 and re-checked on 2026-09-22:** a site-level behavioral
rate with a denominator, an interval and a pre-registered key. Three vendors run agents (Ora's
Deep Scan, Agent Checker, AgentReady's published run set); none publishes task success per site.
The three static scanners that can be fetched for the same 28 sites (Lighthouse, ora.ai,
Cloudflare) appeared to disagree with each other on a single day's exploratory read, every
pairwise interval containing zero; that read was not pre-registered. The same-day scanner
columns were fetched on 2026-09-23 beside a dated Lighthouse batch, and the declared agreement
test is published only once its vectors are pinned in both languages. The argument "static
scores are not behavior" has been made before (Agent Checker, April 2026); the evidence standard
is what is unowned.

The one-liner: *there are half a dozen tools that score your site for agent-readiness, and a
whole field of benchmarks that score agents on fixed sites. Nobody publishes a per-site rate of
measured agent success against a pre-registered key, or checks the readiness scores against
it.*

## Market landscape

**Static agent-readiness scanners** (they predict, never measure):

- Google Lighthouse, the Agentic Browsing category: six audits at 13.3.0, the version v1 ran
  (accessibility-tree quality, layout shift, llms.txt, three WebMCP audits); seven at 13.5.0,
  with an ARD catalog audit added. Chrome's own scoring documentation describes the category as
  experimental and gives it no 0-100 score; Chrome displays a fraction of applicable checks, and
  the mean the CLI also emits is what v1 read as a score. This is our x-axis, relabelled the
  category mean everywhere.
- Cloudflare Agent Readiness Score (isitagentready.com): the recognizable incumbent; five
  static dimensions plus remediation prompts, and a level from 0 to 5, as read from a single
  fetch on 2026-09-08.
- ora.ai and the smaller static scanners (AgentScore, GEO Metrics, Fern agent-score and
  similar): the same shape, different checks.

**Vendors that run an agent** (Ora's Deep Scan, Agent Checker, AgentReady): they run one, but
none publishes a per-site task-success rate with a denominator and a registered key.

Their own critics make the case for a behavioral check: the most-shared analyses warn that
static scores can be satisfied without changing anything for a real agent. Our authored Goodhart
pair shows the two measures coming apart on one page (`docs/EXHIBIT.md`): every audit in the
category passed, honestly, on a page the frozen agent could not use. That is one counterexample,
not a rate. We do not compete with the scanners; their score is one axis of our chart.

**Agent benchmarks** (they measure, but score the agent): WebArena, TAU-bench, OSWorld. Fixed
site or replica, varying models, output is a leaderboard of agents. Our unit of analysis is the
site. The one-sentence answer to "isn't this WebArena?": *WebArena scores agents on a fixed
site; we score sites with a fixed agent.*

## What this project ships, and what it leaves to others

1. **The measurement and its publication.** 28 named sites, one fixed agent, one fixed task
   shape, answers registered before any run, every transcript published, every statistic
   computed twice, the Lighthouse correlation with its interval and its power bound, and the
   authored counterexample. This is what exists, and it is the only rung.
2. **A scan-your-site report** (a Lighthouse number plus a real agent attempt with a
   transcript): sold by others; out of scope by decision.
3. **Competitor comparison**: sold by others; out of scope by decision.
4. **Remediation, monitoring and a behavioral CI check**: sold by others; out of scope by
   decision.
5. **A badge or registry** ("Agent-Ready: measured", submit-your-site): out of scope by
   decision. The niche is taken, and operating a registry is the treadmill that stopped the
   Web Almanac.

A site owner who wants their site measured can ask through the repository's Issue Form. The
request is answered and counted; no site is added while cohort expansion is out of scope, and
nothing is sold.

## Who this is for

The buyer is the people whose scores this checks: the maintainers of the rubrics, and the people
who rely on those rubrics (agent builders, researchers, site owners deciding whether a score
means anything). The product is the measurement, the data and the corrections, in the open. The
anti-bot tension the cohort surfaces is a finding, not a pitch: the intentional-blocker sites
(Amazon, Ticketmaster) exist to measure that posture, and the identity posture this project
declares for its own agent is registered in `docs/METHODOLOGY.md`.

**Discipline note.** The "here is how much business you are losing" number is the strongest
sentence anyone could write about agent failures and this project does not get to write it. It
needs a site's agent-traffic share, a task-failure rate and a conversion value, none of which
this project measures. A quantified-loss model is out of scope by decision, not a launch claim
deferred.

## The fixed measuring stick

The leading rubric revises its checks whenever agent behavior changes: the Lighthouse category
changed twice in the five weeks after v1 ran, and the scanners re-weight their checks on their
own schedules. A validator of those rubrics would have to chase them. A fixed, dated,
pre-registered behavioral measurement does not: it stays where it was put, with its date, its
denominator and its interval, and the rubrics move against it. That is what AgentRank is for.
