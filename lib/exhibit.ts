import type { FailureMode, LighthouseResult, Run, Site } from "./types";
import { measuredRuns } from "./runs";

/**
 * The authored Goodhart exhibit: two pages, one registered answer, one mechanism between them.
 * See docs/EXHIBIT.md, which is its pre-registration record.
 *
 * This module deliberately does NOT touch Supabase. lib/queries.ts reads `sites` with
 * select("*"), so a row there would land on the cohort leaderboard and in the cohort's n. The
 * exhibit is therefore never imported: it is read from the committed lane artifacts, which are
 * the auditable record of the run anyway (docs/ARCHITECTURE.md, "Neither lane talks to the
 * database"). The consequence worth stating plainly is that nothing on this path can move a
 * published cohort number, because the cohort numbers come from a different batch in a
 * different store.
 *
 * data/exhibit-goodhart.json is derived from those artifacts by scripts/build-exhibit-summary.ts
 * and committed, because JSONL and CSV are not importable modules and reading files at request
 * time is not reliable in a serverless bundle. lib/exhibit.test.ts re-derives it from
 * data/exhibit-cohort.csv, data/lighthouse-goodhart.json and data/agent-runs-goodhart.jsonl and
 * fails if the committed file has drifted, the same arrangement scoring-vectors.json and
 * stats-vectors.json use.
 *
 * This file holds the pure half (types and the fold) and imports nothing generated, so the
 * generator can depend on it. lib/exhibit-data.ts holds the committed result.
 */

export const EXHIBIT_BATCH = "goodhart";

/** One agent's trials against one exhibit page. */
export interface ExhibitAgentResult {
  agent_id: string;
  /** Every recorded trial, in trial order. Transcripts included: they are the evidence. */
  runs: Run[];
  /** Trials in the success-rate denominator, per the METHODOLOGY error rule. */
  measured_trial_count: number;
  /** Recorded but never reached the page; excluded from the denominator, never scored 0. */
  excluded_trial_count: number;
  success_count: number;
  /** null when nothing was measured. Never 0, which would be a different claim. */
  success_rate: number | null;
  /** Counts by recorded failure mode over the measured trials, descending then alphabetical. */
  failure_modes: { mode: FailureMode; count: number }[];
  mean_steps: number | null;
  mean_seconds: number | null;
}

export interface ExhibitPageResult {
  /** The pre-registered row, exactly as committed in data/exhibit-cohort.csv. */
  site: Site;
  /** The page's own route on this deployment, e.g. /exhibit/pair-a.html. */
  route: string;
  lighthouse: LighthouseResult | null;
  agents: ExhibitAgentResult[];
}

export interface ExhibitDataset {
  batch_label: string;
  /** Both halves register the same question, answer and rule; a test pins that. */
  question: string;
  answer_substring: string;
  match_rule: string;
  agent_ids: string[];
  run_window: { first: string; last: string } | null;
  pages: ExhibitPageResult[];
}

// ---------------------------------------------------------------------------
// Derivation — pure, so the committed file and the test compute it the same way
// ---------------------------------------------------------------------------

/**
 * Fold the three lane artifacts into what the exhibit page renders.
 *
 * Ordering is fixed at every level (pages by site_id, agents by agent_id, runs by trial
 * number, failure modes by count then name) so the committed JSON is stable and a rebuild
 * that changes nothing produces no diff.
 */
export function deriveExhibit(
  sites: Site[],
  lighthouse: LighthouseResult[],
  runs: Run[],
  batchLabel: string = EXHIBIT_BATCH
): ExhibitDataset {
  const batchRuns = runs.filter((r) => r.batch_label === batchLabel);
  const lhBySite = new Map(
    lighthouse.filter((l) => l.batch_label === batchLabel).map((l) => [l.site_id, l])
  );
  const orderedSites = [...sites].sort((a, b) => a.site_id.localeCompare(b.site_id));
  const agentIds = [...new Set(batchRuns.map((r) => r.agent_id))].sort();

  const pages: ExhibitPageResult[] = orderedSites.map((site) => ({
    site,
    route: routeFor(site.start_url),
    lighthouse: lhBySite.get(site.site_id) ?? null,
    agents: agentIds
      .map((agentId) =>
        summarizeAgent(
          agentId,
          batchRuns.filter((r) => r.site_id === site.site_id && r.agent_id === agentId)
        )
      )
      .filter((a) => a.runs.length > 0),
  }));

  const times = batchRuns.map((r) => r.run_at).sort();
  const first = orderedSites[0];

  return {
    batch_label: batchLabel,
    question: first?.question ?? "",
    answer_substring: first?.answer_substring ?? "",
    match_rule: first?.match_rule ?? "",
    agent_ids: agentIds,
    run_window: times.length > 0 ? { first: times[0], last: times[times.length - 1] } : null,
    pages,
  };
}

function summarizeAgent(agentId: string, all: Run[]): ExhibitAgentResult {
  const runs = [...all].sort((a, b) => a.trial_number - b.trial_number);
  const measured = measuredRuns(runs);
  const successes = measured.filter((r) => r.success).length;

  const counts = new Map<FailureMode, number>();
  for (const run of measured) counts.set(run.failure_mode, (counts.get(run.failure_mode) ?? 0) + 1);

  return {
    agent_id: agentId,
    runs,
    measured_trial_count: measured.length,
    excluded_trial_count: runs.length - measured.length,
    success_count: successes,
    success_rate: measured.length > 0 ? successes / measured.length : null,
    failure_modes: [...counts.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode)),
    mean_steps: mean(measured.map((r) => r.step_count)),
    mean_seconds: mean(measured.map((r) => r.duration_seconds)),
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * The path half of a registered start_url.
 *
 * The run was served from this repository's own build on 127.0.0.1 (docs/EXHIBIT.md explains
 * why), so the registered host is a localhost port and is not something to link a reader at.
 * The route is, because the same committed file is served at the same path by this deployment.
 */
export function routeFor(startUrl: string): string {
  try {
    return new URL(startUrl).pathname;
  } catch {
    return startUrl;
  }
}

/** Totals across both pages for one agent, for the "both agents, same outcome" line. */
export function successAcrossPages(
  dataset: ExhibitDataset,
  siteId: string
): { successes: number; measured: number } {
  const page = dataset.pages.find((p) => p.site.site_id === siteId);
  if (!page) return { successes: 0, measured: 0 };
  return page.agents.reduce(
    (acc, a) => ({
      successes: acc.successes + a.success_count,
      measured: acc.measured + a.measured_trial_count,
    }),
    { successes: 0, measured: 0 }
  );
}
