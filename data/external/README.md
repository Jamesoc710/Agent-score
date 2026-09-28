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
