# AgentRank — product

## Thesis

Agents are becoming a real traffic source on a web built for human clicks. A growing pile of
tools now scores websites for "agent readiness" — but every one of them is a static scanner:
it inspects structure and predicts. None of them runs a real agent through a real task and
measures whether it succeeds. And the benchmarks that do run real agents (WebArena, TAU-bench,
OSWorld) hold the website constant to score the *agent*.

AgentRank inverts the benchmark: **hold the agent constant, vary the website, and score the
site by measured task success.** Then plot measured success against the static readiness score
everyone else sells. That correlation — does the rubric actually predict real agent behavior —
is the result nobody has published, and Google explicitly declined to produce it when they
shipped the Lighthouse Agentic Browsing audit.

The defensible one-liner: *there are half a dozen tools that score your site for
agent-readiness, and a whole field of benchmarks that score agents on fixed sites. Nobody has
scored sites by measured agent success, or checked whether the readiness scores predict it.*

## Market landscape

**Static agent-readiness scanners** (they predict, never measure):
- Google Lighthouse Agentic Browsing (13.3+): accessibility-tree quality, layout stability,
  llms.txt, WebMCP. Pass/fail per audit; no ranking, no validation. This is our x-axis.
- Cloudflare Agent Readiness Score (isitagentready.com): the recognizable incumbent; four
  static dimensions plus remediation prompts.
- AgentScore, GEO Metrics, Fern agent-score and similar: smaller static scanners, same shape.

Their own critics make our case: the most-shared analyses warn these scores are Goodhart-able —
a site can ship a WebMCP stub that does nothing, pass the check, and change nothing for real
agents. The gap between "passes the rubric" and "an agent can actually use it" is exactly what
we measure. We don't compete with these tools; their score is one axis of our chart.

**Agent benchmarks** (they measure, but score the agent): WebArena, TAU-bench, OSWorld. Fixed
site or replica, varying models, output is a leaderboard of agents. Our unit of analysis is the
site. The one-sentence answer to "isn't this WebArena?": *WebArena scores agents on a fixed
site; we score sites with a fixed agent.*

## The product ladder

Each rung funds credibility for the next. We are on rung 1.

1. **The leaderboard (credibility asset).** Public ranking of 28 named sites by measured agent
   success, with the Lighthouse correlation and per-site failure breakdowns. This is the proof
   that the measurement works and the demo that opens doors.
2. **The scan report (the wedge product).** "Run AgentRank on your site": Lighthouse score
   instantly, then a real agent attempting a real task on your pages, with a step-by-step
   transcript of exactly where it got lost. Static tools tell you "consider improving
   accessibility"; we show "the agent got stuck on this consent wall at step 4."
3. **Competitor comparison.** Your scores next to your named competitors'. Loss aversion is the
   sales motion: agents are choosing where to complete tasks, and sites that fail get skipped.
4. **Remediation + monitoring.** Fix recommendations grounded in observed failures, then
   scheduled re-runs and a CI check (Lighthouse-CI ergonomics, but the metric is behavioral).
5. **The benchmark flywheel.** Submit-your-site, a behavior-earned "Agent-Ready: measured"
   badge with public transcript as proof, longitudinal re-scoring. A benchmark becomes
   canonical when sites want to be measured.

## The pitch (working draft)

> "AI agents are already visiting your site to buy, book, and look things up for their users.
> Static checkers can tell you whether your site has the right markup. We send a real agent to
> do a real task on your site and show you, step by step, where it succeeds, where it gets
> stuck, and how you compare to your competitors. Agent traffic only grows from here; every
> failed task is a customer someone else's site serves."

**Discipline note:** the "here's how much business you're losing" number is the strongest
version of this pitch and we do not get to say it yet. It requires defensible inputs (the
site's agent-traffic share, task-failure rate, conversion value) we don't have. Until then the
honest form is "here's exactly where agents fail on your site, and agent traffic is growing."
Quantified loss estimates are a roadmap item gated on real data, not a launch claim.

## Who buys

- E-commerce and DTC (agents complete purchases; a blocked agent is a lost sale)
- SaaS with self-serve pricing/signup (agents comparison-shop)
- Booking and ticketing (high-intent agent tasks, heavy anti-bot tension)
- Government and public services (mandated accessibility overlaps with agent readiness;
  procurement buys reports)

The anti-bot tension is a real product insight, not a bug: sites currently treat agents as
adversaries. The intentional-blocker cohort sites (Amazon, Ticketmaster) exist to measure that
posture, and "your anti-bot stack is turning away your customers' agents" is its own finding.
