// The reconstruction check (design S2-7 §5). Pure: the CLI is scripts/lane1-reconstruct.ts.
//
// For every site, the lh-v2 median repeat is extracted in v1 mode (`=== 1`, null to 0) from its
// retained LHR and compared with data/lighthouse-v1.json: the four flags and lh_total. A row
// matches or differs; a difference carries reasons from a fixed enum. v1 kept no LHR, so v1's
// denominator is inferred: every set of weighted audits, with a CLS score, that reproduces v1's
// recorded lh_total and flags under Lighthouse 13.3.0's arithmetic (A3 F2), is "v1-consistent".
// The observed denominator is then either in that set or not, which is how a changed
// /llms.txt shows up even where the flag did not move.

import { AUDIT_IDS, CATEGORY_ID, extractLighthouseRow, type LighthouseFlags, type Lhr } from "./lane1-extract";

export type ReconstructionReason =
  | "llms_status_changed"
  | "cls_moved"
  | "webmcp_applicability"
  | "unexplained";

export const FLAG_FIELDS = [
  "lh_accessibility_tree",
  "lh_layout_stability",
  "lh_llms_txt",
  "lh_webmcp",
] as const;

export type Comparable = Pick<LighthouseFlags, "lh_total" | (typeof FLAG_FIELDS)[number]>;

export interface Denominator {
  weighted_audits: string[];
  size: number;
}

export interface V1Configuration extends Denominator {
  /** The CLS scores (two decimals) that reproduce v1's lh_total with this denominator. */
  cls_score_min: number;
  cls_score_max: number;
}

export interface SiteReconstruction {
  site_id: string;
  status: "match" | "differ" | "not_measured";
  lhr: string | null;
  v1: Comparable;
  v2: Comparable | null;
  differences: { field: keyof Comparable; v1: number; v2: number; reasons: ReconstructionReason[] }[];
  reasons: ReconstructionReason[];
  observed_denominator: Denominator | null;
  v1_consistent_denominators: V1Configuration[];
  observed_in_v1_set: boolean | null;
  evidence: Record<string, unknown>;
}

// Lighthouse's category arithmetic (core/scoring.js): the weighted mean clamped to two
// decimals, then Lane 1's Math.round(score * 100). Scores are summed in auditRefs order.
function laneTotal(scores: number[]): number {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const category = Math.round(mean * 100) / 100;
  return Math.round(category * 100);
}

/**
 * Every 13.3.0 denominator consistent with a v1 row. At 13.3.0 the accessibility-tree and CLS
 * audits always count; llms-txt counts unless its fetch returned 4xx; webmcp-schema-validity
 * counts only when the browser exposed WebMCP (v1's lh_webmcp 1) and tools or issues existed.
 * The two informative WebMCP audits never count.
 */
export function v1ConsistentDenominators(v1: Comparable): V1Configuration[] {
  const llmsOptions: (number | null)[] = v1.lh_llms_txt === 1 ? [1] : [null, 0];
  const schemaOptions: (number | null)[] = v1.lh_webmcp === 1 ? [null, 0, 0.5, 1] : [null];
  const clsOptions: number[] = [];
  for (let k = 0; k <= 100; k++) {
    const s = Math.round(k) / 100;
    if (v1.lh_layout_stability === 1 ? s === 1 : s < 1) clsOptions.push(s);
  }

  const bySet = new Map<string, V1Configuration>();
  for (const schema of schemaOptions) {
    for (const llms of llmsOptions) {
      const weighted = [
        AUDIT_IDS.accessibilityTree,
        ...(schema === null ? [] : [AUDIT_IDS.webmcpSchema]),
        AUDIT_IDS.cls,
        ...(llms === null ? [] : [AUDIT_IDS.llmsTxt]),
      ];
      for (const cls of clsOptions) {
        const scores = [
          v1.lh_accessibility_tree,
          ...(schema === null ? [] : [schema]),
          cls,
          ...(llms === null ? [] : [llms]),
        ];
        if (laneTotal(scores) !== v1.lh_total) continue;
        const key = weighted.join(",");
        const prior = bySet.get(key);
        bySet.set(key, {
          weighted_audits: weighted,
          size: weighted.length,
          cls_score_min: prior ? Math.min(prior.cls_score_min, cls) : cls,
          cls_score_max: prior ? Math.max(prior.cls_score_max, cls) : cls,
        });
      }
    }
  }
  return [...bySet.values()];
}

export function observedDenominator(lhr: Lhr): Denominator {
  const refs = lhr.categories?.[CATEGORY_ID]?.auditRefs ?? [];
  const weighted = refs.filter((r) => r.weight > 0).map((r) => r.id);
  return { weighted_audits: weighted, size: weighted.length };
}

const WEBMCP_AUDITS: string[] = [AUDIT_IDS.webmcpSchema, AUDIT_IDS.webmcpForms, AUDIT_IDS.webmcpTools];

function membershipReasons(observed: string[], v1: string[]): ReconstructionReason[] {
  const a = new Set(observed);
  const b = new Set(v1);
  const changed = [...new Set([...a, ...b])].filter((id) => a.has(id) !== b.has(id));
  const reasons = new Set<ReconstructionReason>();
  for (const id of changed) {
    if (id === AUDIT_IDS.llmsTxt) reasons.add("llms_status_changed");
    else if (WEBMCP_AUDITS.includes(id)) reasons.add("webmcp_applicability");
    else reasons.add("unexplained");
  }
  return [...reasons];
}

const FIELD_REASON: Record<(typeof FLAG_FIELDS)[number], ReconstructionReason> = {
  lh_accessibility_tree: "unexplained",
  lh_layout_stability: "cls_moved",
  lh_llms_txt: "llms_status_changed",
  lh_webmcp: "webmcp_applicability",
};

export function reconstructSite(
  siteId: string,
  v1: Comparable,
  median: { lhr: Lhr; path: string } | null,
  evidence: Record<string, unknown> = {}
): SiteReconstruction {
  const v1Only: Comparable = pickComparable(v1);
  const configs = v1ConsistentDenominators(v1Only);
  if (!median) {
    return {
      site_id: siteId,
      status: "not_measured",
      lhr: null,
      v1: v1Only,
      v2: null,
      differences: [],
      reasons: [],
      observed_denominator: null,
      v1_consistent_denominators: configs,
      observed_in_v1_set: null,
      evidence,
    };
  }

  const extracted = extractLighthouseRow(median.lhr, { clsRule: "v1" });
  const v2 = pickComparable(extracted);
  const observed = observedDenominator(median.lhr);
  const key = observed.weighted_audits.join(",");
  const sameSet = configs.find((c) => c.weighted_audits.join(",") === key) ?? null;

  const differences: SiteReconstruction["differences"] = [];
  for (const field of FLAG_FIELDS) {
    if (v1Only[field] !== v2[field]) {
      differences.push({ field, v1: v1Only[field], v2: v2[field], reasons: [FIELD_REASON[field]] });
    }
  }

  if (v1Only.lh_total !== v2.lh_total) {
    let reasons: ReconstructionReason[];
    if (!sameSet) {
      // The denominator moved: attribute it to the audits whose membership differs from the
      // closest v1-consistent configuration.
      const candidates = configs.map((c) => membershipReasons(observed.weighted_audits, c.weighted_audits));
      reasons = candidates.length > 0
        ? candidates.reduce((best, r) => (r.length < best.length ? r : best))
        : ["unexplained"];
    } else {
      const set = new Set<ReconstructionReason>();
      const cls = extracted.lh_cls_score;
      if (cls !== null && (cls < sameSet.cls_score_min || cls > sameSet.cls_score_max)) set.add("cls_moved");
      for (const d of differences) {
        if (d.field !== "lh_webmcp") d.reasons.forEach((r) => set.add(r));
      }
      reasons = set.size > 0 ? [...set] : ["unexplained"];
    }
    differences.push({ field: "lh_total", v1: v1Only.lh_total, v2: v2.lh_total, reasons });
  }

  const reasons = [...new Set(differences.flatMap((d) => d.reasons))];
  return {
    site_id: siteId,
    status: differences.length === 0 ? "match" : "differ",
    lhr: median.path,
    v1: v1Only,
    v2,
    differences,
    reasons,
    observed_denominator: observed,
    v1_consistent_denominators: configs,
    observed_in_v1_set: sameSet !== null,
    evidence: {
      lh_cls_score: extracted.lh_cls_score,
      lh_llms_txt_status: extracted.lh_llms_txt_status,
      lh_llms_txt_reasons: extracted.lh_llms_txt_reasons,
      lh_webmcp_applied: extracted.lh_webmcp_applied,
      webmcp_registered_tools_mode: median.lhr.audits?.[AUDIT_IDS.webmcpTools]?.scoreDisplayMode ?? null,
      lighthouse_version: extracted.lighthouse_version,
      chrome_version: extracted.chrome_version,
      ...evidence,
    },
  };
}

function pickComparable(row: Comparable): Comparable {
  return {
    lh_total: row.lh_total,
    lh_accessibility_tree: row.lh_accessibility_tree,
    lh_layout_stability: row.lh_layout_stability,
    lh_llms_txt: row.lh_llms_txt,
    lh_webmcp: row.lh_webmcp,
  };
}

export function summarize(sites: SiteReconstruction[]) {
  const measured = sites.filter((s) => s.status !== "not_measured");
  const flagsCompared = measured.length * (FLAG_FIELDS.length + 1);
  const fieldDiffs = measured.reduce((n, s) => n + s.differences.length, 0);
  const reasonCounts: Record<string, number> = {};
  for (const s of measured) for (const r of s.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  return {
    sites: sites.length,
    measured: measured.length,
    match: measured.filter((s) => s.status === "match").length,
    differ: measured.filter((s) => s.status === "differ").length,
    not_measured: sites.filter((s) => s.status === "not_measured").map((s) => s.site_id),
    /** The four flags and lh_total per measured site. */
    values_compared: flagsCompared,
    values_reproduced: flagsCompared - fieldDiffs,
    flags_compared: measured.length * FLAG_FIELDS.length,
    flags_reproduced:
      measured.length * FLAG_FIELDS.length - measured.reduce((n, s) => n + s.differences.filter((d) => d.field !== "lh_total").length, 0),
    sites_by_reason: reasonCounts,
    unexplained: measured.filter((s) => s.reasons.includes("unexplained")).map((s) => s.site_id),
  };
}
