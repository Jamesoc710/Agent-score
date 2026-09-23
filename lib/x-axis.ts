// The x-axis decomposition exhibit (design/s2-7-x-axis.md, section 8). Pure functions over the
// committed v1 Lighthouse rows, no data access.
//
// v1 retained no Lighthouse reports, so the continuous CLS score behind each site's category
// mean has to be solved back from the arithmetic Lighthouse used: the mean over the audits that
// applied, clamped to two decimals, times 100, rounded. Which audits applied is not recorded
// either, so for some sites two denominators fit the row and the CLS score is a pair of
// candidates rather than a number. Nothing here picks one: every statistic over the implied
// scores is reported as a range over all the assignments the rows allow.
//
// Mirrored in scripts/stats_reference.py and pinned in scripts/tests/stats-vectors.json under
// `x_axis_decomposition`. Types are local; lib/types.ts is untouched.

import { TIE_EPSILON, meanGap, median, spearmanRho, type Pair } from "./stats";

// ---------------------------------------------------------------------------
// Implied CLS per site
// ---------------------------------------------------------------------------

/** A v1 Lighthouse row as data/lighthouse-v1.json records it. */
export interface LighthouseFlagsRow {
  site_id: string;
  lh_total: number;
  lh_accessibility_tree: number;
  lh_layout_stability: number;
  lh_llms_txt: number;
  lh_webmcp: number;
}

/**
 * Half of one hundredth: the category score was clamped to two decimals before the row's
 * integer was taken, so the recorded mean is only known to within this on either side.
 */
export const ROUNDING_SLACK = 0.005;

export interface ClsCandidate {
  /** Audits in the mean: accessibility tree and CLS, plus llms.txt at 3, plus schema validity at 4. */
  denominator: 2 | 3 | 4;
  /** The schema-validity score assumed at denominator 4; null otherwise. */
  schema: 0 | 1 | null;
  /** The CLS score consistent with the row, clamped to [0, 1]. */
  cls: number;
  /** The interval the rounding slack allows, clamped to [0, 1]. */
  lo: number;
  hi: number;
}

export interface ImpliedCls {
  candidates: ClsCandidate[];
  /** Distinct CLS scores across the candidates, ascending. */
  values: number[];
  /** Exactly one value fits the row. */
  resolved: boolean;
  /** The value when resolved, else null. */
  cls: number | null;
}

/**
 * For denominators 2, 3 and 4, the CLS score consistent with
 * lh_total = round(100 * clamp2((a11y + cls [+ llms] [+ schema]) / d)) given the recorded flags.
 *
 * The llms.txt flag is the audit's score when it applied, so a passing flag forces it into the
 * denominator; a failing flag fits either an applied-and-failed audit (d = 3) or an absent one
 * (d = 2). Schema validity applies only when the WebMCP API was exposed, which v1 recorded as
 * the lh_webmcp flag, and its score was not recorded, so both are tried. A candidate is kept
 * when the interval the rounding slack allows meets [0, 1]. The layout-stability flag is not an
 * input: it is what the reconstruction checks.
 */
export function impliedCls(row: LighthouseFlagsRow): ImpliedCls {
  const t = row.lh_total / 100;
  const candidates: ClsCandidate[] = [];

  const consider = (denominator: 2 | 3 | 4, base: number, schema: 0 | 1 | null) => {
    const point = t * denominator - base;
    const lo = (t - ROUNDING_SLACK) * denominator - base;
    const hi = (t + ROUNDING_SLACK) * denominator - base;
    if (hi < -TIE_EPSILON || lo > 1 + TIE_EPSILON) return;
    candidates.push({
      denominator,
      schema,
      cls: clamp01(point),
      lo: clamp01(lo),
      hi: clamp01(hi),
    });
  };

  const a11y = row.lh_accessibility_tree;
  const llms = row.lh_llms_txt;
  if (llms !== 1) consider(2, a11y, null);
  consider(3, a11y + llms, null);
  if (row.lh_webmcp === 1) {
    consider(4, a11y + llms, 0);
    consider(4, a11y + llms + 1, 1);
  }

  const values = [...new Set(candidates.map((c) => c.cls))].sort((a, b) => a - b);
  return {
    candidates,
    values,
    resolved: values.length === 1,
    cls: values.length === 1 ? values[0] : null,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// The decomposition over the cohort
// ---------------------------------------------------------------------------

export interface Range {
  min: number;
  median: number;
  max: number;
}

export interface ClsDecomposition {
  /** Rows in canonical order, by site id. */
  sites: { site_id: string; lh_total: number; implied: ImpliedCls }[];
  resolved: string[];
  ambiguous: { site_id: string; values: number[] }[];
  /** Rows no denominator fits. Excluded from every statistic and named. */
  inconsistent: string[];
  /**
   * Sites identical on every agent-specific input the category records: accessibility tree
   * failed, llms.txt not passed, WebMCP not applied. Their category means differ only by CLS.
   */
  identical_input: { sites: string[]; span: { min: number; max: number } | null };
  /** Number of ways to assign the ambiguous sites; every range below is over all of them. */
  assignments: number;
  /** Spearman rho between the category mean and the implied CLS, over the assignments. */
  rho_lh_total_cls: (Range & { n: number }) | null;
}

/**
 * The implied CLS score of every row, which sites it resolves and which it does not, the
 * identical-input set with its span, and rho(lh_total, CLS) as a range over every assignment
 * of the ambiguous sites.
 */
export function clsDecomposition(rows: LighthouseFlagsRow[]): ClsDecomposition {
  const sites = [...rows]
    .sort((a, b) => (a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0))
    .map((row) => ({ site_id: row.site_id, lh_total: row.lh_total, implied: impliedCls(row) }));

  const resolved = sites.filter((s) => s.implied.resolved).map((s) => s.site_id);
  const ambiguous = sites
    .filter((s) => s.implied.values.length > 1)
    .map((s) => ({ site_id: s.site_id, values: s.implied.values }));
  const inconsistent = sites.filter((s) => s.implied.values.length === 0).map((s) => s.site_id);

  const identical = rows
    .filter((r) => r.lh_accessibility_tree === 0 && r.lh_llms_txt === 0 && r.lh_webmcp === 0)
    .map((r) => ({ site_id: r.site_id, lh_total: r.lh_total }))
    .sort((a, b) => (a.site_id < b.site_id ? -1 : 1));
  let span: { min: number; max: number } | null = null;
  for (const site of identical) {
    if (span === null) span = { min: site.lh_total, max: site.lh_total };
    else {
      if (site.lh_total < span.min) span.min = site.lh_total;
      if (site.lh_total > span.max) span.max = site.lh_total;
    }
  }

  const decomposition: ClsDecomposition = {
    sites,
    resolved,
    ambiguous,
    inconsistent,
    identical_input: { sites: identical.map((s) => s.site_id), span },
    assignments: ambiguous.reduce((product, site) => product * site.values.length, 1),
    rho_lh_total_cls: null,
  };

  const usable = sites.filter((s) => s.implied.values.length > 0);
  const rhos: number[] = [];
  for (const assignment of clsAssignments(decomposition)) {
    const rho = spearmanRho(usable.map((s) => ({ x: s.lh_total, y: assignment[s.site_id] })));
    if (rho !== null) rhos.push(rho);
  }
  decomposition.rho_lh_total_cls = rhos.length === 0 ? null : { ...range(rhos)!, n: usable.length };
  return decomposition;
}

/**
 * Every assignment of a CLS score to every consistent site, as a list of site -> score maps.
 * Ambiguous sites are enumerated in site-id order with the first as the fastest-varying digit
 * and each site's values in ascending order, so index i means the same assignment on both
 * sides of the contract.
 */
export function clsAssignments(decomposition: ClsDecomposition): Record<string, number>[] {
  const fixed: Record<string, number> = {};
  for (const site of decomposition.sites) {
    if (site.implied.resolved) fixed[site.site_id] = site.implied.cls!;
  }
  const out: Record<string, number>[] = [];
  for (let index = 0; index < decomposition.assignments; index++) {
    const assignment = { ...fixed };
    let rest = index;
    for (const site of decomposition.ambiguous) {
      assignment[site.site_id] = site.values[rest % site.values.length];
      rest = Math.floor(rest / site.values.length);
    }
    out.push(assignment);
  }
  return out;
}

function range(values: number[]): Range | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, median: median(values)!, max };
}

// ---------------------------------------------------------------------------
// The CLS pass rule as a sensitivity
// ---------------------------------------------------------------------------

/** Lighthouse's own display rule: an audit shows as passed at score >= 0.9. */
export const LIGHTHOUSE_PASS_THRESHOLD = 0.9;

export interface ClsAlternativeRule {
  threshold: number;
  /** Sites with both an implied CLS and an outcome. */
  n: number;
  assignments: number;
  /** Every [passing, failing] split the assignments produced, ascending by passing count. */
  splits: [number, number][];
  /** Mean success-rate gap, passing minus failing, as a fraction, over the assignments. */
  gap: Range | null;
  /** Spearman rho between the implied CLS and the site rate, over the assignments. */
  rho_cls_rate: Range | null;
}

/**
 * The v1 CLS row recomputed under Lighthouse's pass rule instead of the project's `=== 1`,
 * as a range over the assignments: the alternative-rule sensitivity the appended CLS block
 * quotes. Also rho(CLS, site rate), exploratory: a correlation against v1's y-axis looked at
 * after the fact, a declared member only if a future family includes it.
 */
export function clsAlternativeRule(
  decomposition: ClsDecomposition,
  outcomes: { site_id: string; success_rate: number }[],
  threshold: number = LIGHTHOUSE_PASS_THRESHOLD
): ClsAlternativeRule {
  const rateBySite = new Map(outcomes.map((o) => [o.site_id, o.success_rate]));
  const sites = decomposition.sites.filter(
    (s) => s.implied.values.length > 0 && rateBySite.has(s.site_id)
  );

  const gaps: number[] = [];
  const rhos: number[] = [];
  const splits = new Map<string, [number, number]>();
  for (const assignment of clsAssignments(decomposition)) {
    const pairs: Pair[] = sites.map((s) => ({
      x: assignment[s.site_id] >= threshold - TIE_EPSILON ? 1 : 0,
      y: rateBySite.get(s.site_id)!,
    }));
    const ones = pairs.filter((p) => p.x === 1).length;
    splits.set(`${ones}`, [ones, pairs.length - ones]);
    const gap = meanGap(pairs);
    if (gap !== null) gaps.push(gap);
    const rho = spearmanRho(sites.map((s) => ({ x: assignment[s.site_id], y: rateBySite.get(s.site_id)! })));
    if (rho !== null) rhos.push(rho);
  }

  return {
    threshold,
    n: sites.length,
    assignments: decomposition.assignments,
    splits: [...splits.values()].sort((a, b) => a[0] - b[0]),
    gap: range(gaps),
    rho_cls_rate: range(rhos),
  };
}
