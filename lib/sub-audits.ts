// The sub-audit attribution analysis: which individual Lighthouse Agentic Browsing audit, if
// any, is associated with an agent actually completing a task.
//
// Pure logic, no data access — lib/stats.ts holds the statistics, this file knows about audits,
// agents and the cohort, and app/correlation/audits/page.tsx only renders what comes out.
// All types are local, so lib/types.ts (the frozen lane<->frontend contract) is untouched.
//
// Two rules run through it, both inherited from the rest of the project:
//
//  1. A comparison that cannot be reported returns null and says why, rather than a zero.
//  2. The wording follows the family-wise test, never the point estimate and never the
//     marginal interval. And it is "not distinguishable from noise", never "does not predict":
//     see `power` below — this cohort cannot physically produce a gap large enough for an
//     80%-powered test, so a measured null is no more available here than a measured finding.

import {
  DEFAULT_ITERATIONS,
  DEFAULT_SEED,
  MIN_GROUP,
  binaryGroupSizes,
  bootstrapCI,
  exactGapP,
  gapStandardError,
  maximumAttainableGap,
  mean,
  meanGap,
  minimumAttainableP,
  permutationFamily,
  powerThreshold,
  sitesForGap,
  spearmanRho,
  standardDeviation,
  subAuditGap,
  subAuditVerdict,
  twoProportionZ,
  type BootstrapResult,
  type ComparisonInput,
  type FamilyPermutation,
  type Pair,
  type SubAuditGap,
} from "./stats";

// ---------------------------------------------------------------------------
// The audits
// ---------------------------------------------------------------------------

export type AuditKey =
  | "lh_accessibility_tree"
  | "lh_layout_stability"
  | "lh_llms_txt"
  | "lh_webmcp";

export interface AuditDefinition {
  key: AuditKey;
  label: string;
  /** The real Lighthouse audit id, so a row is checkable against Lighthouse 13.3.0 itself. */
  lighthouseId: string;
}

/** Fixed order, by audit id. Sorting by effect size would encode a ranking as a result. */
export const AUDITS: AuditDefinition[] = [
  {
    key: "lh_accessibility_tree",
    label: "Accessibility tree",
    lighthouseId: "agent-accessibility-tree",
  },
  {
    key: "lh_layout_stability",
    label: "Layout stability",
    lighthouseId: "cumulative-layout-shift",
  },
  { key: "lh_llms_txt", label: "llms.txt", lighthouseId: "llms-txt" },
  { key: "lh_webmcp", label: "WebMCP", lighthouseId: "webmcp-registered-tools" },
];

export const ALPHA = 0.05;

/** The cohort tier the confound section tests against. */
export const ANCHOR_TIER = "anchor";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface AuditSitePoint {
  site_id: string;
  name: string;
  /** Cohort design bucket. The confound analysis permutes within this. */
  tier: string;
  success_rate: number;
  /** Measured trials. 0 means the site was attempted and never reached — no measurement. */
  trial_count: number;
  lh_accessibility_tree: number;
  lh_layout_stability: number;
  lh_llms_txt: number;
  lh_webmcp: number;
}

export interface AgentPoints {
  agent_id: string;
  /** Every site with a Lighthouse score, measured or not. Unmeasured ones are filtered here. */
  points: AuditSitePoint[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface AuditRow extends AuditDefinition {
  groups: { ones: number; zeros: number };
  /** Null when the split is degenerate — fewer than MIN_GROUP sites on one side. */
  estimate: SubAuditGap | null;
  /** Uncorrected Monte-Carlo permutation p. Null when the audit is not in the family. */
  pUnadjusted: number | null;
  /** Uncorrected exact permutation p, by enumeration. Null when not enumerable. */
  pExact: number | null;
  /** Family-wise (Westfall-Young maxT) p. The only p the wording is allowed to follow. */
  pFamilyWise: number | null;
  /** Bonferroni on the uncorrected p, shown because a reader can check it by hand. */
  pBonferroni: number | null;
  verdict: "distinguishable" | "not-distinguishable" | "not-reportable";
  /**
   * For a degenerate split: the smallest p ANY arrangement of this split could have produced.
   * Above the level, the comparison was unfalsifiable rather than merely unresolved.
   */
  minimumAttainableP: number | null;
  /** For a degenerate split: what the ungated estimator would have claimed. */
  degenerate: { gap: number; ci: BootstrapResult } | null;
}

export interface AgentAuditRows {
  agent_id: string;
  siteCount: number;
  rows: AuditRow[];
}

export interface PowerReport {
  agent_id: string;
  overallRate: number;
  sd: number;
  /** The split the power statement is made at — the family's narrowest, llms.txt at 6/21. */
  split: { ones: number; zeros: number };
  se: number;
  criticalValue: number;
  threshold80: number;
  maxAttainableGap: number;
  /** False when the ceiling is below the 80%-power threshold: nothing was detectable. */
  detectableAt80: boolean;
  sitesAtExtremes: number;
}

export interface SizingRow {
  gap: number;
  prevalence: number;
  power: number;
  sites: number;
}

export interface ConfoundReport {
  passingSites: { site_id: string; name: string; tier: string }[];
  anchorsWithout: string[];
  anchorCount: number;
  pseudoAudit: {
    agent_id: string;
    groups: { ones: number; zeros: number };
    gap: number;
    ci: BootstrapResult;
    /** True when the pseudo-audit and llms.txt are the same variable on this agent's data. */
    identicalToLlmsTxt: boolean;
  }[];
  stratified: FamilyPermutation;
  withinAnchor: {
    agent_id: string;
    groups: { ones: number; zeros: number };
    gap: number | null;
  }[];
}

export interface UnitOfAnalysisRow {
  key: AuditKey;
  label: string;
  successesPass: number;
  trialsPass: number;
  successesFail: number;
  trialsFail: number;
  trialZ: number;
  trialP: number;
  siteP: number;
  ratio: number;
}

export interface ExclusionSensitivityRow {
  key: AuditKey;
  label: string;
  excludedGap: number;
  excludedP: number;
  includedGap: number;
  includedP: number;
}

export interface PooledReport {
  rows: {
    key: AuditKey;
    label: string;
    gap: number;
    /** Null on a degenerate split — the MIN_GROUP gate applies here exactly as it does above. */
    ci: BootstrapResult | null;
    pExact: number;
  }[];
  betweenAgentSpearman: number | null;
  flipped: { site_id: string; name: string; first: number; second: number }[];
  agentIds: string[];
}

export interface SubAuditAnalysis {
  agents: AgentAuditRows[];
  siteCount: number;
  /**
   * The whole batch, measured or not, and how many of it passes each audit. Adoption is a fact
   * about the cohort rather than about the behavioral measurement, so it survives the exclusion
   * rule that removes never-reached sites from every estimate.
   */
  cohort: { siteCount: number; passing: Record<AuditKey, number> };
  /** Null when no audit has a reportable split — the honest empty state. */
  family: FamilyPermutation | null;
  power: PowerReport[] | null;
  sizing: SizingRow[] | null;
  confound: ConfoundReport | null;
  unitOfAnalysis: UnitOfAnalysisRow[] | null;
  exclusionSensitivity: ExclusionSensitivityRow[] | null;
  excludedSiteIds: string[];
  pooled: PooledReport | null;
  /** Trials per site, when every site has the same count. The exact-p denominator. */
  trialsPerSite: number | null;
}

// ---------------------------------------------------------------------------
// Calibration: frozen simulation output
//
// Both simulations are thousands of replicates over a 27-site cohort and cannot run inside a
// per-request page render. Their values are frozen here, mirrored in scripts/stats_reference.py,
// pinned in scripts/tests/stats-vectors.json, AND re-derived by lib/stats.test.ts, which runs
// the real simulation and fails if these constants have drifted from the code that produced
// them. Regenerate with `.venv/bin/python scripts/stats_reference.py --write`.
// ---------------------------------------------------------------------------

export interface CalibrationSplit {
  ones: number;
  zeros: number;
  /** Share of replicates where the bootstrap interval excluded zero under a true null. */
  bootstrap: number;
  /** Share where the exact permutation p cleared the level under a true null. */
  permutation: number;
}

export interface PowerDesign {
  sites: number;
  ones: number;
  zeros: number;
  power: number;
  meanGap: number;
}

export interface Calibration {
  falsePositive: {
    replicates: number;
    iterations: number;
    level: number;
    agents: Record<string, CalibrationSplit[]>;
  };
  power: {
    effect: number;
    trials: number;
    replicates: number;
    baseRateAgent: string;
    designs: PowerDesign[];
  };
}

export const CALIBRATION: Calibration = {
  falsePositive: {
    replicates: 1000,
    iterations: 2000,
    level: ALPHA,
    agents: {
      "gemini-3.5-flash-lite": [
        { ones: 12, zeros: 15, bootstrap: 0.063, permutation: 0.054 },
        { ones: 6, zeros: 21, bootstrap: 0.064, permutation: 0.034 },
        { ones: 1, zeros: 26, bootstrap: 0.901, permutation: 0 },
      ],
      "gemini-3.6-flash": [
        { ones: 12, zeros: 15, bootstrap: 0.06, permutation: 0.043 },
        { ones: 6, zeros: 21, bootstrap: 0.074, permutation: 0.048 },
        { ones: 1, zeros: 26, bootstrap: 0.92, permutation: 0 },
      ],
    },
  },
  power: {
    effect: 0.3,
    trials: 5,
    replicates: 20000,
    baseRateAgent: "gemini-3.5-flash-lite",
    designs: [
      { sites: 50, ones: 25, zeros: 25, power: 0.13785, meanGap: 0.17399399999999351 },
      { sites: 93, ones: 46, zeros: 47, power: 0.2929, meanGap: 0.17378569842738198 },
    ],
  },
};

/** Gaps and prevalences the sizing table reports. */
export const SIZING_GAPS = [0.3, 0.2];
export const SIZING_POWERS = [0.5, 0.8];

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

const FAMILY_AUDITS: AuditKey[] = AUDITS.map((a) => a.key);

/**
 * Everything /correlation/audits prints, from the panel's measured points.
 *
 * Sites with no measured trial are excluded from every estimate — the METHODOLOGY denominator
 * rule — and reappear only in `exclusionSensitivity`, which answers "what if you scored them 0%
 * instead?" out loud rather than waiting to be asked.
 */
export function analyzeSubAudits(
  panel: AgentPoints[],
  options: {
    seed?: number;
    iterations?: number;
    alpha?: number;
    /**
     * false: compute the family and the per-audit rows only, and leave every supporting section
     * null. /correlation renders a summary panel and does not need the confound test, the pooled
     * panel or the exclusion sensitivity — each of which is its own bootstrap or enumeration.
     */
    detail?: boolean;
  } = {}
): SubAuditAnalysis {
  const seed = options.seed ?? DEFAULT_SEED;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const alpha = options.alpha ?? ALPHA;
  const detail = options.detail ?? true;

  const agents = panel.map((agent) => ({
    agent_id: agent.agent_id,
    measured: agent.points.filter((p) => p.trial_count > 0),
    excluded: agent.points.filter((p) => p.trial_count === 0),
  }));

  const siteCount = agents[0]?.measured.length ?? 0;
  const excludedSiteIds = [
    ...new Set(agents.flatMap((a) => a.excluded.map((p) => p.site_id))),
  ].sort();

  const trialsPerSite = uniformTrialCount(agents.flatMap((a) => a.measured));

  const cohortPoints = panel[0]?.points ?? [];
  const cohort = {
    siteCount: cohortPoints.length,
    passing: Object.fromEntries(
      AUDITS.map((audit) => [audit.key, cohortPoints.filter((p) => p[audit.key] === 1).length])
    ) as Record<AuditKey, number>,
  };

  // --- the family -----------------------------------------------------------
  // Membership is decided by group size alone, before any outcome is looked at, and it spans
  // every published agent: both were examined, so both count against the correction.
  const familyMembers: { agent_id: string; key: AuditKey }[] = [];
  for (const agent of agents) {
    for (const key of FAMILY_AUDITS) {
      const groups = binaryGroupSizes(pairsFor(agent.measured, key));
      if (Math.min(groups.ones, groups.zeros) >= MIN_GROUP) {
        familyMembers.push({ agent_id: agent.agent_id, key });
      }
    }
  }
  const familySize = familyMembers.length;

  const comparisonInputs = (strata: boolean): ComparisonInput[] =>
    familyMembers.map(({ agent_id, key }) => {
      const points = agents.find((a) => a.agent_id === agent_id)!.measured;
      return {
        key: `${agent_id}|${key}`,
        siteIds: points.map((p) => p.site_id),
        predictor: points.map((p) => p[key]),
        outcome: points.map((p) => p.success_rate),
        ...(strata ? { strata: points.map((p) => p.tier) } : {}),
      };
    });

  const family =
    familySize === 0
      ? null
      : permutationFamily(comparisonInputs(false), gapStatistic, {
          iterations,
          seed,
          level: alpha,
        });

  const byKey = new Map((family?.comparisons ?? []).map((c) => [c.key, c]));

  // --- per-agent rows -------------------------------------------------------
  const agentRows: AgentAuditRows[] = agents.map((agent) => ({
    agent_id: agent.agent_id,
    siteCount: agent.measured.length,
    rows: AUDITS.map((definition) => {
      const pairs = pairsFor(agent.measured, definition.key);
      const groups = binaryGroupSizes(pairs);
      const estimate = subAuditGap(pairs, {
        familySize: Math.max(familySize, 1),
        alpha,
        seed,
        iterations,
      });
      const comparison = byKey.get(`${agent.agent_id}|${definition.key}`);
      const exact =
        trialsPerSite === null
          ? null
          : exactGapP(
              pairs.map((p) => p.x),
              pairs.map((p) => p.y),
              trialsPerSite
            );

      let degenerate: AuditRow["degenerate"] = null;
      let floor: number | null = null;
      if (estimate === null && Math.min(groups.ones, groups.zeros) >= 1) {
        const ungated = bootstrapCI(pairs, meanGap, { iterations, seed });
        if (ungated !== null) degenerate = { gap: ungated.point, ci: ungated };
        floor =
          trialsPerSite === null
            ? null
            : minimumAttainableP(
                pairs.map((p) => p.x),
                pairs.map((p) => p.y),
                trialsPerSite
              );
      }

      return {
        ...definition,
        groups,
        estimate,
        pUnadjusted: comparison?.pUnadjusted ?? null,
        pExact: exact?.p ?? null,
        pFamilyWise: comparison?.pFamilyWise ?? null,
        pBonferroni:
          comparison === undefined ? null : Math.min(1, comparison.pUnadjusted * familySize),
        verdict:
          comparison === undefined
            ? ("not-reportable" as const)
            : subAuditVerdict(comparison.pFamilyWise, alpha),
        minimumAttainableP: floor,
        degenerate,
      };
    }),
  }));

  if (family === null || !detail) {
    return {
      agents: agentRows,
      siteCount,
      cohort,
      family,
      power: null,
      sizing: null,
      confound: null,
      unitOfAnalysis: null,
      exclusionSensitivity: null,
      excludedSiteIds,
      pooled: null,
      trialsPerSite,
    };
  }

  // --- what this cohort could have detected ---------------------------------
  // Stated at the family's narrowest reportable split, which is the one that binds.
  const power: PowerReport[] = agents.map((agent) => {
    const outcome = agent.measured.map((p) => p.success_rate);
    const split = narrowestSplit(agent.measured, familyMembers, agent.agent_id);
    const se = gapStandardError(outcome, split.ones, split.zeros)!;
    const threshold80 = powerThreshold(family.criticalValue, se, 0.8);
    const ceiling = maximumAttainableGap(split.ones, split.zeros, mean(outcome)!)!;
    return {
      agent_id: agent.agent_id,
      overallRate: mean(outcome)!,
      sd: standardDeviation(outcome)!,
      split,
      se,
      criticalValue: family.criticalValue,
      threshold80,
      maxAttainableGap: ceiling,
      detectableAt80: ceiling >= threshold80,
      sitesAtExtremes: outcome.filter((y) => y === 0 || y === 1).length,
    };
  });

  const reference = power[0];
  const sizing: SizingRow[] = [];
  for (const gap of SIZING_GAPS) {
    for (const prevalence of [0.5, reference.split.ones / siteCount]) {
      for (const target of SIZING_POWERS) {
        const sites = sitesForGap({
          gap,
          prevalence,
          power: target,
          criticalValue: family.criticalValue,
          referenceOnes: reference.split.ones,
          referenceZeros: reference.split.zeros,
          sd: reference.sd,
        });
        if (sites !== null) sizing.push({ gap, prevalence, power: target, sites });
      }
    }
  }

  // --- the confound ---------------------------------------------------------
  const first = agents[0].measured;
  const anchorPairs = (points: AuditSitePoint[]): Pair[] =>
    points.map((p) => ({ x: p.tier === ANCHOR_TIER ? 1 : 0, y: p.success_rate }));

  const confound: ConfoundReport = {
    passingSites: first
      .filter((p) => p.lh_llms_txt === 1)
      .map((p) => ({ site_id: p.site_id, name: p.name, tier: p.tier })),
    anchorsWithout: first
      .filter((p) => p.tier === ANCHOR_TIER && p.lh_llms_txt === 0)
      .map((p) => p.site_id),
    anchorCount: first.filter((p) => p.tier === ANCHOR_TIER).length,
    pseudoAudit: agents.map((agent) => {
      const pairs = anchorPairs(agent.measured);
      const ci = bootstrapCI(pairs, meanGap, { iterations, seed })!;
      return {
        agent_id: agent.agent_id,
        groups: binaryGroupSizes(pairs),
        gap: ci.point,
        ci,
        identicalToLlmsTxt: samePairMultiset(pairs, pairsFor(agent.measured, "lh_llms_txt")),
      };
    }),
    stratified: permutationFamily(comparisonInputs(true), gapStatistic, {
      iterations,
      seed,
      level: alpha,
    })!,
    withinAnchor: agents.map((agent) => {
      const anchors = agent.measured.filter((p) => p.tier === ANCHOR_TIER);
      const pairs = pairsFor(anchors, "lh_llms_txt");
      return {
        agent_id: agent.agent_id,
        groups: binaryGroupSizes(pairs),
        gap: meanGap(pairs),
      };
    }),
  };

  // --- pooling the panel: computed so the page can say why it is not published
  const pooled = poolPanel(agents, iterations, seed);

  // --- the wrong unit of analysis -------------------------------------------
  const unitOfAnalysis: UnitOfAnalysisRow[] | null =
    pooled === null
      ? null
      : AUDITS.flatMap((definition) => {
          const pooledRow = pooled.rows.find((r) => r.key === definition.key);
          if (!pooledRow) return [];
          const totals = trialTotals(agents, definition.key);
          const test = twoProportionZ(
            totals.successesPass,
            totals.trialsPass,
            totals.successesFail,
            totals.trialsFail
          );
          if (test === null) return [];
          return [
            {
              key: definition.key,
              label: definition.label,
              ...totals,
              trialZ: test.z,
              trialP: test.p,
              siteP: pooledRow.pExact,
              ratio: pooledRow.pExact / test.p,
            },
          ];
        });

  // --- costco: excluded, or scored 0%? --------------------------------------
  const exclusionSensitivity = excludedSiteIds.length === 0 ? null : sensitivity(agents);

  return {
    agents: agentRows,
    siteCount,
    cohort,
    family,
    power,
    sizing,
    confound,
    unitOfAnalysis,
    exclusionSensitivity,
    excludedSiteIds,
    pooled,
    trialsPerSite,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AgentSplit {
  agent_id: string;
  measured: AuditSitePoint[];
  excluded: AuditSitePoint[];
}

function gapStatistic(predictor: number[], outcome: number[]): number | null {
  return meanGap(predictor.map((x, i) => ({ x, y: outcome[i] })));
}

function pairsFor(points: AuditSitePoint[], key: AuditKey): Pair[] {
  return points.map((p) => ({ x: p[key], y: p.success_rate }));
}

/** The exact-p denominator: only defined when every site contributes the same trial count. */
function uniformTrialCount(points: { trial_count: number }[]): number | null {
  if (points.length === 0) return null;
  const counts = new Set(points.map((p) => p.trial_count));
  return counts.size === 1 ? [...counts][0] : null;
}

/** The family's narrowest split for this agent — the one the power statement has to clear. */
function narrowestSplit(
  points: AuditSitePoint[],
  members: { agent_id: string; key: AuditKey }[],
  agentId: string
): { ones: number; zeros: number } {
  let narrowest: { ones: number; zeros: number } | null = null;
  for (const member of members) {
    if (member.agent_id !== agentId) continue;
    const groups = binaryGroupSizes(pairsFor(points, member.key));
    if (
      narrowest === null ||
      Math.min(groups.ones, groups.zeros) < Math.min(narrowest.ones, narrowest.zeros)
    ) {
      narrowest = groups;
    }
  }
  // No reportable audit for this agent: report against an even split, which is the most
  // generous assumption and therefore cannot overstate what the cohort could have detected.
  return narrowest ?? { ones: Math.floor(points.length / 2), zeros: Math.ceil(points.length / 2) };
}

/** Do two 0/1 splits describe literally the same data? Then no analysis can separate them. */
function samePairMultiset(a: Pair[], b: Pair[]): boolean {
  if (a.length !== b.length) return false;
  const sort = (pairs: Pair[]) => [...pairs].sort((p, q) => p.x - q.x || p.y - q.y);
  const left = sort(a);
  const right = sort(b);
  return left.every((p, i) => p.x === right[i].x && p.y === right[i].y);
}

function trialTotals(agents: AgentSplit[], key: AuditKey) {
  let successesPass = 0;
  let trialsPass = 0;
  let successesFail = 0;
  let trialsFail = 0;
  for (const agent of agents) {
    for (const point of agent.measured) {
      const successes = Math.round(point.success_rate * point.trial_count);
      if (point[key] === 1) {
        successesPass += successes;
        trialsPass += point.trial_count;
      } else {
        successesFail += successes;
        trialsFail += point.trial_count;
      }
    }
  }
  return { successesPass, trialsPass, successesFail, trialsFail };
}

/**
 * The site-level pooled panel: each site's two agent rates combined by trials.
 *
 * Computed, not published as a finding. It manufactures the one sub-0.05 number in the whole
 * analysis by averaging away a real agent x site disagreement — between-agent rank correlation
 * is 0.59 and six sites move by 60 points or more, in both directions. The page shows the
 * number and says that, because anyone who pools the frozen artifacts will find it anyway.
 */
function poolPanel(agents: AgentSplit[], iterations: number, seed: number): PooledReport | null {
  if (agents.length < 2) return null;

  const byId = agents.map((a) => new Map(a.measured.map((p) => [p.site_id, p])));
  const shared = agents[0].measured.filter((p) => byId.every((m) => m.has(p.site_id)));
  if (shared.length === 0) return null;

  const pooledPoints = shared.map((point) => {
    let successes = 0;
    let trials = 0;
    for (const map of byId) {
      const row = map.get(point.site_id)!;
      successes += Math.round(row.success_rate * row.trial_count);
      trials += row.trial_count;
    }
    return { ...point, success_rate: successes / trials, trial_count: trials };
  });

  const denominator = uniformTrialCount(pooledPoints);

  const rows = AUDITS.flatMap((definition) => {
    const pairs = pairsFor(pooledPoints, definition.key);
    const groups = binaryGroupSizes(pairs);
    const gap = meanGap(pairs);
    const exact =
      denominator === null
        ? null
        : exactGapP(
            pairs.map((p) => p.x),
            pairs.map((p) => p.y),
            denominator
          );
    if (gap === null || exact === null) return [];
    // An exact p is legitimate at any split; a bootstrap interval is not. Same gate, same
    // reason: on a 1-vs-26 split the interval describes one site, not the audit.
    const ci =
      Math.min(groups.ones, groups.zeros) >= MIN_GROUP
        ? bootstrapCI(pairs, meanGap, { iterations, seed })
        : null;
    return [{ key: definition.key, label: definition.label, gap, ci, pExact: exact.p }];
  });

  const flipped = shared
    .map((point) => ({
      site_id: point.site_id,
      name: point.name,
      first: byId[0].get(point.site_id)!.success_rate,
      second: byId[1].get(point.site_id)!.success_rate,
    }))
    .filter((row) => Math.abs(row.first - row.second) >= 0.6)
    .sort((a, b) => (a.site_id < b.site_id ? -1 : 1));

  return {
    rows,
    betweenAgentSpearman: spearmanRho(
      shared.map((point) => ({
        x: byId[0].get(point.site_id)!.success_rate,
        y: byId[1].get(point.site_id)!.success_rate,
      }))
    ),
    flipped,
    agentIds: agents.map((a) => a.agent_id),
  };
}

/**
 * What the pooled numbers become if the never-reached sites are scored 0% instead of excluded.
 *
 * The pre-registered rule excludes them — a site the agent never connected to has no behavioral
 * measurement, and 0% would be one. This shows the alternative anyway, because a reviewer will
 * ask whether the exclusion was load-bearing.
 */
function sensitivity(agents: AgentSplit[]): ExclusionSensitivityRow[] | null {
  const excluded = poolPanel(
    agents.map((a) => ({
      ...a,
      // Scored 0%, with the trial count the batch actually recorded for them.
      measured: [...a.measured, ...a.excluded.map((p) => ({ ...p, trial_count: trialsOf(a) }))],
    })),
    DEFAULT_ITERATIONS,
    DEFAULT_SEED
  );
  const kept = poolPanel(agents, DEFAULT_ITERATIONS, DEFAULT_SEED);
  if (excluded === null || kept === null) return null;

  return AUDITS.flatMap((definition) => {
    const without = kept.rows.find((r) => r.key === definition.key);
    const withThem = excluded.rows.find((r) => r.key === definition.key);
    if (!without || !withThem) return [];
    return [
      {
        key: definition.key,
        label: definition.label,
        excludedGap: without.gap,
        excludedP: without.pExact,
        includedGap: withThem.gap,
        includedP: withThem.pExact,
      },
    ];
  });
}

/** The trial count the rest of this agent's sites carry — the denominator a 0% row would use. */
function trialsOf(agent: AgentSplit): number {
  return uniformTrialCount(agent.measured) ?? 0;
}
