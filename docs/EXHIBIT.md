# The Goodhart exhibit

This is the pre-registration record for an **authored demonstration**, not for a measurement
of any real website. It is the exhibit's counterpart to `docs/METHODOLOGY.md`, and it follows
the same rule: the question, the answer key and the match rule below were fixed and committed
before any published trial ran. Treat it as append-only. `docs/METHODOLOGY.md` itself is
untouched by this work.

## Why it exists

v1 produced two null results. The Lighthouse Agentic Browsing composite score showed no
relationship with agent task success that a 27-site cohort could distinguish from noise, and
no individual sub-audit did either. The accompanying power analysis showed that this cohort
could not have detected the effect it was built to look for, so neither null is evidence
against the rubric.

Those nulls say "we could not detect a relationship". The exhibit is the constructive
counterpart: a page that scores at the top of the static audit and reliably defeats the
frozen agent, by construction. One demonstrated counterexample is a different kind of
statement from a null, and it does not depend on the cohort's power.

## What it claims, and what it does not

**It claims:** a page can score 100 on the Lighthouse Agentic Browsing category and still
defeat AgentRank's frozen agent on a task a person completes in seconds, and the property
that decides the outcome is invisible to the audit.

**It does not claim:**

- that the audit is gameable in general. One authored page is n = 1. It shows the two
  measures can be made to come apart; it does not measure how often they do.
- that the audit is wrong. Every audit in the category passed on both pages, correctly. The
  point is that passing them is not sufficient for the behavioral outcome.
- anything about any real website. The pages are authored, obviously synthetic, and labelled
  as such on their face.
- that a different agent would fail. The claim is scoped to the agent that produced v1's
  y-axis, which is the whole reason it is run through the identical frozen loop.

## The pair

Two pages, `public/exhibit/pair-a.html` and `public/exhibit/pair-b.html`. A 40-row reference
table of sensor modules, in a fixed-height scroll container showing the first 12 rows. Same
question, same registered answer, same 40 rows, same styling, same copy.

`diff public/exhibit/pair-a.html public/exhibit/pair-b.html` is the specification of the
mechanism. Everything above the line marked `// MECHANISM` is byte-identical, which
`scripts/tests/test_exhibit.py` asserts. The pages differ only in the render function:

- **Exhibit A (control)** places all 40 rows in the document. The rows below the visible
  window are present but clipped by the scroll container.
- **Exhibit B (gated)** places only the rows inside the visible window in the document, with
  two zero-content spacer rows reserving the height of the rest. This is ordinary list
  virtualization, the same technique behind essentially every large data grid on the web.

The consequence, measured with the same capture the harness uses (`scripts/lane2-agent.py`
takes a screenshot and `document.body.innerText`):

| | Exhibit A | Exhibit B |
|---|---|---|
| Rendered at 1280x800 on load | identical PNG | identical PNG |
| Lighthouse Agentic Browsing | 100 | 100 |
| Data rows in the document at load | 40 | 16 |
| Target row in `document.body.innerText` | yes | no |
| Target row reachable by `window.scrollBy` | not needed | no |
| Target row reachable by a person | yes | yes, scroll the container |

The load screenshots are byte-identical, so the two pages are not merely similar, they are
visually the same page. Captured with the harness's own settings (headless Chromium, 1280x800,
the same user agent), both PNGs hash to `8870b70d7d59599242e969d113b356c7`; the check is one
`page.screenshot()` per page and an `md5`. The target row on Exhibit B is not off-screen. It
is absent: not in the DOM, not in the accessibility tree, not in the text, not in the pixels.

### The one asymmetry, stated plainly

Both pages carry the full 40-row dataset inline, in a `<script type="application/json">`
block, so the answer is in the bytes of both responses. That is deliberate. Fetching the rows
from an API, which is what a production grid usually does, would have removed them from
Exhibit B's response entirely and made the exhibit look stronger, but it would also have
introduced a timing difference between the two pages and a way for the control to fail for a
reason unrelated to the mechanism. Inlining keeps the pair byte-comparable and the render
synchronous.

What the exhibit therefore demonstrates is precise: the target row is absent from the
**rendered document**, which is the surface every browser agent reads. It is not a claim that
the bytes are unobtainable.

## The registered answer

| field | value |
|---|---|
| question | What is the reference code for sensor module SM-133 in the module reference table? |
| answer_substring | `PAB-2493-PT` |
| match_rule | `exact; case/space-normalize` |
| rows | `data/exhibit-cohort.csv` (`exhibit_a`, `exhibit_b`) |
| receipt | git tag `exhibit-key-v1` |

The code is drawn from a set with no pattern, is unique on the page, and appears nowhere in
the page's prose, so it cannot be inferred, extrapolated or guessed from what Exhibit B
renders. `scripts/tests/test_exhibit.py` pins that the prompt never leaks it, on the same
terms as the cohort's leakage test.

Both rows carry `tier = off_diagonal`, which `docs/METHODOLOGY.md` defines as sites picked to
disagree with the rubric. That is the closest existing value and it is accurate, but the
authored status is carried explicitly in `name`, `flag` and `answer_note`, and the exhibit is
never a cohort site. No tier was added, because `SiteTier` in `lib/types.ts` is the frozen
data contract.

## How it is measured

The **frozen loop, unchanged**. `scripts/lane2-agent.py`, `scripts/scoring.py` and
`data/cohort.csv` are untouched by this work. The lanes read the exhibit's rows through the
`AGENTRANK_COHORT_CSV` environment variable, which selects the row set and nothing else; with
it unset both readers still resolve `data/cohort.csv`, and a test pins that.

```
npm run build && npx next start -p 3100          # serve the pages
AGENTRANK_COHORT_CSV=data/exhibit-cohort.csv npx tsx scripts/lane1-lighthouse.ts --batch goodhart
AGENTRANK_COHORT_CSV=data/exhibit-cohort.csv .venv/bin/python scripts/lane2-agent.py \
    --batch goodhart --trials 5 --model gemini-3.5-flash-lite
AGENTRANK_COHORT_CSV=data/exhibit-cohort.csv .venv/bin/python scripts/lane2-agent.py \
    --batch goodhart --trials 5 --model gemini-3.6-flash
```

Same trial protocol as the cohort: 5 trials per page per agent, both agents of the v1 panel,
the same 15-step and 90-second caps, the same scorer.

### Why the run is served locally

The pages need to be reachable by the Lighthouse CLI and by the harness. This project's
Vercel deployment protects every URL except the production alias, and reaching production
means merging to `main`, which deploys. So the published run is served from the repository's
own production build on `127.0.0.1:3100`, at the commit tagged `exhibit-key-v1`.

That is more reproducible than a hosted URL, not less: the pages are committed, the commit is
tagged, and anyone can serve the identical bytes with the two commands above and re-run both
lanes. When this branch is merged the same files are served at `/exhibit/pair-a.html` and
`/exhibit/pair-b.html` on the public site, and the run can be repeated against that origin as
a confirmation batch.

## The measured result (appended 2026-08-30, after the run)

Registration was commit `7a4ae51`, tagged `exhibit-key-v1`. The run followed it. Nothing in the
pages or the key changed in between, and nothing changed after.

**Lane 1**, batch `goodhart`: both pages `lh_total = 100`, with identical sub-audits
(`agent-accessibility-tree` pass, `cumulative-layout-shift` pass; the `llms-txt` and three
`webmcp` audits report `notApplicable` and are reweighted out). Lane 1's x-axis spread check
prints its "BORING BLOB, spread 0pts" warning, which is a cohort-design gate and is precisely
the intent here: a matched pair is supposed to have no spread on the static axis.

**Lane 2**, batch `goodhart`, 20 trials, zero harness errors, every trial reached its page:

| agent | page | success | recorded mode | steps | seconds |
|---|---|---|---|---|---|
| `gemini-3.5-flash-lite` | Exhibit A | 5/5 | success | 1 | 0 to 1 |
| `gemini-3.5-flash-lite` | Exhibit B | 0/5 | navigation_stuck | 15 | 19 to 21 |
| `gemini-3.6-flash` | Exhibit A | 5/5 | success | 1 | 1 to 2 |
| `gemini-3.6-flash` | Exhibit B | 0/5 | navigation_stuck | 15 | 27 to 29 |

All ten Exhibit A trials reported `PAB-2493-PT` on their first step. All ten Exhibit B trials
spent the entire 15-step budget emitting `scroll`, each step reasoning that SM-133 was not
visible yet. One transcript states the mechanism in the agent's own words at step 2: "Need to
find sensor module SM-133 in the table, which is currently showing up to SM-116." SM-116 is the
sixteenth row, which is exactly where the mounted window ends.

Every trial and its transcript is at `/correlation/exhibit`, and in
`data/agent-runs-goodhart.jsonl`.

## Isolation from the cohort

The exhibit must not move a single published number about the 28 sites. It is kept out by
construction, not by filtering:

- Its rows are in `data/exhibit-cohort.csv`. `data/cohort.csv` is unchanged.
- Its results are in `data/lighthouse-goodhart.json` and `data/agent-runs-goodhart.jsonl`,
  under `batch_label = "goodhart"`. Batch `v1` is unchanged.
- **Nothing is imported into Supabase.** `scripts/import-results.ts` is never run for this
  batch. `lib/queries.ts` reads `sites` with `select("*")`, so a row in `sites` would appear
  on the leaderboard; the exhibit therefore never enters the database at all. The published
  page reads the committed artifacts instead, through `lib/exhibit.ts`.
- Every cohort statistic the site publishes is recomputed at read time from
  `data/agent-runs-v1.jsonl` and `data/lighthouse-v1.json` via `lib/stats.ts`, and pinned by
  `scripts/tests/stats-vectors.json`. Those three files are untouched, so the cohort numbers
  are unchanged by construction and the existing suites prove it.

## Objections

**"Your agent just cannot scroll a div."** True, and it is the reason the pair exists rather
than a single page. The agent's scroll action is `window.scrollBy`, which moves the window and
not an inner scroll container. But the stronger fact is about the page, not the verb set: on
Exhibit B the target row is not in the document at all, so an agent that read the entire DOM
or the entire accessibility tree would also come away without it. It would have to drive the
container's scroll position first.

**"You built a page to beat your own agent."** Yes. That is what a counterexample is. The
discipline that makes it worth anything is that the answer was registered and committed
before the published run, the loop was not modified, both halves of the pair were run under
identical conditions, and the control had to succeed for the result to mean anything. If the
control had failed, the exhibit would have proved nothing and that is what would have been
reported.

**"It scores 100 because two audits do not apply to it."** The `llms-txt` and three `webmcp`
audits report `notApplicable` on these pages and are reweighted out, leaving
`agent-accessibility-tree` and `cumulative-layout-shift`. That is the same route by which
four real cohort sites score 100 in v1: `spotify`, `tx_dmv`, `ssa` and `portland` all score
100 with neither llms.txt nor WebMCP. The exhibit earns its score exactly the way they earn
theirs.

**"A real site would not do this."** Real sites do it constantly. Virtualized rendering is
the standard solution to long lists, and it is why an agent that can read a page perfectly
can still fail to find a row in a data grid.
