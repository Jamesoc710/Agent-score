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
