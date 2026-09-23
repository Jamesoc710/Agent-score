import { cache } from "react";
import type {
  Site,
  SiteTier,
  LighthouseResult,
  Run,
  SiteLeaderboardEntry,
  CorrelationPoint,
  DatasetSummary,
  AgentPanelSummary,
  FailureMode,
} from "./types";
import {
  FAKE_LEADERBOARD,
  FAKE_CORRELATION_POINTS,
  FAKE_SITES,
  FAKE_LIGHTHOUSE,
  FAKE_RUNS,
} from "./fake-data";
import { ACTIVE_BATCH, ACTIVE_AGENT_ID, PUBLISHED_AGENTS, USING_FIXTURES } from "./dataset";
import { measuredRuns } from "./runs";

// The single data layer. Aggregation (success rate, ranking, correlation) happens here at
// read time, not in the pipeline or in SQL views — see docs/ARCHITECTURE.md. Correlation
// statistics themselves live in lib/stats.ts as pure, separately tested functions.
//
// Fixtures are opt-in and nothing else. Before the Supabase migration this fell back to fake
// data whenever DB credentials were absent, which meant a misconfigured deploy served
// invented numbers as if they were results.
const USE_FAKE = USING_FIXTURES;

// The leaderboard never needs transcripts, which are the only large column.
const RUN_SUMMARY_COLUMNS =
  "site_id,agent_id,batch_label,trial_number,success,step_count,duration_seconds,failure_mode,run_at";

export interface PublishedDataset {
  /** Which agent these entries describe. */
  agent_id: string;
  entries: SiteLeaderboardEntry[];
  summary: DatasetSummary;
  /** Every agent in the batch, for the model-gap comparison. */
  panel: AgentPanelSummary[];
}

// ---------------------------------------------------------------------------
// The published slice: one read of the batch, scoped to the requested agent
// ---------------------------------------------------------------------------

/**
 * Everything the leaderboard and hero need, from one pass over the batch.
 *
 * Reads are scoped to one batch and one agent: mixing them would silently blend two
 * experiments into one success rate. The batch's other agents are still summarised (trial
 * counts only) because the panel gap between them is itself a published finding.
 */
export async function getPublishedDataset(
  agentId: string = ACTIVE_AGENT_ID
): Promise<PublishedDataset> {
  if (USE_FAKE) {
    // Fixtures are their own batch and their own agent. Labelling them with the deployment's
    // ACTIVE_BATCH/agent would print a real dataset's name over invented numbers.
    const fixtureAgent = FAKE_RUNS[0]?.agent_id ?? agentId;
    const fixtureBatch = FAKE_RUNS[0]?.batch_label ?? ACTIVE_BATCH;
    return {
      agent_id: fixtureAgent,
      entries: FAKE_LEADERBOARD,
      summary: summarize(FAKE_SITES, FAKE_RUNS, fixtureBatch, fixtureAgent),
      panel: panelSummaries(FAKE_RUNS),
    };
  }

  const { sites, lhBySite, allRuns } = await readBatch();
  const agentRuns = allRuns.filter((r) => r.agent_id === agentId);

  return {
    agent_id: agentId,
    entries: rankEntries(entriesFor(sites, lhBySite, allRuns, agentId)),
    summary: summarize(sites, agentRuns, ACTIVE_BATCH, agentId),
    panel: panelSummaries(allRuns),
  };
}

interface BatchRead {
  sites: Site[];
  lhBySite: Map<string, LighthouseResult>;
  allRuns: Run[];
}

/**
 * One pass over the published batch. Runs are unfiltered by agent so one read serves them all.
 *
 * Memoized per request: /correlation needs both the selected agent's leaderboard and the whole
 * panel's audit points, and without this it would issue the same three queries twice.
 */
const readBatch = cache(async function readBatch(): Promise<BatchRead> {
  const { getSupabase } = await import("./supabase");
  const db = getSupabase();

  const [sitesRes, lhRes, runsRes] = await Promise.all([
    // Ordered explicitly: Postgres does not promise a row order, and while every published
    // statistic is order-invariant by construction (bootstrapCI and the permutation family
    // both sort canonically), the prose lists derived from these rows are not — the sub-audit
    // confound section was naming the same six sites in a different order between reloads.
    // A page whose argument is reproducibility cannot reshuffle itself.
    db.from("sites").select("*").order("site_id"),
    db.from("lighthouse_results").select("*").eq("batch_label", ACTIVE_BATCH).order("site_id"),
    db.from("agent_runs").select(RUN_SUMMARY_COLUMNS).eq("batch_label", ACTIVE_BATCH),
  ]);

  return {
    sites: rows<Site>("sites", sitesRes),
    lhBySite: new Map(
      rows<LighthouseResult>("lighthouse_results", lhRes).map((lh) => [lh.site_id, lh])
    ),
    allRuns: rows<Run>("agent_runs", runsRes),
  };
});

/** The leaderboard view of one agent's slice of a batch read. Unranked. */
function entriesFor(
  sites: Site[],
  lhBySite: Map<string, LighthouseResult>,
  allRuns: Run[],
  agentId: string
): SiteLeaderboardEntry[] {
  const runsBySite = new Map<string, Run[]>();
  for (const run of allRuns) {
    if (run.agent_id !== agentId) continue;
    const arr = runsBySite.get(run.site_id) ?? [];
    arr.push(run);
    runsBySite.set(run.site_id, arr);
  }
  return sites.map((site) =>
    computeEntry(site, lhBySite.get(site.site_id), runsBySite.get(site.site_id) ?? [])
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  agentId: string = ACTIVE_AGENT_ID
): Promise<SiteLeaderboardEntry[]> {
  return (await getPublishedDataset(agentId)).entries;
}

// ---------------------------------------------------------------------------
// Single site detail
// ---------------------------------------------------------------------------

export async function getSiteDetail(
  slug: string,
  agentId: string = ACTIVE_AGENT_ID
): Promise<{
  site: Site;
  lighthouse: LighthouseResult | null;
  runs: Run[];
} | null> {
  if (USE_FAKE) {
    const site = FAKE_SITES.find((s) => s.site_id === slug);
    if (!site) return null;
    return {
      site,
      lighthouse: FAKE_LIGHTHOUSE.find((l) => l.site_id === slug) ?? null,
      runs: FAKE_RUNS.filter((r) => r.site_id === slug),
    };
  }

  const { getSupabase } = await import("./supabase");
  const db = getSupabase();

  const [siteRes, lhRes, runsRes] = await Promise.all([
    db.from("sites").select("*").eq("site_id", slug).maybeSingle(),
    db
      .from("lighthouse_results")
      .select("*")
      .eq("site_id", slug)
      .eq("batch_label", ACTIVE_BATCH)
      .maybeSingle(),
    db
      .from("agent_runs")
      .select("*")
      .eq("site_id", slug)
      .match({ batch_label: ACTIVE_BATCH, agent_id: agentId })
      .order("trial_number"),
  ]);

  const site = maybeRow<Site>("sites", siteRes);
  if (!site) return null;

  return {
    site,
    lighthouse: maybeRow<LighthouseResult>("lighthouse_results", lhRes),
    runs: rows<Run>("agent_runs", runsRes),
  };
}

// ---------------------------------------------------------------------------
// Correlation page
// ---------------------------------------------------------------------------

export function toCorrelationPoints(entries: SiteLeaderboardEntry[]): CorrelationPoint[] {
  return (
    entries
      // A site with a Lighthouse score but no trials has no behavioral measurement — plotting
      // it would put a fabricated 0% on the scatter.
      .filter((e) => e.lh_total !== null && e.trial_count > 0)
      .map((e) => ({
        site_id: e.site_id,
        name: e.name,
        lh_total: e.lh_total!,
        success_rate: e.success_rate,
        lh_accessibility_tree: e.lh_accessibility_tree ?? 0,
        lh_layout_stability: e.lh_layout_stability ?? 0,
        lh_llms_txt: e.lh_llms_txt ?? 0,
        lh_webmcp: e.lh_webmcp ?? 0,
      }))
  );
}

export async function getCorrelationPoints(
  agentId: string = ACTIVE_AGENT_ID
): Promise<CorrelationPoint[]> {
  if (USE_FAKE) return FAKE_CORRELATION_POINTS;
  return toCorrelationPoints(await getLeaderboard(agentId));
}

// ---------------------------------------------------------------------------
// Sub-audit attribution: every published agent, from one read
// ---------------------------------------------------------------------------

/**
 * One agent's sites for the sub-audit analysis.
 *
 * A superset of CorrelationPoint: it carries `tier` (the confound is with the cohort design
 * bucket, so the analysis has to see it) and `trial_count` (the trial-level exhibit needs the
 * denominator, and a count of 0 is how a never-reached site identifies itself). Declared here
 * rather than in lib/types.ts, which is the frozen lane<->frontend contract — this is a derived
 * read-path view, the same way SiteLeaderboardEntry's tier/flag are.
 */
export interface AgentAuditPoints {
  agent_id: string;
  points: (CorrelationPoint & { tier: SiteTier; trial_count: number })[];
}

/**
 * Both agents' points in one Supabase round trip.
 *
 * getPublishedDataset already reads every agent's runs and filters in memory, so calling it once
 * per agent would repeat the sites and lighthouse reads for nothing. Sites that were attempted
 * and never reached are INCLUDED here with trial_count 0 — the analysis excludes them from every
 * estimate and reports separately on what including them would do.
 */
export async function getPanelAuditPoints(): Promise<AgentAuditPoints[]> {
  if (USE_FAKE) {
    // Fixtures are single-agent; label them with the agent that produced the rows.
    const fixtureAgent = FAKE_RUNS[0]?.agent_id ?? ACTIVE_AGENT_ID;
    return [{ agent_id: fixtureAgent, points: toAuditPoints(FAKE_LEADERBOARD) }];
  }

  const { sites, lhBySite, allRuns } = await readBatch();

  const agentIds = PUBLISHED_AGENTS.map((a) => a.id).filter((id) =>
    allRuns.some((r) => r.agent_id === id)
  );
  // Fall back to whatever agent ids the batch actually holds, as panelSummaries does: the page
  // must describe the rows that exist, not the panel the deployment expected.
  const present = agentIds.length > 0 ? agentIds : [...new Set(allRuns.map((r) => r.agent_id))].sort();

  return present.map((agentId) => ({
    agent_id: agentId,
    points: toAuditPoints(entriesFor(sites, lhBySite, allRuns, agentId)),
  }));
}

function toAuditPoints(entries: SiteLeaderboardEntry[]): AgentAuditPoints["points"] {
  return entries
    .filter((e) => e.lh_total !== null)
    .map((e) => ({
      site_id: e.site_id,
      name: e.name,
      tier: e.tier,
      trial_count: e.trial_count,
      lh_total: e.lh_total!,
      success_rate: e.success_rate,
      lh_accessibility_tree: e.lh_accessibility_tree ?? 0,
      lh_layout_stability: e.lh_layout_stability ?? 0,
      lh_llms_txt: e.lh_llms_txt ?? 0,
      lh_webmcp: e.lh_webmcp ?? 0,
    }));
}

// ---------------------------------------------------------------------------
// Supabase result unwrapping — a failed read must never look like an empty result
// ---------------------------------------------------------------------------

type PostgrestResult = { data: unknown; error: { message: string } | null };

function rows<T>(label: string, res: PostgrestResult): T[] {
  if (res.error) throw new Error(`Supabase read failed (${label}): ${res.error.message}`);
  return (res.data as T[] | null) ?? [];
}

function maybeRow<T>(label: string, res: PostgrestResult): T | null {
  if (res.error) throw new Error(`Supabase read failed (${label}): ${res.error.message}`);
  return (res.data as T | null) ?? null;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

// METHODOLOGY.md failure-mode rule: "error" rows are excluded from success-rate
// denominators ONLY if the run never reached the site (goto failed, step_count 0).
// Errors after the site was reached stay in the denominator as failures. A site whose
// every trial never connected (e.g. connection-level bot rejection) therefore has no
// behavioral measurement at all — not a 0% success rate.
//
// The rule itself moved to lib/runs.ts when lib/exhibit.ts needed the identical one: this
// module memoizes its batch read with react/cache and so cannot be imported outside React.
// Re-exported here because this is where every existing caller looks for it.
export { measuredRuns };

/** Trial-level totals, denominators and the run window for one published slice. */
function summarize(
  sites: Site[],
  agentRuns: Run[],
  batchLabel: string,
  agentId: string
): DatasetSummary {
  const measured = measuredRuns(agentRuns);
  const measuredSites = new Set(measured.map((r) => r.site_id));

  // A site is "unmeasured" only if it has recorded trials that all failed to reach it.
  // Sites with no rows at all have simply not been run for this agent.
  const attempted = new Set(agentRuns.map((r) => r.site_id));
  const unmeasured = [...attempted].filter((id) => !measuredSites.has(id)).sort();

  const times = agentRuns.map((r) => r.run_at).sort();

  return {
    batch_label: batchLabel,
    agent_id: agentId,
    site_count: sites.length,
    measured_site_count: measuredSites.size,
    unmeasured_site_ids: unmeasured,
    trial_count: measured.length,
    excluded_trial_count: agentRuns.length - measured.length,
    success_count: measured.filter((r) => r.success).length,
    // No measured trials means no rate exists. Reporting 0% would invent a result.
    success_rate: measured.length > 0 ? measured.filter((r) => r.success).length / measured.length : null,
    run_window: times.length > 0 ? { first: times[0], last: times[times.length - 1] } : null,
  };
}

/** One row per agent present in the batch, ordered by the published panel. */
function panelSummaries(allRuns: Run[]): AgentPanelSummary[] {
  const byAgent = new Map<string, Run[]>();
  for (const run of allRuns) {
    const arr = byAgent.get(run.agent_id) ?? [];
    arr.push(run);
    byAgent.set(run.agent_id, arr);
  }

  return [...byAgent.entries()]
    .map(([agent_id, runs]) => {
      const measured = measuredRuns(runs);
      const successes = measured.filter((r) => r.success).length;
      return {
        agent_id,
        trial_count: measured.length,
        success_count: successes,
        success_rate: measured.length > 0 ? successes / measured.length : null,
        measured_site_count: new Set(measured.map((r) => r.site_id)).size,
      };
    })
    .sort((a, b) => a.agent_id.localeCompare(b.agent_id));
}

function rankEntries(entries: SiteLeaderboardEntry[]): SiteLeaderboardEntry[] {
  // Deterministic order for a published table: measured sites first (a site never reached has
  // no rate and must not sort in among the 0% rows), then success rate, then name. The
  // Lighthouse category mean is never a tiebreak: at five trials most rows sit in ties, so
  // breaking them by the x-axis made the visible order an x-axis ordering under a headline
  // that finds no relationship with it (docs/METHODOLOGY.md, 2026-09-23 leaderboard block).
  const measured = (e: SiteLeaderboardEntry) => (e.trial_count > 0 ? 0 : 1);
  entries.sort(
    (a, b) =>
      measured(a) - measured(b) || b.success_rate - a.success_rate || a.name.localeCompare(b.name)
  );
  // `rank` stays in the frozen contract (lib/types.ts) and is no longer rendered anywhere.
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

function computeEntry(
  site: Site,
  lh: LighthouseResult | undefined,
  allRuns: Run[]
): SiteLeaderboardEntry {
  // Never-reached-the-site errors carry no behavioral information about the site.
  const runs = measuredRuns(allRuns);
  const successes = runs.filter((r) => r.success).length;
  const success_rate = runs.length > 0 ? successes / runs.length : 0;
  const mean_steps =
    runs.length > 0
      ? runs.reduce((s, r) => s + r.step_count, 0) / runs.length
      : 0;

  // Dominant FAILURE mode — exclude "success" so a mostly-successful site doesn't report
  // top_failure_mode === "success". If there are no failures, report "success"; if there
  // are no runs at all, report "error" (no data yet).
  const failureCounts = new Map<FailureMode, number>();
  runs.forEach((r) => {
    if (r.failure_mode === "success") return;
    failureCounts.set(r.failure_mode, (failureCounts.get(r.failure_mode) ?? 0) + 1);
  });
  const topFailure = [...failureCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const top_failure_mode: FailureMode =
    runs.length === 0 ? "error" : (topFailure ?? "success");

  return {
    site_id: site.site_id,
    name: site.name,
    start_url: site.start_url,
    tier: site.tier,
    flag: site.flag,
    lh_total: lh?.lh_total ?? null,
    lh_accessibility_tree: lh?.lh_accessibility_tree ?? null,
    lh_layout_stability: lh?.lh_layout_stability ?? null,
    lh_llms_txt: lh?.lh_llms_txt ?? null,
    lh_webmcp: lh?.lh_webmcp ?? null,
    success_rate,
    trial_count: runs.length,
    mean_steps: Math.round(mean_steps * 10) / 10,
    top_failure_mode,
    rank: 0,
  };
}
