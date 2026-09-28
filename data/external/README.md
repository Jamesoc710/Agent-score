# External audits

Two third-party datasets, re-analysed from their own public files at the unit AgentRank uses for
itself: the site, not the trial. These are not AgentRank measurements. No number here is rendered
on any AgentRank page or enters `lib/stats.ts`; if a page ever quotes one, it enters that contract
first.

`data/LICENSE.md` does not cover this directory. Each subdirectory carries its source's own
licence, named below.

`npm test` re-runs both analyzers from the committed CSVs and fails if any output drifts.

## `agentready/`: AgentReady `traces.csv`

- **Source.** `data/traces.csv` from
  [agentready-org/standard](https://github.com/agentready-org/standard) at commit
  `f52dca9ddd70f061fc79074223ad16b99d8946be`, committed verbatim (143,399 bytes, sha256
  `65ee5fe2f0c7f16429734ab4220e210dc2b8236804934dcd5e22018504167501`). `SOURCE.json` pins
  the URLs and digests.
- **Licence.** CC BY 4.0. `LICENSE` is their `data/LICENSE`, verbatim. Attribution, as that file
  gives it: era labs (ora.ai). (2026). Agent Readiness Dataset: traces and fetchability probes
  from the agentready.org research program. era labs. Data released under CC BY 4.0.
  <https://creativecommons.org/licenses/by/4.0/>. No changes were made to `traces.csv`;
  `output.json` is AgentRank's analysis of it.
- **Analysis.** `python data/external/agentready/analyze.py` (stdlib, standalone) writes
  `output.json`: each figure agentready.org publishes, recomputed under the page's own rule
  (run-weighted), then site-weighted over the 25 sites, then over the 19 sites that each
  received 9 sonnet-4-6 and 9 gpt-5.4 runs (a sensitivity: it also changes the model mix);
  the concentration of runs by site, the site by model by harness allocation, and the base
  under the two llms.txt figures. Blank cells are not-applicable, as the dataset's README says,
  and are never counted as 0.

## `webbench/`: WebBench `results/*.csv`

- **Source.** The eight `results/*.csv` of [Halluminate/WebBench](https://github.com/Halluminate/WebBench)
  at commit `ea7a1628443321363989f354401f0653e0cba6f4`. They are 11.7 MB and carry every agent's
  output text, which the analysis never reads, so they are not committed. `fetch.py` (the only
  network step here, run by hand) downloads them at that commit, refuses any file whose sha256
  is not the pinned one, and writes `trials.csv`: agent, task_id, site, category, difficulty,
  outcome; 11,429 rows. Seven files were committed upstream on 2025-05-27; `rtrvrfinal.csv` on
  2025-06-23, with the message "outputs were self evaluated and are therefore not verified".
- **Licence.** MIT. `LICENSE` is theirs, verbatim: Copyright (c) 2025 Halluminate. `trials.csv`
  is a subset of their files and carries that notice with it.
- **The rule.** A trial is a row whose label column is `Success` or `Failure` (six unlabelled
  rtrvr rows dropped). The site is the start URL's host, lowercased, leading `www.` removed, and
  nothing coarser. The shape-matched subset is Category `READ` and Difficulty `easy`; a site is
  reported at 10 or more pooled trials (20 as the sensitivity) and is not measured below that,
  never 0.
- **Analysis.** `python data/external/webbench/analyze.py` writes `output.json` and `sites.csv`
  (the 351 reported sites: site, trials, tasks, agents, successes, rate; listed by name). A
  site's rate is 2025 behavior of 2025 agents on that site's own bespoke tasks: not the current
  web, and not a ranking. The naive grouping over every task type is computed only as the
  exhibit of why it is invalid: at 30 or more trials, a site's rate tracks its READ share. That
  Spearman and its seeded bootstrap interval come from `scripts/stats_reference.py`, and
  `spearman.test.ts` reproduces both through `lib/stats.ts`.
