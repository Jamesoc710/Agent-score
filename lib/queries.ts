import type {
  Site,
  LighthouseResult,
  Run,
  SiteLeaderboardEntry,
  CorrelationPoint,
  FailureMode,
} from "./types";
import {
  FAKE_LEADERBOARD,
  FAKE_CORRELATION_POINTS,
  FAKE_SITES,
  FAKE_LIGHTHOUSE,
  FAKE_RUNS,
} from "./fake-data";
import { ACTIVE_BATCH, ACTIVE_AGENT_ID } from "./dataset";

// The single data layer. Aggregation (success rate, ranking, correlation) happens here at
// read time, not in the pipeline or in SQL views — see docs/ARCHITECTURE.md.
//
// Fixtures are opt-in and nothing else. Before the Supabase migration this fell back to fake
// data whenever DB credentials were absent, which meant a misconfigured deploy served
// invented numbers as if they were results.
const USE_FAKE = process.env.USE_FAKE_DATA === "true";

// Every read is scoped to one published dataset: mixing batches or agents would silently
// blend two experiments into one success rate.
const RUN_SCOPE = { batch_label: ACTIVE_BATCH, agent_id: ACTIVE_AGENT_ID };

// The leaderboard never needs transcripts, which are the only large column.
const RUN_SUMMARY_COLUMNS =
  "site_id,agent_id,batch_label,trial_number,success,step_count,duration_seconds,failure_mode,run_at";

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(): Promise<SiteLeaderboardEntry[]> {
  if (USE_FAKE) return FAKE_LEADERBOARD;

  const { getSupabase } = await import("./supabase");
  const db = getSupabase();

  const [sitesRes, lhRes, runsRes] = await Promise.all([
    db.from("sites").select("*"),
    db.from("lighthouse_results").select("*").eq("batch_label", ACTIVE_BATCH),
    db.from("agent_runs").select(RUN_SUMMARY_COLUMNS).match(RUN_SCOPE),
  ]);

  const sites = rows<Site>("sites", sitesRes);
  const lhBySite = new Map(
    rows<LighthouseResult>("lighthouse_results", lhRes).map((lh) => [lh.site_id, lh])
  );

  const runsBySite = new Map<string, Run[]>();
  for (const run of rows<Run>("agent_runs", runsRes)) {
    const arr = runsBySite.get(run.site_id) ?? [];
    arr.push(run);
    runsBySite.set(run.site_id, arr);
  }

  const entries = sites.map((site) =>
    computeEntry(site, lhBySite.get(site.site_id), runsBySite.get(site.site_id) ?? [])
  );

  return rankEntries(entries);
}

// ---------------------------------------------------------------------------
// Single site detail
// ---------------------------------------------------------------------------

export async function getSiteDetail(slug: string): Promise<{
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
      .match(RUN_SCOPE)
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

export async function getCorrelationPoints(): Promise<CorrelationPoint[]> {
  if (USE_FAKE) return FAKE_CORRELATION_POINTS;

  const entries = await getLeaderboard();
  return entries
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

function rankEntries(entries: SiteLeaderboardEntry[]): SiteLeaderboardEntry[] {
  // Deterministic order for a published table: success rate, then static score, then name.
  // Without the tie-breaks, sites with equal success rates (common while a batch is still
  // filling in) would shuffle between renders.
  entries.sort(
    (a, b) =>
      b.success_rate - a.success_rate ||
      (b.lh_total ?? -1) - (a.lh_total ?? -1) ||
      a.name.localeCompare(b.name)
  );
  entries.forEach((e, i) => (e.rank = i + 1));
  return entries;
}

function computeEntry(
  site: Site,
  lh: LighthouseResult | undefined,
  runs: Run[]
): SiteLeaderboardEntry {
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

// ---------------------------------------------------------------------------
// Pearson correlation — used on the /correlation page
// ---------------------------------------------------------------------------

export function pearsonR(points: { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let num = 0, denomX = 0, denomY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

// Linear regression — returns {slope, intercept} for the trend line
export function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0 };

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let num = 0, denom = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    denom += (p.x - meanX) ** 2;
  }

  const slope = denom === 0 ? 0 : num / denom;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}
