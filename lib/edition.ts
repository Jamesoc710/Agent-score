import type { FailureMode, LighthouseResult, Run, Site, SiteTier } from "./types";
import { measuredRuns } from "./runs";
import { bootstrapCI, bootstrapRows, mean, spearmanRho, type Pair } from "./stats";
import { groupSplit, sensitivity, type GroupSplit, type SiteCell, type SplitGroup } from "./study";
import { clsDecomposition } from "./x-axis";

/**
 * The edition snapshot (design S2-4 section 8): one committed, immutable fold of a published
 * batch's artifacts, which every crawled or shared surface reads instead of the database. The
 * sitemap, the JSON-LD, the citation block, /data/v1.json, the site-page caveat blocks and the
 * /correlation sensitivity line all read it through lib/edition-data.ts.
 *
 * Every number under `stats` is computed here by the same functions the pages use and carries
 * the key path of the block in scripts/tests/stats-vectors.json that pins it, plus the two
 * implementations. `checkAgainstVectors` compares the two, the generator refuses to write a
 * snapshot that disagrees, and lib/edition.test.ts re-derives the committed file from the same
 * artifacts. A published number is therefore computed twice, in two languages, and the
 * snapshot is a third copy that cannot drift silently.
 *
 * This file is the pure half (types and the fold); it imports nothing generated, so the
 * generator can depend on it. Shape: `schema_version` 1, additive changes only within it.
 * Types are local: lib/types.ts is the frozen lane contract and is untouched.
 */

export const EDITION_SCHEMA_VERSION = 1;
export const EDITION_NUMBER = 1;
export const EDITION_TITLE = "State of the Agentic Web, No. 1";
/** Null until Zenodo mints one from the release tag. No placeholder identifier ever renders. */
export const EDITION_DOI: string | null = "10.5281/zenodo.22924988";

const TS_STATS = "lib/stats.ts";
const TS_STUDY = "lib/study.ts";
const TS_X_AXIS = "lib/x-axis.ts";
const PY = "scripts/stats_reference.py";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One row of a Lane 1 panel file (data/lighthouse-<batch>.panel.json), the fields read here. */
export interface PanelRow {
  lh_total: number;
  lh_passed: number | null;
  lh_passable: number | null;
  lh_llms_txt_status: LlmsTxtStatus | null;
  lh_webmcp_applied: number | null;
  lh_webmcp_tool_count: number | null;
  lighthouse_version: string | null;
  run_at: string;
}

export type LlmsTxtStatus = "pass" | "fail" | "absent" | "error";

export interface RemeasurementBatchInput {
  label: string;
  panel: Record<string, PanelRow>;
  /** The category's audit ids as the run's LHR listed them (its auditRefs). */
  audit_ids: string[];
  form_factor: string | null;
}

export interface ArtifactRecord {
  path: string;
  /** What the file is, in a few words. */
  role: string;
  bytes: number;
  /** Hex digest of the file, or null for a directory entry. */
  sha256: string | null;
  /** For a directory entry: how many files it holds. */
  files?: number;
}

export interface EditionInputs {
  batch_label: string;
  cohort: Site[];
  runs: Run[];
  lighthouse: LighthouseResult[];
  /** scripts/tests/stats-vectors.json, parsed. */
  vectors: unknown;
  /** The published panel, in toggle order. */
  agents: { id: string; label: string }[];
  protocol: { max_steps: number; clock_seconds: number; source: string };
  answer_key_tag: string | null;
  lighthouse_version: { version: string; source: string } | null;
  /** The dated Lane 1 re-measurement batches of one day, the pinned-version one first. */
  remeasurement: RemeasurementBatchInput[];
  /** The rule-(d) prediction list (lib/instrument.ts). */
  pending: { site_id: string; rule: "d"; decision: string }[];
  /** True once the control's committed summary exists; the fold then refuses (see below). */
  instrument_summary_exists: boolean;
  /** docs/METHODOLOGY.md, read only for the date its instrument-control block was registered. */
  methodology: string;
  artifacts: ArtifactRecord[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface TrialOutcome {
  trial: number;
  success: boolean;
  failure_mode: FailureMode;
  /** False for a trial that never reached the site: excluded from the denominator, never 0. */
  measured: boolean;
}

export interface SiteAgentResult {
  /** Successes and measured trials. n = 0 is "not measured", never 0%. */
  k: number;
  n: number;
  /** Recorded trials that never reached the site. */
  excluded: number;
  mean_steps: number | null;
  outcomes: TrialOutcome[];
}

/** v1 recorded each audit as a 0/1 flag; these are the words each flag may be read as. */
export interface V1AuditStates {
  a11y_tree: "pass" | "fail";
  /** v1's flag is CLS === 1.00, so it can only say "1.00" or "below 1.00". */
  cls: "1.00" | "below_1.00";
  /** v1 merged "did not pass" with "did not apply" (a 404 at /llms.txt leaves the denominator). */
  llms_txt: "pass" | "fail_or_na";
  /** At 13.3.0 the WebMCP audits score 1 wherever the browser exposes the API: applicability. */
  webmcp: "applied" | "not_applicable";
}

export interface EditionSite {
  site_id: string;
  name: string;
  tier: SiteTier;
  start_url: string;
  lh_total: number | null;
  /** Chrome's own fraction. v1 recorded neither half, and nothing is reconstructed here. */
  lh_passed: number | null;
  lh_passable: number | null;
  audits: V1AuditStates | null;
  results: Record<string, SiteAgentResult>;
  /** How the row was obtained when a registered rule names it; never a grade. */
  provenance: "rule_b" | null;
}

export interface EditionAgent {
  id: string;
  label: string;
  /** Measured trials and successes; `vector` pins both. */
  trials: number;
  successes: number;
  measured_sites: number;
  unmeasured_sites: string[];
  vector: string;
}

export interface EditionExclusion {
  site_id: string;
  class: "harness_artifact";
  rule: "b";
  source: string;
  reason: string;
  /** Recorded trials across the published agents, and how many were harness errors. */
  recorded: number;
  errors: number;
  /** The harness error's first line when every trial recorded the same one, else null. */
  error_signature: string | null;
  /** Set only by rule (d), after the control runs. */
  instrument: null;
  vector: string;
}

export interface EditionPending {
  site_id: string;
  rule: "d";
  status: "control not run";
  /** The date docs/METHODOLOGY.md registers the instrument control, or null before it does. */
  registered_on: string | null;
  recorded: number;
  /** How many of those trials ended at the clock. */
  timeouts: number;
  decision: string;
}

export interface StatProvenance {
  vector: string;
  ts: string;
  py: string;
}

export interface EditionInterval extends StatProvenance {
  point: number;
  lo: number;
  hi: number;
  n: number;
}

export interface EditionGroup {
  sites: string[];
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export interface EditionSplit {
  excluded: string[];
  unmeasured: string[];
  all_succeeded: EditionGroup;
  all_failed: EditionGroup;
}

export interface EditionStats {
  /** The published correlation per agent, at the pre-registered denominator. */
  rho: Record<string, EditionInterval>;
  /** The one registered sensitivity (decision D14): rule (b) now, rule (d) once the control runs. */
  sensitivity: {
    rule: "b";
    excluded: string[];
    rule_d: "pending";
    by_agent: Record<string, EditionInterval>;
  };
  group_split: Record<string, { published: EditionSplit; rule_b: EditionSplit } & StatProvenance>;
  /** Paired per-site gap, second arm minus first, in rate units. */
  model_gap: EditionInterval & { arms: [string, string]; sites_moved: number };
  /** How much of the category mean's rank order is layout shift (design S2-7 section 8). */
  layout_shift: StatProvenance & {
    rho: { min: number; median: number; max: number; n: number };
    assignments: number;
    identical_input: { count: number; min: number; max: number };
  };
}

export interface EditionRemeasurement {
  date: string;
  pinned_batch: string;
  batches: {
    label: string;
    lighthouse_version: string | null;
    form_factor: string | null;
    audit_ids: string[];
    run_window: { first: string; last: string } | null;
  }[];
  /** The pinned-version batch's row per site, the fields a page prints. */
  sites: Record<
    string,
    {
      lh_total: number;
      lh_passed: number | null;
      lh_passable: number | null;
      llms_txt: LlmsTxtStatus | null;
      webmcp_applied: boolean | null;
      webmcp_tools: number | null;
    }
  >;
}

export interface EditionSnapshot {
  schema_version: number;
  batch_label: string;
  edition: { number: number; title: string; doi: string | null };
  answer_key_tag: string | null;
  run_window: { first: string; last: string } | null;
  protocol: {
    trials_per_site: number;
    max_steps: number;
    clock_seconds: number;
    source: string;
  };
  agents: EditionAgent[];
  lane1: {
    batch: string;
    lighthouse_version: string | null;
    version_source: string | null;
    form_factor: "mobile";
    form_factor_source: string;
    run_window: { first: string; last: string } | null;
  };
  remeasurement: EditionRemeasurement | null;
  exclusions: EditionExclusion[];
  pending: EditionPending[];
  sites: EditionSite[];
  stats: EditionStats;
  artifacts: ArtifactRecord[];
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/**
 * Fold the batch's artifacts into the snapshot. Ordering is fixed at every level so a rebuild
 * that changes nothing produces no diff.
 */
export function deriveEdition(inputs: EditionInputs): EditionSnapshot {
  if (inputs.instrument_summary_exists) {
    // Rule (d) reads the first complete instrument-v1 only, and only through a dated amendment
    // that adds its sites with "as measured by instrument-v1 on <date>, N of 3 passes". Folding
    // it silently here would publish an exclusion before that amendment exists.
    throw new Error(
      "An instrument-v1 summary is committed: rule (d) needs its dated amendment in lib/edition.ts before the snapshot can be regenerated."
    );
  }

  const batch = inputs.batch_label;
  const runs = inputs.runs.filter((r) => r.batch_label === batch);
  const lhBySite = new Map(
    inputs.lighthouse.filter((l) => l.batch_label === batch).map((l) => [l.site_id, l])
  );
  const cohort = [...inputs.cohort].sort((a, b) => cmp(a.site_id, b.site_id));
  const agentIds = inputs.agents.map((a) => a.id).filter((id) => runs.some((r) => r.agent_id === id));

  const runsFor = (siteId: string, agentId: string) =>
    runs
      .filter((r) => r.site_id === siteId && r.agent_id === agentId)
      .sort((a, b) => a.trial_number - b.trial_number);

  // Registered rule (b): a measured site whose every recorded trial is the harness's own error.
  const ruleB = cohort
    .map((s) => s.site_id)
    .filter((id) =>
      agentIds.some((agentId) => {
        const siteRuns = runsFor(id, agentId);
        return measuredRuns(siteRuns).length > 0 && siteRuns.every((r) => r.failure_mode === "error");
      })
    );

  const cellsFor = (agentId: string): SiteCell[] =>
    cohort.map((s) => {
      const measured = measuredRuns(runsFor(s.site_id, agentId));
      return {
        site_id: s.site_id,
        k: measured.filter((r) => r.success).length,
        n: measured.length,
        lh_total: lhBySite.get(s.site_id)?.lh_total ?? null,
      };
    });

  const sites: EditionSite[] = cohort.map((site) => {
    const lh = lhBySite.get(site.site_id);
    const results: Record<string, SiteAgentResult> = {};
    for (const agentId of agentIds) results[agentId] = siteResult(runsFor(site.site_id, agentId));
    return {
      site_id: site.site_id,
      name: site.name,
      tier: site.tier,
      start_url: site.start_url,
      lh_total: lh?.lh_total ?? null,
      lh_passed: null,
      lh_passable: null,
      audits: lh ? v1AuditStates(lh) : null,
      results,
      provenance: ruleB.includes(site.site_id) ? "rule_b" : null,
    };
  });

  const agents: EditionAgent[] = agentIds.map((id) => {
    const agentRuns = runs.filter((r) => r.agent_id === id);
    const measured = measuredRuns(agentRuns);
    const measuredSites = new Set(measured.map((r) => r.site_id));
    return {
      id,
      label: inputs.agents.find((a) => a.id === id)!.label,
      trials: measured.length,
      successes: measured.filter((r) => r.success).length,
      measured_sites: measuredSites.size,
      unmeasured_sites: [...new Set(agentRuns.map((r) => r.site_id))]
        .filter((s) => !measuredSites.has(s))
        .sort(),
      vector: `v1/${id}`,
    };
  });

  const exclusions: EditionExclusion[] = ruleB.map((siteId) => {
    const siteRuns = agentIds.flatMap((a) => runsFor(siteId, a));
    const signatures = [
      ...new Set(siteRuns.map((r) => firstLine(lastError(r))).filter((e): e is string => e !== null)),
    ];
    return {
      site_id: siteId,
      class: "harness_artifact",
      rule: "b",
      source: `batch ${batch} trial record`,
      reason: "every recorded trial ended in the harness's own error after the site was reached",
      recorded: siteRuns.length,
      errors: siteRuns.filter((r) => r.failure_mode === "error").length,
      error_signature: signatures.length === 1 ? signatures[0] : null,
      instrument: null,
      vector: "study_v2/exclusions/rule_b",
    };
  });

  const registeredOn = findRegistrationDate(inputs.methodology, /instrument[- ]control|instrument-v1/i);
  const pending: EditionPending[] = [...inputs.pending]
    .sort((a, b) => cmp(a.site_id, b.site_id))
    .map((p) => {
      const siteRuns = agentIds.flatMap((a) => runsFor(p.site_id, a));
      return {
        site_id: p.site_id,
        rule: "d",
        status: "control not run",
        registered_on: registeredOn,
        recorded: siteRuns.length,
        timeouts: siteRuns.filter((r) => r.failure_mode === "timeout").length,
        decision: p.decision,
      };
    });

  const times = runs.map((r) => r.run_at).sort();
  const lhTimes = [...lhBySite.values()].map((l) => l.run_at).sort();

  return {
    schema_version: EDITION_SCHEMA_VERSION,
    batch_label: batch,
    edition: { number: EDITION_NUMBER, title: EDITION_TITLE, doi: EDITION_DOI },
    answer_key_tag: inputs.answer_key_tag,
    run_window: timeWindow(times),
    protocol: {
      trials_per_site: Math.max(0, ...runs.map((r) => r.trial_number)),
      max_steps: inputs.protocol.max_steps,
      clock_seconds: inputs.protocol.clock_seconds,
      source: inputs.protocol.source,
    },
    agents,
    lane1: {
      batch,
      lighthouse_version: inputs.lighthouse_version?.version ?? null,
      version_source: inputs.lighthouse_version?.source ?? null,
      form_factor: "mobile",
      // S2-7 section 1: the v1 command passed no preset, so Lighthouse emulated a phone. v1 kept
      // no report to confirm it; the re-measurement's reports record it for the same command.
      form_factor_source: "inferred from the v1 command, which passed no preset; v1 retained no report",
      run_window: timeWindow(lhTimes),
    },
    remeasurement: remeasurement(inputs.remeasurement),
    exclusions,
    pending,
    sites,
    stats: {
      rho: Object.fromEntries(agentIds.map((id) => [id, rhoFor(id, cellsFor(id))])),
      sensitivity: {
        rule: "b",
        excluded: ruleB,
        rule_d: "pending",
        by_agent: Object.fromEntries(agentIds.map((id) => [id, sensitivityFor(id, cellsFor(id), ruleB)])),
      },
      group_split: Object.fromEntries(
        agentIds.map((id) => [
          id,
          {
            published: toSplit(groupSplit(cellsFor(id))),
            rule_b: toSplit(groupSplit(cellsFor(id), ruleB)),
            vector: `study_v2/group_split/${id}`,
            ts: `${TS_STUDY}#groupSplit`,
            py: `${PY}#group_split`,
          },
        ])
      ),
      model_gap: modelGap(agentIds, cellsFor),
      layout_shift: layoutShift([...lhBySite.values()]),
    },
    artifacts: [...inputs.artifacts].sort((a, b) => cmp(a.path, b.path)),
  };
}

function siteResult(siteRuns: Run[]): SiteAgentResult {
  const measured = measuredRuns(siteRuns);
  const measuredSet = new Set(measured);
  const steps = mean(measured.map((r) => r.step_count));
  return {
    k: measured.filter((r) => r.success).length,
    n: measured.length,
    excluded: siteRuns.length - measured.length,
    mean_steps: steps === null ? null : Math.round(steps * 10) / 10,
    outcomes: siteRuns.map((r) => ({
      trial: r.trial_number,
      success: r.success,
      failure_mode: r.failure_mode,
      measured: measuredSet.has(r),
    })),
  };
}

export function v1AuditStates(
  lh: Pick<LighthouseResult, "lh_accessibility_tree" | "lh_layout_stability" | "lh_llms_txt" | "lh_webmcp">
): V1AuditStates {
  return {
    a11y_tree: lh.lh_accessibility_tree === 1 ? "pass" : "fail",
    cls: lh.lh_layout_stability === 1 ? "1.00" : "below_1.00",
    llms_txt: lh.lh_llms_txt === 1 ? "pass" : "fail_or_na",
    webmcp: lh.lh_webmcp === 1 ? "applied" : "not_applicable",
  };
}

function rhoFor(agentId: string, cells: SiteCell[]): EditionInterval {
  const pairs: Pair[] = cells
    .filter((c) => c.n > 0 && c.lh_total !== null)
    .map((c) => ({ x: c.lh_total!, y: c.k / c.n }));
  const ci = bootstrapCI(pairs, spearmanRho);
  if (ci === null) throw new Error(`No correlation for ${agentId}: fewer than MIN_N measured sites.`);
  return {
    point: ci.point,
    lo: ci.lo,
    hi: ci.hi,
    n: pairs.length,
    vector: `v1/${agentId}/spearman_ci`,
    ts: `${TS_STATS}#bootstrapCI`,
    py: `${PY}#bootstrap_ci`,
  };
}

function sensitivityFor(agentId: string, cells: SiteCell[], excluded: string[]): EditionInterval {
  const result = sensitivity(cells, excluded);
  if (result === null) throw new Error(`No sensitivity for ${agentId}.`);
  return {
    point: result.ci.point,
    lo: result.ci.lo,
    hi: result.ci.hi,
    n: result.n,
    vector: `study_v2/sensitivity/${agentId}/rule_b`,
    ts: `${TS_STUDY}#sensitivity`,
    py: `${PY}#sensitivity`,
  };
}

function toSplit(split: GroupSplit): EditionSplit {
  const group = (g: SplitGroup): EditionGroup => ({
    sites: g.sites,
    count: g.count,
    mean: g.mean,
    min: g.min,
    max: g.max,
  });
  return {
    excluded: split.excluded,
    unmeasured: split.unmeasured,
    all_succeeded: group(split.all_succeeded),
    all_failed: group(split.all_failed),
  };
}

function modelGap(
  agentIds: string[],
  cellsFor: (id: string) => SiteCell[]
): EditionStats["model_gap"] {
  const [first, second] = agentIds;
  if (!first || !second) throw new Error("The model gap needs two published agents.");
  const byId = new Map(cellsFor(second).map((c) => [c.site_id, c]));
  const rows = cellsFor(first)
    .filter((c) => c.n > 0 && (byId.get(c.site_id)?.n ?? 0) > 0)
    .map((c) => ({ site_id: c.site_id, k1: c.k, n1: c.n, k2: byId.get(c.site_id)!.k, n2: byId.get(c.site_id)!.n }));
  const ci = bootstrapRows(
    rows,
    (r) => r.site_id,
    (sample) => mean(sample.map((r) => r.k2 / r.n2 - r.k1 / r.n1))
  );
  if (ci === null) throw new Error("No model-gap interval.");
  return {
    arms: [first, second],
    point: ci.point,
    lo: ci.lo,
    hi: ci.hi,
    n: rows.length,
    sites_moved: rows.filter((r) => r.k1 !== r.k2).length,
    vector: "study_v2/bootstrap_rows/v1_model_gap",
    ts: `${TS_STATS}#bootstrapRows`,
    py: `${PY}#bootstrap_rows`,
  };
}

function layoutShift(rows: LighthouseResult[]): EditionStats["layout_shift"] {
  const decomposition = clsDecomposition(rows);
  const rho = decomposition.rho_lh_total_cls;
  const span = decomposition.identical_input.span;
  if (rho === null || span === null) throw new Error("No layout-shift decomposition.");
  return {
    rho: { min: rho.min, median: rho.median, max: rho.max, n: rho.n },
    assignments: decomposition.assignments,
    identical_input: { count: decomposition.identical_input.sites.length, min: span.min, max: span.max },
    vector: "x_axis_decomposition",
    ts: `${TS_X_AXIS}#clsDecomposition`,
    py: `${PY}#cls_decomposition`,
  };
}

function remeasurement(batches: RemeasurementBatchInput[]): EditionRemeasurement | null {
  const pinned = batches[0];
  if (!pinned) return null;
  const date = pinned.label.match(/(\d{4})(\d{2})(\d{2})/);
  return {
    date: date ? `${date[1]}-${date[2]}-${date[3]}` : "",
    pinned_batch: pinned.label,
    batches: batches.map((b) => {
      const rows = Object.values(b.panel);
      const versions = [...new Set(rows.map((r) => r.lighthouse_version).filter((v) => v !== null))];
      return {
        label: b.label,
        lighthouse_version: versions.length === 1 ? versions[0] : null,
        form_factor: b.form_factor,
        audit_ids: [...b.audit_ids].sort(),
        run_window: timeWindow(rows.map((r) => r.run_at).sort()),
      };
    }),
    sites: Object.fromEntries(
      Object.keys(pinned.panel)
        .sort()
        .map((id) => {
          const r = pinned.panel[id];
          return [
            id,
            {
              lh_total: r.lh_total,
              lh_passed: r.lh_passed,
              lh_passable: r.lh_passable,
              llms_txt: r.lh_llms_txt_status,
              webmcp_applied: r.lh_webmcp_applied === null ? null : r.lh_webmcp_applied === 1,
              webmcp_tools: r.lh_webmcp_tool_count,
            },
          ];
        })
    ),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function timeWindow(sorted: string[]): { first: string; last: string } | null {
  return sorted.length > 0 ? { first: sorted[0], last: sorted[sorted.length - 1] } : null;
}

function lastError(run: Run): string | null {
  const steps = Array.isArray(run.transcript) ? run.transcript : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const error = steps[i]?.error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return null;
}

function firstLine(text: string | null): string | null {
  if (text === null) return null;
  return text.split("\n")[0].trim() || null;
}

/**
 * The date a registration block in docs/METHODOLOGY.md carries: the first heading matching
 * `pattern`, dated by its own YYYY-MM-DD or else by the nearest enclosing heading that has one.
 * Null when no such heading exists yet. Reads headings only, so the block's prose can change
 * without moving the date.
 */
export function findRegistrationDate(markdown: string, pattern: RegExp): string | null {
  const dated: (string | null)[] = [];
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const level = heading[1].length;
    const text = heading[2];
    const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null;
    dated.length = level;
    dated[level - 1] = date;
    if (pattern.test(text)) {
      for (let i = level - 1; i >= 0; i--) if (dated[i]) return dated[i];
      return null;
    }
  }
  return null;
}

/** Walk a slash-separated key path ("v1/gemini-3.6-flash/spearman_ci") into the vector file. */
export function resolveVectorPath(vectors: unknown, path: string): unknown {
  let node: unknown = vectors;
  for (const key of path.split("/")) {
    if (node === null || typeof node !== "object" || !(key in (node as object))) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Every `vector` path the snapshot cites. */
export function vectorPaths(snapshot: EditionSnapshot): string[] {
  const paths = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "vector" && typeof value === "string") paths.add(value);
        else walk(value);
      }
    }
  };
  walk(snapshot);
  return [...paths].sort();
}

const PRECISION = 1e-12;

/**
 * The snapshot's numbers against the pinned Python vectors. Returns one line per disagreement;
 * empty means the snapshot says exactly what both implementations say.
 */
export function checkAgainstVectors(snapshot: EditionSnapshot, vectors: unknown): string[] {
  const problems: string[] = [];
  const at = (path: string) => resolveVectorPath(vectors, path) as Record<string, unknown> | undefined;
  const num = (label: string, actual: number | null, expected: unknown) => {
    if (typeof expected !== "number" || actual === null || Math.abs(actual - expected) > PRECISION) {
      problems.push(`${label}: snapshot ${actual}, vector ${String(expected)}`);
    }
  };
  const same = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${label}: snapshot ${JSON.stringify(actual)}, vector ${JSON.stringify(expected)}`);
    }
  };

  for (const path of vectorPaths(snapshot)) {
    if (resolveVectorPath(vectors, path) === undefined) problems.push(`${path}: not in stats-vectors.json`);
  }

  for (const agent of snapshot.agents) {
    const v = at(agent.vector);
    num(`${agent.vector}/trials`, agent.trials, v?.trials);
    num(`${agent.vector}/successes`, agent.successes, v?.successes);
    num(`${agent.vector}/n`, agent.measured_sites, v?.n);
    same(`${agent.vector}/unmeasured_sites`, agent.unmeasured_sites, v?.unmeasured_sites);
  }

  for (const [agentId, rho] of Object.entries(snapshot.stats.rho)) {
    const v = at(rho.vector);
    num(`${rho.vector}/point`, rho.point, v?.point);
    num(`${rho.vector}/lo`, rho.lo, v?.lo);
    num(`${rho.vector}/hi`, rho.hi, v?.hi);
    num(`v1/${agentId}/n`, rho.n, at(`v1/${agentId}`)?.n);
  }

  const sens = snapshot.stats.sensitivity;
  same("study_v2/exclusions/rule_b", sens.excluded, resolveVectorPath(vectors, "study_v2/exclusions/rule_b"));
  for (const entry of snapshot.exclusions) {
    const list = resolveVectorPath(vectors, entry.vector);
    if (!Array.isArray(list) || !list.includes(entry.site_id)) {
      problems.push(`${entry.vector}: does not list ${entry.site_id}`);
    }
  }
  for (const s of Object.values(sens.by_agent)) {
    const v = at(s.vector);
    const ci = v?.ci as Record<string, unknown> | undefined;
    num(`${s.vector}/n`, s.n, v?.n);
    num(`${s.vector}/rho`, s.point, v?.rho);
    num(`${s.vector}/ci/lo`, s.lo, ci?.lo);
    num(`${s.vector}/ci/hi`, s.hi, ci?.hi);
  }

  for (const split of Object.values(snapshot.stats.group_split)) {
    for (const list of ["published", "rule_b"] as const) {
      const v = at(`${split.vector}/${list}`);
      for (const group of ["all_succeeded", "all_failed"] as const) {
        const g = split[list][group];
        const vg = v?.[group] as Record<string, unknown> | undefined;
        const label = `${split.vector}/${list}/${group}`;
        same(`${label}/sites`, g.sites, vg?.sites);
        num(`${label}/count`, g.count, vg?.count);
        num(`${label}/mean`, g.mean, vg?.mean);
        num(`${label}/min`, g.min, vg?.min);
        num(`${label}/max`, g.max, vg?.max);
      }
    }
  }

  const gap = snapshot.stats.model_gap;
  const vgap = at(gap.vector);
  const vci = vgap?.ci as Record<string, unknown> | undefined;
  same(`${gap.vector}/arms`, gap.arms, vgap?.arms);
  num(`${gap.vector}/n`, gap.n, vgap?.n);
  num(`${gap.vector}/sites_moved`, gap.sites_moved, vgap?.sites_moved);
  num(`${gap.vector}/ci/point`, gap.point, vci?.point);
  num(`${gap.vector}/ci/lo`, gap.lo, vci?.lo);
  num(`${gap.vector}/ci/hi`, gap.hi, vci?.hi);

  const ls = snapshot.stats.layout_shift;
  const vls = at(ls.vector);
  const vrho = vls?.rho_lh_total_cls as Record<string, unknown> | undefined;
  const videntical = vls?.identical_input as { sites?: unknown[]; span?: Record<string, unknown> } | undefined;
  num(`${ls.vector}/rho_lh_total_cls/min`, ls.rho.min, vrho?.min);
  num(`${ls.vector}/rho_lh_total_cls/median`, ls.rho.median, vrho?.median);
  num(`${ls.vector}/rho_lh_total_cls/max`, ls.rho.max, vrho?.max);
  num(`${ls.vector}/rho_lh_total_cls/n`, ls.rho.n, vrho?.n);
  num(`${ls.vector}/assignments`, ls.assignments, vls?.assignments);
  num(`${ls.vector}/identical_input/count`, ls.identical_input.count, videntical?.sites?.length);
  num(`${ls.vector}/identical_input/span/min`, ls.identical_input.min, videntical?.span?.min);
  num(`${ls.vector}/identical_input/span/max`, ls.identical_input.max, videntical?.span?.max);

  return problems;
}
