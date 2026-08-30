import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITERATIONS,
  DEFAULT_SEED,
  MIN_GROUP,
  MIN_N,
  binaryGroupSizes,
  bootstrapCI,
  erfc,
  exactGapP,
  formatInterval,
  gapStandardError,
  linearRegression,
  maximumAttainableGap,
  mean,
  meanGap,
  minimumAttainableP,
  mulberry32,
  normalQuantile,
  pearson,
  permutationFamily,
  relationshipVerdict,
  percentile,
  rankAverage,
  shuffleIndices,
  simulateFalsePositiveRate,
  simulatePower,
  sitesForGap,
  spearmanRho,
  standardDeviation,
  strengthLabel,
  subAuditGap,
  subAuditVerdict,
  twoProportionZ,
  type ComparisonInput,
  type Pair,
} from "./stats";
import {
  ALPHA,
  AUDITS,
  CALIBRATION,
  analyzeSubAudits,
  type AgentPoints,
  type AuditKey,
} from "./sub-audits";

// The cross-language contract. scripts/stats_reference.py computes every value below from the
// committed v1 artifacts; this file proves the TypeScript on the published page agrees. Same
// arrangement as scripts/tests/scoring-vectors.json for the scoring module.
const vectors = JSON.parse(
  readFileSync(join(__dirname, "..", "scripts", "tests", "stats-vectors.json"), "utf8")
) as Vectors;

interface CaseVector {
  name: string;
  note: string;
  pairs: Pair[];
  pearson: number | null;
  spearman: number | null;
  linear_regression: { slope: number; intercept: number } | null;
}

interface AgentVector {
  n: number;
  trials: number;
  successes: number;
  unmeasured_sites: string[];
  run_window: { first: string; last: string };
  sites: { site_id: string; lh_total: number; success_rate: number; [audit: string]: string | number }[];
  pairs: Pair[];
  pearson: number;
  spearman: number;
  linear_regression: { slope: number; intercept: number };
  spearman_ci: { point: number; lo: number; hi: number; used: number; iterations: number };
  pearson_ci: { point: number; lo: number; hi: number; used: number; iterations: number };
  sub_audits: Record<
    string,
    { groups: { ones: number; zeros: number }; reportable: boolean; pearson: number | null }
  >;
}

interface Interval95 {
  lo: number;
  hi: number;
  used: number;
}

interface AuditVector {
  groups: { ones: number; zeros: number };
  reportable: boolean;
  gap: number;
  r: number | null;
  ci95: Interval95 | null;
  simultaneous: Interval95 | null;
  p_unadjusted: number | null;
  p_exact: number | null;
  p_family_wise: number | null;
}

interface SubAuditVectors {
  min_group: number;
  alpha: number;
  iterations: number;
  seed: number;
  trials_per_site: number;
  family_audits: string[];
  site_tiers: Record<string, string>;
  excluded_sites: { site_id: string; tier: string; [audit: string]: string | number }[];
  shuffle: { n: number; seed: number; first_3: number[][]; n_6_first_2: number[][] };
  normal_quantile: { p: number; value: number }[];
  erfc: { x: number; value: number }[];
  family: {
    size: number;
    level: number;
    iterations: number;
    used: number;
    critical_value: number;
    members: string[];
  };
  agents: Record<string, Record<string, AuditVector>>;
  degenerate_webmcp: Record<
    string,
    {
      groups: { ones: number; zeros: number };
      gap: number;
      ci95: Interval95 & { iterations: number };
      discarded: number;
      p_exact: number;
      min_attainable_p: number;
    }
  >;
  power: Record<
    string,
    {
      reference_split: { ones: number; zeros: number };
      overall_rate: number;
      sd: number;
      se_at_split: number;
      critical_value: number;
      threshold_80: number;
      max_attainable_gap: number;
      detectable_at_80: boolean;
      sites_at_extremes: number;
    }
  >;
  sizing: { gap: number; prevalence: number; power: number; n: number }[];
  confound: {
    llms_txt_sites: { site_id: string; tier: string }[];
    anchors_without_llms_txt: string[];
    anchor_pseudo_audit: Record<
      string,
      { groups: { ones: number; zeros: number }; gap: number; ci95: Interval95 }
    >;
    stratified: Record<string, { p_unadjusted: number; p_family_wise: number }>;
    stratified_critical_value: number;
    within_anchor: Record<string, { groups: { ones: number; zeros: number }; gap: number }>;
    identical_to_anchor: Record<string, boolean>;
  };
  unit_of_analysis: Record<
    string,
    {
      successes_pass: number;
      trials_pass: number;
      successes_fail: number;
      trials_fail: number;
      trial_z: number;
      trial_p: number;
      site_p: number;
      ratio: number;
    }
  >;
  costco_sensitivity: Record<
    string,
    { gap_27: number; p_27: number; gap_28: number; p_28: number }
  >;
  pooled_panel_rejected: {
    audits: Record<string, { gap: number; ci95: Interval95 | null; p_exact: number }>;
    between_agent_spearman: number;
    flipped_sites: { site_id: string; first: number; second: number }[];
  };
  estimator_equivalence: Record<
    string,
    { mean_of_site_rates: number; pooled_trial_rate: number; trials_per_site: number[] }
  >;
  calibration: {
    false_positive: {
      splits: number[];
      replicates: number;
      iterations: number;
      level: number;
      agents: Record<
        string,
        Record<string, { bootstrap: number; permutation: number; replicates: number }>
      >;
    };
    power_simulation: {
      effect: number;
      trials: number;
      replicates: number;
      seed: number;
      base_rate_agent: string;
      designs: {
        n: number;
        ones: number;
        zeros: number;
        power: number;
        mean_gap: number;
        critical_value: number;
      }[];
    };
  };
}

interface Vectors {
  constants: Record<string, number>;
  prng: { seed: number; first_10: number[]; seed_1_first_5: number[] };
  rank_average: { values: number[]; ranks: number[] }[];
  percentile: { sorted: number[]; q: number; value: number }[];
  edge_cases: CaseVector[];
  v1: Record<string, AgentVector>;
  sub_audit_attribution: SubAuditVectors;
}

const LITE = "gemini-3.5-flash-lite";
const FLASH = "gemini-3.6-flash";

// Cross-language float agreement, not a loose tolerance: both implementations run the same
// operations in the same order, so they should agree to the last few bits.
const PRECISION = 12;

describe("constants stay in sync with the reference implementation", () => {
  it("matches scripts/stats_reference.py", () => {
    expect(vectors.constants).toEqual({
      MIN_N,
      MIN_GROUP,
      DEFAULT_SEED,
      DEFAULT_ITERATIONS,
    });
  });
});

describe("mulberry32", () => {
  it("reproduces the reference stream exactly", () => {
    const rng = mulberry32(vectors.prng.seed);
    const drawn = vectors.prng.first_10.map(() => rng());
    // Exact equality: a seeded PRNG that only approximately agrees is not reproducible.
    expect(drawn).toEqual(vectors.prng.first_10);
  });

  it("reproduces the reference stream for a second seed", () => {
    const rng = mulberry32(1);
    expect(vectors.prng.seed_1_first_5.map(() => rng())).toEqual(vectors.prng.seed_1_first_5);
  });

  it("stays in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is a pure function of its seed", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("rankAverage", () => {
  it.each(vectors.rank_average)("ranks $values", ({ values, ranks }) => {
    expect(rankAverage(values)).toEqual(ranks);
  });

  it("averages tied blocks rather than breaking ties by position", () => {
    expect(rankAverage([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("percentile", () => {
  it.each(vectors.percentile)("q=$q of $sorted", ({ sorted, q, value }) => {
    expect(percentile(sorted, q)).toBeCloseTo(value, PRECISION);
  });

  it("returns NaN for an empty array rather than 0", () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe("edge cases return null, never a fabricated zero", () => {
  it.each(vectors.edge_cases)("$name — $note", (vector) => {
    expectMatch(pearson(vector.pairs), vector.pearson);
    expectMatch(spearmanRho(vector.pairs), vector.spearman);

    const fit = linearRegression(vector.pairs);
    if (vector.linear_regression === null) {
      expect(fit).toBeNull();
    } else {
      expect(fit!.slope).toBeCloseTo(vector.linear_regression.slope, PRECISION);
      expect(fit!.intercept).toBeCloseTo(vector.linear_regression.intercept, PRECISION);
    }
  });

  it("refuses a correlation below MIN_N even when one is arithmetically available", () => {
    const twoPoints: Pair[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(pearson(twoPoints)).toBeNull();
    expect(spearmanRho(twoPoints)).toBeNull();
    // The fit line has a lower bar than the finding: it is drawn, not claimed.
    expect(linearRegression(twoPoints)).not.toBeNull();
  });

  it("returns null for a constant vector instead of 0", () => {
    const flat: Pair[] = [
      { x: 5, y: 0.1 },
      { x: 5, y: 0.9 },
      { x: 5, y: 0.5 },
    ];
    expect(pearson(flat)).toBeNull();
    expect(spearmanRho(flat)).toBeNull();
    expect(linearRegression(flat)).toBeNull();
    expect(bootstrapCI(flat, spearmanRho)).toBeNull();
  });

  it("scores a monotone-but-curved relationship higher on rho than on r", () => {
    const curved = vectors.edge_cases.find((c) => c.name === "monotone_not_linear")!;
    expect(spearmanRho(curved.pairs)).toBe(1);
    expect(pearson(curved.pairs)!).toBeLessThan(1);
  });
});

describe.each([LITE, FLASH])("v1 published dataset — %s", (agentId) => {
  const vector = () => vectors.v1[agentId];

  it("has the recorded n after the never-reached-the-site exclusion", () => {
    expect(vector().n).toBe(27);
    expect(vector().unmeasured_sites).toEqual(["costco"]);
    expect(vector().pairs).toHaveLength(27);
  });

  it("reproduces the reference point estimates", () => {
    expect(pearson(vector().pairs)).toBeCloseTo(vector().pearson, PRECISION);
    expect(spearmanRho(vector().pairs)).toBeCloseTo(vector().spearman, PRECISION);
  });

  it("reproduces the reference bootstrap interval", () => {
    const ci = bootstrapCI(vector().pairs, spearmanRho)!;
    expect(ci.point).toBeCloseTo(vector().spearman_ci.point, PRECISION);
    expect(ci.lo).toBeCloseTo(vector().spearman_ci.lo, PRECISION);
    expect(ci.hi).toBeCloseTo(vector().spearman_ci.hi, PRECISION);
    expect(ci.used).toBe(vector().spearman_ci.used);
    expect(ci.iterations).toBe(DEFAULT_ITERATIONS);

    const pearsonCi = bootstrapCI(vector().pairs, pearson)!;
    expect(pearsonCi.lo).toBeCloseTo(vector().pearson_ci.lo, PRECISION);
    expect(pearsonCi.hi).toBeCloseTo(vector().pearson_ci.hi, PRECISION);
  });

  it("is invariant to the order rows arrive in", () => {
    // The leaderboard hands these over sorted by success rate, the reference script by site
    // id. Both must publish the same interval.
    const shuffled = [...vector().pairs].reverse();
    const rotated = [...vector().pairs.slice(7), ...vector().pairs.slice(0, 7)];
    const base = bootstrapCI(vector().pairs, spearmanRho)!;
    expect(bootstrapCI(shuffled, spearmanRho)).toEqual(base);
    expect(bootstrapCI(rotated, spearmanRho)).toEqual(base);
  });

  it("brackets the point estimate and is deterministic across calls", () => {
    const first = bootstrapCI(vector().pairs, spearmanRho)!;
    const second = bootstrapCI(vector().pairs, spearmanRho)!;
    expect(second).toEqual(first);
    expect(first.lo).toBeLessThanOrEqual(first.point);
    expect(first.hi).toBeGreaterThanOrEqual(first.point);
  });

  it("spans zero — the published null finding", () => {
    const ci = bootstrapCI(vector().pairs, spearmanRho)!;
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0);
    expect(strengthLabel(ci.point)).toBe("none");
  });
});

describe("v1 headline values recorded in .claude/plans/buildout.md", () => {
  // Hardcoded on purpose. The vectors can be regenerated; these are the numbers already
  // published, so a regeneration that moves them has to fail here and be looked at.
  it("lite: 69/135 = 51%, r = 0.105, rho = 0.106, n = 27", () => {
    const v = vectors.v1[LITE];
    expect([v.successes, v.trials]).toEqual([69, 135]);
    expect(v.successes / v.trials).toBeCloseTo(0.511, 3);
    expect(v.n).toBe(27);
    expect(pearson(v.pairs)!).toBeCloseTo(0.1051, 4);
    expect(spearmanRho(v.pairs)!).toBeCloseTo(0.1059, 4);
  });

  it("3.6-flash: 77/135 = 57%, r = -0.032, rho = -0.021, n = 27", () => {
    const v = vectors.v1[FLASH];
    expect([v.successes, v.trials]).toEqual([77, 135]);
    expect(v.successes / v.trials).toBeCloseTo(0.5704, 4);
    expect(v.n).toBe(27);
    expect(pearson(v.pairs)!).toBeCloseTo(-0.0317, 4);
    expect(spearmanRho(v.pairs)!).toBeCloseTo(-0.0214, 4);
  });

  it("the run window is a single day, as published", () => {
    expect(vectors.v1[LITE].run_window.first.slice(0, 10)).toBe("2026-08-19");
    expect(vectors.v1[LITE].run_window.last.slice(0, 10)).toBe("2026-08-19");
  });
});

describe("sub-audit splits", () => {
  const audits = () => vectors.v1[LITE].sub_audits;
  const auditPairs = (key: string): Pair[] =>
    vectors.v1[LITE].sites.map((s) => ({ x: s[key] as number, y: s.success_rate }));

  it("recomputes every split from the per-site rows and agrees with the reference", () => {
    for (const [key, audit] of Object.entries(audits())) {
      const pairs = auditPairs(key);
      expect(binaryGroupSizes(pairs), key).toEqual(audit.groups);
      expect(audit.groups.ones + audit.groups.zeros, key).toBe(vectors.v1[LITE].n);
      if (audit.pearson !== null) expect(pearson(pairs)!).toBeCloseTo(audit.pearson, PRECISION);
    }
  });

  it("refuses to report an audit only one site passes (lh_webmcp: 1 vs 26)", () => {
    const webmcp = audits().lh_webmcp;
    expect(Math.min(webmcp.groups.ones, webmcp.groups.zeros)).toBeLessThan(MIN_GROUP);
    expect(webmcp.reportable).toBe(false);
    expect(webmcp.pearson).toBeNull();
  });

  it("reports audits with a real split on both sides", () => {
    expect(audits().lh_accessibility_tree.reportable).toBe(true);
    expect(audits().lh_layout_stability.reportable).toBe(true);
    expect(audits().lh_llms_txt.reportable).toBe(true);
  });

  it("binaryGroupSizes ignores non-binary values rather than guessing", () => {
    expect(binaryGroupSizes([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0 }])).toEqual({
      ones: 1,
      zeros: 1,
    });
  });
});

describe("relationshipVerdict — the wording follows the interval, never the point estimate", () => {
  it("calls an interval that spans zero no relationship", () => {
    expect(relationshipVerdict({ lo: -0.28, hi: 0.48 })).toBe("none");
    expect(relationshipVerdict({ lo: 0, hi: 0.5 })).toBe("none");
    expect(relationshipVerdict({ lo: -0.5, hi: 0 })).toBe("none");
  });

  it("reports a direction only when zero is excluded", () => {
    expect(relationshipVerdict({ lo: 0.12, hi: 0.61 })).toBe("positive");
    expect(relationshipVerdict({ lo: -0.71, hi: -0.09 })).toBe("negative");
  });

  it("agrees with the v1 published null on both agents", () => {
    for (const agent of [LITE, FLASH]) {
      const ci = bootstrapCI(vectors.v1[agent].pairs, spearmanRho)!;
      expect(relationshipVerdict(ci), agent).toBe("none");
    }
  });
});

describe("presentation helpers", () => {
  it("labels strength conservatively", () => {
    expect(strengthLabel(0.1059)).toBe("none");
    expect(strengthLabel(-0.0214)).toBe("none");
    expect(strengthLabel(0.25)).toBe("weak");
    expect(strengthLabel(-0.55)).toBe("moderate");
    expect(strengthLabel(0.9)).toBe("strong");
  });

  it("formats an interval the way the page prints it", () => {
    expect(formatInterval({ lo: -0.2818, hi: 0.4772 })).toBe("[-0.28, 0.48]");
  });
});

function expectMatch(actual: number | null, expected: number | null) {
  if (expected === null) expect(actual).toBeNull();
  else expect(actual!).toBeCloseTo(expected, PRECISION);
}

// ===========================================================================
// Sub-audit attribution
//
// Same contract as above: scripts/stats_reference.py computes every value from the committed
// v1 artifacts, this file proves the TypeScript agrees. Then a second layer of cases asserts
// the INVARIANTS the published page states in words — each one is a sentence on
// /correlation/audits, and a regeneration that breaks the sentence has to fail here.
// ===========================================================================

const SUB = vectors.sub_audit_attribution;
const AUDIT_KEYS = AUDITS.map((a) => a.key);

/** Rebuild the analysis input from the vector file alone — no artifact parsing in the test. */
function panelFromVectors(includeExcluded = true): AgentPoints[] {
  return [LITE, FLASH].map((agentId) => ({
    agent_id: agentId,
    points: [
      ...vectors.v1[agentId].sites.map((site) => ({
        site_id: site.site_id,
        name: site.site_id,
        tier: SUB.site_tiers[site.site_id],
        success_rate: site.success_rate,
        trial_count: SUB.trials_per_site,
        lh_accessibility_tree: site.lh_accessibility_tree as number,
        lh_layout_stability: site.lh_layout_stability as number,
        lh_llms_txt: site.lh_llms_txt as number,
        lh_webmcp: site.lh_webmcp as number,
      })),
      ...(includeExcluded
        ? SUB.excluded_sites.map((site) => ({
            site_id: site.site_id,
            name: site.site_id,
            tier: site.tier,
            success_rate: 0,
            // Attempted, never reached: no measurement at all, which is how the analysis
            // recognises it. Not a 0% success rate.
            trial_count: 0,
            lh_accessibility_tree: site.lh_accessibility_tree as number,
            lh_layout_stability: site.lh_layout_stability as number,
            lh_llms_txt: site.lh_llms_txt as number,
            lh_webmcp: site.lh_webmcp as number,
          }))
        : []),
    ],
  }));
}

const analysis = analyzeSubAudits(panelFromVectors());

function auditPairs(agentId: string, key: string): Pair[] {
  return vectors.v1[agentId].sites.map((s) => ({ x: s[key] as number, y: s.success_rate }));
}

function rowFor(agentId: string, key: string) {
  return analysis.agents.find((a) => a.agent_id === agentId)!.rows.find((r) => r.key === key)!;
}

describe("shuffleIndices — the permutation stream, pinned as integers", () => {
  it("reproduces the reference shuffles exactly", () => {
    // Integer equality, not toBeCloseTo. Fisher-Yates is easy to get subtly different across
    // two languages, and every p-value downstream would then diverge silently.
    const rng = mulberry32(SUB.shuffle.seed);
    const drawn = SUB.shuffle.first_3.map(() => shuffleIndices(SUB.shuffle.n, rng));
    expect(drawn).toEqual(SUB.shuffle.first_3);
  });

  it("reproduces the reference shuffles at a second length", () => {
    const rng = mulberry32(SUB.shuffle.seed);
    expect(SUB.shuffle.n_6_first_2.map(() => shuffleIndices(6, rng))).toEqual(
      SUB.shuffle.n_6_first_2
    );
  });

  it("is a permutation: every index appears exactly once", () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffleIndices(11, rng);
      expect([...shuffled].sort((a, b) => a - b)).toEqual([...Array(11).keys()]);
    }
  });

  it("returns the trivial permutation for n <= 1 without drawing", () => {
    const rng = mulberry32(1);
    expect(shuffleIndices(0, rng)).toEqual([]);
    expect(shuffleIndices(1, rng)).toEqual([0]);
    // Nothing was consumed, so the next draw is still the first of the stream.
    expect(rng()).toBe(vectors.prng.seed_1_first_5[0]);
  });
});

describe("normal distribution helpers agree across languages", () => {
  it.each(SUB.normal_quantile)("normalQuantile($p)", ({ p, value }) => {
    expect(normalQuantile(p)).toBeCloseTo(value, PRECISION);
  });

  it.each(SUB.erfc)("erfc($x)", ({ x, value }) => {
    expect(erfc(x)).toBeCloseTo(value, PRECISION);
  });

  it("matches the standard normal quantiles a reader would check by hand", () => {
    expect(normalQuantile(0.8)).toBeCloseTo(0.8416212335729143, 13);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 13);
    expect(erfc(1)).toBeCloseTo(0.15729920705028513, 13);
  });

  it("refuses a probability outside (0, 1) rather than extrapolating", () => {
    expect(normalQuantile(0)).toBeNaN();
    expect(normalQuantile(1)).toBeNaN();
  });

  it("is symmetric about zero", () => {
    expect(normalQuantile(0.3)).toBeCloseTo(-normalQuantile(0.7), PRECISION);
    expect(erfc(-1.5) + erfc(1.5)).toBeCloseTo(2, PRECISION);
  });
});

describe("mean and standardDeviation accumulate the way the Python mirror does", () => {
  it("adds left to right, without compensation", () => {
    // Python 3.12's sum() applies Neumaier compensation and would return exactly 1.0 here.
    // Both implementations must produce the same wrong-looking answer, or a bootstrap draw
    // lands on the other side of zero and a simulated false-positive count moves.
    expect(mean(new Array(10).fill(0.1))!).toBe(0.09999999999999999);
  });

  it("returns null rather than a zero for the uncomputable case", () => {
    expect(mean([])).toBeNull();
    expect(standardDeviation([1])).toBeNull();
  });

  it("uses the sample (n-1) variance", () => {
    expect(standardDeviation([0, 1])!).toBeCloseTo(Math.SQRT1_2, PRECISION);
  });
});

describe("meanGap", () => {
  it("is the difference in group means, in success-rate points", () => {
    expect(
      meanGap([
        { x: 1, y: 1 },
        { x: 1, y: 0.5 },
        { x: 0, y: 0.25 },
      ])
    ).toBeCloseTo(0.5, PRECISION);
  });

  it("refuses only an EMPTY group — a one-site group is a legitimate bootstrap draw", () => {
    expect(meanGap([{ x: 1, y: 1 }])).toBeNull();
    expect(
      meanGap([
        { x: 1, y: 1 },
        { x: 0, y: 0 },
      ])
    ).toBe(1);
  });

  it("ignores values that are neither 0 nor 1 rather than guessing", () => {
    expect(
      meanGap([
        { x: 1, y: 1 },
        { x: 0, y: 0 },
        { x: 0.5, y: 99 },
      ])
    ).toBe(1);
  });
});

describe.each([LITE, FLASH])("v1 sub-audit estimates — %s", (agentId) => {
  const audits = () => SUB.agents[agentId];

  it("reproduces every gap, interval and p-value from the reference", () => {
    for (const [key, vector] of Object.entries(audits())) {
      const pairs = auditPairs(agentId, key);
      const row = rowFor(agentId, key);

      expect(row.groups, key).toEqual(vector.groups);
      expect(row.estimate !== null, key).toBe(vector.reportable);

      if (vector.reportable) {
        expect(row.estimate!.gap, key).toBeCloseTo(vector.gap, PRECISION);
        expect(row.estimate!.r!, key).toBeCloseTo(vector.r!, PRECISION);
        expect(row.estimate!.ci.lo, key).toBeCloseTo(vector.ci95!.lo, PRECISION);
        expect(row.estimate!.ci.hi, key).toBeCloseTo(vector.ci95!.hi, PRECISION);
        expect(row.estimate!.ci.used, key).toBe(vector.ci95!.used);
        expect(row.estimate!.simultaneous.lo, key).toBeCloseTo(vector.simultaneous!.lo, PRECISION);
        expect(row.estimate!.simultaneous.hi, key).toBeCloseTo(vector.simultaneous!.hi, PRECISION);
        expect(row.pUnadjusted!, key).toBeCloseTo(vector.p_unadjusted!, PRECISION);
        expect(row.pFamilyWise!, key).toBeCloseTo(vector.p_family_wise!, PRECISION);
      }
      expect(row.pExact!, key).toBeCloseTo(vector.p_exact!, PRECISION);
      // Recomputed from the per-site rows rather than trusting the derived pair list.
      expect(subAuditGap(pairs) === null, key).toBe(!vector.reportable);
    }
  });

  it("agrees with the gap recomputed by hand, and r shares its sign", () => {
    for (const [key, vector] of Object.entries(audits())) {
      const pairs = auditPairs(agentId, key);
      const ones = pairs.filter((p) => p.x === 1).map((p) => p.y);
      const zeros = pairs.filter((p) => p.x === 0).map((p) => p.y);
      const byHand = mean(ones)! - mean(zeros)!;
      expect(byHand, key).toBeCloseTo(vector.gap, PRECISION);
      if (vector.r !== null && vector.gap !== 0) {
        expect(Math.sign(vector.r), key).toBe(Math.sign(vector.gap));
      }
    }
  });
});

describe("the family: membership, correction, and the published verdict", () => {
  it("is exactly the three audits with a reportable split, on both agents", () => {
    expect(analysis.family!.size).toBe(6);
    expect(analysis.family!.comparisons.map((c) => c.key).sort()).toEqual(
      [...SUB.family.members].sort()
    );
    // WebMCP is out on GROUP SIZE, decided before any outcome was looked at.
    expect(SUB.family.members.some((m) => m.includes("webmcp"))).toBe(false);
    for (const agentId of [LITE, FLASH]) {
      expect(Math.min(...Object.values(SUB.agents[agentId].lh_webmcp.groups))).toBeLessThan(
        MIN_GROUP
      );
    }
  });

  it("reproduces the reference critical value and iteration count", () => {
    expect(analysis.family!.criticalValue).toBeCloseTo(SUB.family.critical_value, PRECISION);
    expect(analysis.family!.used).toBe(SUB.family.used);
    expect(analysis.family!.iterations).toBe(DEFAULT_ITERATIONS);
    expect(analysis.family!.level).toBe(ALPHA);
  });

  it("never lets the correction move a p-value downwards", () => {
    for (const comparison of analysis.family!.comparisons) {
      expect(comparison.pFamilyWise, comparison.key).toBeGreaterThanOrEqual(
        comparison.pUnadjusted
      );
    }
  });

  it("publishes a null: every family-wise p is above the level", () => {
    // Hardcoded like the "69/135" block above. These are the numbers already on the page, so a
    // regeneration that flips a verdict has to fail here and be looked at.
    for (const agentRows of analysis.agents) {
      for (const row of agentRows.rows) {
        if (row.pFamilyWise === null) continue;
        expect(row.pFamilyWise, row.key).toBeGreaterThan(ALPHA);
        expect(row.verdict, row.key).toBe("not-distinguishable");
      }
    }
    expect(rowFor(LITE, "lh_llms_txt").pFamilyWise!).toBeCloseTo(0.1526, 4);
    expect(rowFor(FLASH, "lh_llms_txt").pFamilyWise!).toBeCloseTo(0.2249, 4);
  });

  it("has every simultaneous interval spanning zero", () => {
    for (const agentRows of analysis.agents) {
      for (const row of agentRows.rows) {
        if (row.estimate === null) continue;
        expect(relationshipVerdict(row.estimate.simultaneous), row.key).toBe("none");
      }
    }
  });

  it("is invariant to the order the sites arrive in", () => {
    const base = analysis.family!;
    const reversed = analyzeSubAudits(
      panelFromVectors().map((agent) => ({ ...agent, points: [...agent.points].reverse() }))
    ).family!;
    const rotated = analyzeSubAudits(
      panelFromVectors().map((agent) => ({
        ...agent,
        points: [...agent.points.slice(7), ...agent.points.slice(0, 7)],
      }))
    ).family!;
    expect(reversed.criticalValue).toBe(base.criticalValue);
    expect(rotated.criticalValue).toBe(base.criticalValue);
    expect(reversed.comparisons).toEqual(base.comparisons);
    expect(rotated.comparisons).toEqual(base.comparisons);
  });

  it("collapses to the unadjusted p for a family of one", () => {
    const single: ComparisonInput[] = [
      {
        key: "solo",
        siteIds: vectors.v1[LITE].sites.map((s) => s.site_id),
        predictor: vectors.v1[LITE].sites.map((s) => s.lh_llms_txt as number),
        outcome: vectors.v1[LITE].sites.map((s) => s.success_rate),
      },
    ];
    const family = permutationFamily(single, gapStatistic)!;
    expect(family.size).toBe(1);
    expect(family.comparisons[0].pFamilyWise).toBe(family.comparisons[0].pUnadjusted);
  });

  it("returns null for an empty family rather than a table of zeros", () => {
    expect(permutationFamily([], gapStatistic)).toBeNull();
  });

  it("throws, rather than reporting 'not enough data', on a structural mismatch", () => {
    const base: ComparisonInput = {
      key: "a",
      siteIds: ["x", "y", "z", "w"],
      predictor: [1, 1, 0, 0],
      outcome: [1, 0.5, 0.25, 0],
    };
    expect(() =>
      permutationFamily([base, { ...base, key: "b", outcome: [1, 0.5] }], gapStatistic)
    ).toThrow(/expected 4/);
    expect(() =>
      permutationFamily([base, { ...base, key: "b", siteIds: ["x", "y", "z", "q"] }], gapStatistic)
    ).toThrow(/same sites/);
    expect(() =>
      permutationFamily(
        [{ ...base, key: "degenerate", predictor: [1, 1, 1, 1] }],
        gapStatistic
      )
    ).toThrow(/no computable statistic/);
  });
});

describe("[C4] WebMCP is unfalsifiable, not merely untestable", () => {
  it.each([LITE, FLASH])("refuses the 1-vs-26 split entirely — %s", (agentId) => {
    const row = rowFor(agentId, "lh_webmcp");
    expect(row.estimate).toBeNull();
    expect(row.verdict).toBe("not-reportable");
    expect(subAuditGap(auditPairs(agentId, "lh_webmcp"), { familySize: 6 })).toBeNull();
  });

  it("could not have produced a significant result under ANY single-site split", () => {
    for (const agentId of [LITE, FLASH]) {
      const floor = rowFor(agentId, "lh_webmcp").minimumAttainableP!;
      expect(floor, agentId).toBeCloseTo(SUB.degenerate_webmcp[agentId].min_attainable_p, PRECISION);
      // The whole point: the smallest p ANY arrangement could reach is far above the level.
      expect(floor, agentId).toBeGreaterThan(ALPHA);
    }
    expect(rowFor(LITE, "lh_webmcp").minimumAttainableP!).toBeCloseTo(1 / 3, PRECISION);
  });

  it("is the most extreme arrangement available for lite: floor equals observed p", () => {
    const row = rowFor(LITE, "lh_webmcp");
    expect(row.pExact!).toBeCloseTo(row.minimumAttainableP!, PRECISION);
  });

  it("[the trap] the ungated estimator claims an interval excluding zero, in OPPOSITE directions", () => {
    // This case is the justification for gating subAuditGap on group size rather than only the
    // display. Without it, one site (target: 0% for lite, 100% for 3.6) produces two confident
    // and contradictory findings from the same audit.
    const lite = rowFor(LITE, "lh_webmcp").degenerate!;
    const flash = rowFor(FLASH, "lh_webmcp").degenerate!;
    expect(relationshipVerdict(lite.ci)).toBe("negative");
    expect(relationshipVerdict(flash.ci)).toBe("positive");
    for (const [agentId, degenerate] of [
      [LITE, lite],
      [FLASH, flash],
    ] as const) {
      const vector = SUB.degenerate_webmcp[agentId];
      expect(degenerate.ci.lo, agentId).toBeCloseTo(vector.ci95.lo, PRECISION);
      expect(degenerate.ci.hi, agentId).toBeCloseTo(vector.ci95.hi, PRECISION);
      // Resamples that drew no passing site at all and were discarded.
      expect(degenerate.ci.used, agentId).toBe(vector.ci95.used);
      expect(degenerate.ci.iterations - degenerate.ci.used, agentId).toBe(vector.discarded);
      expect(vector.discarded).toBe(3679);
    }
  });
});

describe("[C1] what this cohort could have detected", () => {
  it("reproduces the reference power arithmetic", () => {
    for (const report of analysis.power!) {
      const vector = SUB.power[report.agent_id];
      expect(report.split, report.agent_id).toEqual(vector.reference_split);
      expect(report.sd, report.agent_id).toBeCloseTo(vector.sd, PRECISION);
      expect(report.se, report.agent_id).toBeCloseTo(vector.se_at_split, PRECISION);
      expect(report.threshold80, report.agent_id).toBeCloseTo(vector.threshold_80, PRECISION);
      expect(report.maxAttainableGap, report.agent_id).toBeCloseTo(
        vector.max_attainable_gap,
        PRECISION
      );
      expect(report.sitesAtExtremes, report.agent_id).toBe(vector.sites_at_extremes);
    }
  });

  it("uses the sample variance — the published 80% threshold moves if that changes", () => {
    const outcome = vectors.v1[LITE].sites.map((s) => s.success_rate);
    expect(gapStandardError(outcome, 6, 21)!).toBeCloseTo(0.2107, 4);
    const populationSd = Math.sqrt(
      outcome.reduce((s, y) => s + (y - mean(outcome)!) ** 2, 0) / outcome.length
    );
    expect(populationSd * Math.sqrt(1 / 6 + 1 / 21)).not.toBeCloseTo(0.2107, 4);
  });

  it("separates the 50%-power critical value from the 80%-power threshold", () => {
    const lite = analysis.power!.find((p) => p.agent_id === LITE)!;
    expect(lite.criticalValue).toBeCloseTo(0.4902, 4);
    expect(lite.threshold80).toBeCloseTo(0.6675, 4);
    // The correction that the plan originally missed: 0.49 is a coin flip, not an MDE.
    expect(lite.threshold80).toBeGreaterThan(lite.criticalValue);
  });

  it("THE HEADLINE: the ceiling is below the 80%-power threshold on both agents", () => {
    // 100% is the highest a passing group can score, which forces the failing group down.
    // No llms.txt-shaped audit could have been detected here at 80% power, at any effect size.
    for (const report of analysis.power!) {
      expect(report.maxAttainableGap, report.agent_id).toBeLessThan(report.threshold80);
      expect(report.detectableAt80, report.agent_id).toBe(false);
    }
    const lite = analysis.power!.find((p) => p.agent_id === LITE)!;
    expect(lite.maxAttainableGap).toBeCloseTo(0.6286, 4);
  });

  it("the anchor pseudo-audit sits exactly ON the ceiling, so the bound is reachable", () => {
    const lite = analysis.power!.find((p) => p.agent_id === LITE)!;
    const pseudo = analysis.confound!.pseudoAudit.find((p) => p.agent_id === LITE)!;
    expect(pseudo.gap).toBeCloseTo(lite.maxAttainableGap, PRECISION);
  });

  it("maximumAttainableGap is bounded by the arithmetic, not by the data", () => {
    // Half the sites pass, overall rate 0.5: the best case is 1.0 vs 0.0.
    expect(maximumAttainableGap(5, 5, 0.5)!).toBeCloseTo(1, PRECISION);
    // A high overall rate leaves the passing group no room to separate.
    expect(maximumAttainableGap(5, 5, 0.9)!).toBeCloseTo(0.2, PRECISION);
    expect(maximumAttainableGap(0, 5, 0.5)).toBeNull();
  });
});

describe("[C2] sizing a follow-up: 50% power is not a design target", () => {
  it("reproduces the reference sizing table", () => {
    expect(analysis.sizing!.length).toBe(SUB.sizing.length);
    for (const vector of SUB.sizing) {
      const row = analysis.sizing!.find(
        (r) =>
          r.gap === vector.gap &&
          Math.abs(r.prevalence - vector.prevalence) < 1e-12 &&
          r.power === vector.power
      )!;
      expect(row, `${vector.gap}/${vector.prevalence}/${vector.power}`).toBeDefined();
      expect(row.sites).toBeCloseTo(vector.n, PRECISION);
    }
  });

  it("costs 1.854x the sites at 80% power, at every gap and prevalence", () => {
    for (const gap of [0.3, 0.2]) {
      for (const prevalence of [...new Set(analysis.sizing!.map((r) => r.prevalence))]) {
        const at50 = analysis.sizing!.find(
          (r) => r.gap === gap && r.prevalence === prevalence && r.power === 0.5
        )!;
        const at80 = analysis.sizing!.find(
          (r) => r.gap === gap && r.prevalence === prevalence && r.power === 0.8
        )!;
        expect(at80.sites / at50.sites).toBeCloseTo(1.8543, 4);
      }
    }
  });

  it("publishes the numbers a v2 budget would be built from", () => {
    const balanced30 = analysis.sizing!.find(
      (r) => r.gap === 0.3 && r.prevalence === 0.5 && r.power === 0.8
    )!;
    expect(Math.ceil(balanced30.sites)).toBe(93);
    const natural30 = analysis.sizing!.find(
      (r) => r.gap === 0.3 && r.prevalence !== 0.5 && r.power === 0.8
    )!;
    expect(Math.ceil(natural30.sites)).toBe(134);
  });

  it("refuses a nonsensical design instead of returning a number", () => {
    const args = {
      prevalence: 0.5,
      power: 0.8,
      criticalValue: 0.49,
      referenceOnes: 6,
      referenceZeros: 21,
      sd: 0.45,
    };
    expect(sitesForGap({ ...args, gap: 0 })).toBeNull();
    expect(sitesForGap({ ...args, gap: 0.3, prevalence: 1 })).toBeNull();
  });
});

describe("[C3] the llms.txt / anchor-tier confound, tested rather than asserted", () => {
  it("is provable from the artifact: 5 of 6 passing sites are anchors", () => {
    const confound = analysis.confound!;
    expect(confound.passingSites.map((s) => s.site_id)).toEqual([
      "cloudflare",
      "github",
      "notion",
      "shopify",
      "stripe",
      "target",
    ]);
    expect(confound.passingSites.filter((s) => s.tier === "anchor")).toHaveLength(5);
    expect(confound.anchorsWithout).toEqual(["twilio"]);
    expect(confound.passingSites.filter((s) => s.tier !== "anchor")).toHaveLength(1);
    expect(confound.anchorCount).toBe(6);
  });

  it("loses the whole effect when the label is permuted WITHIN tier", () => {
    const stratified = analysis.confound!.stratified;
    expect(stratified.stratified).toBe(true);
    for (const comparison of stratified.comparisons) {
      const vector = SUB.confound.stratified[comparison.key];
      expect(comparison.pUnadjusted, comparison.key).toBeCloseTo(vector.p_unadjusted, PRECISION);
      expect(comparison.pFamilyWise, comparison.key).toBeCloseTo(vector.p_family_wise, PRECISION);
    }
    const liteLlms = stratified.comparisons.find((c) => c.key === `${LITE}|lh_llms_txt`)!;
    const flashLlms = stratified.comparisons.find((c) => c.key === `${FLASH}|lh_llms_txt`)!;
    expect(liteLlms.pUnadjusted).toBe(1);
    expect(flashLlms.pUnadjusted).toBeGreaterThan(0.7);
    // Unstratified, the same two comparisons were the only ones anywhere near the line.
    expect(rowFor(LITE, "lh_llms_txt").pUnadjusted!).toBeLessThan(0.06);
    expect(rowFor(FLASH, "lh_llms_txt").pUnadjusted!).toBeLessThan(0.09);
  });

  it("finds no positive gap inside the anchor tier", () => {
    for (const within of analysis.confound!.withinAnchor) {
      const vector = SUB.confound.within_anchor[within.agent_id];
      expect(within.groups, within.agent_id).toEqual(vector.groups);
      expect(within.gap!, within.agent_id).toBeCloseTo(vector.gap, PRECISION);
      expect(within.gap!, within.agent_id).toBeLessThanOrEqual(0);
      // 5 vs 1 — reported as a description, never as a test. The same rule that refuses WebMCP.
      expect(Math.min(within.groups.ones, within.groups.zeros)).toBeLessThan(MIN_GROUP);
    }
  });

  it("for 3.6-flash the pseudo-audit and the real audit are the SAME variable", () => {
    const pseudo = analysis.confound!.pseudoAudit;
    const flash = pseudo.find((p) => p.agent_id === FLASH)!;
    const lite = pseudo.find((p) => p.agent_id === LITE)!;
    expect(flash.identicalToLlmsTxt).toBe(true);
    expect(lite.identicalToLlmsTxt).toBe(false);

    // The sets differ only by twilio <-> target, and both score 1.0 for 3.6 — so the multiset
    // of (x, y) pairs is literally the same and every statistic computed from it must agree.
    const llms = rowFor(FLASH, "lh_llms_txt").estimate!;
    expect(flash.gap).toBeCloseTo(llms.gap, PRECISION);
    expect(flash.ci.lo).toBeCloseTo(llms.ci.lo, PRECISION);
    expect(flash.ci.hi).toBeCloseTo(llms.ci.hi, PRECISION);

    // For lite they are different variables and the pseudo-audit buys MORE.
    expect(lite.gap).toBeGreaterThan(rowFor(LITE, "lh_llms_txt").estimate!.gap);
  });

  it("reproduces the reference pseudo-audit intervals", () => {
    for (const pseudo of analysis.confound!.pseudoAudit) {
      const vector = SUB.confound.anchor_pseudo_audit[pseudo.agent_id];
      expect(pseudo.groups, pseudo.agent_id).toEqual(vector.groups);
      expect(pseudo.gap, pseudo.agent_id).toBeCloseTo(vector.gap, PRECISION);
      expect(pseudo.ci.lo, pseudo.agent_id).toBeCloseTo(vector.ci95.lo, PRECISION);
      expect(pseudo.ci.hi, pseudo.agent_id).toBeCloseTo(vector.ci95.hi, PRECISION);
    }
  });
});

describe("[C7] the unit of analysis is the site, and the exhibit says why", () => {
  it("reproduces the trial-level test the analysis deliberately does NOT use", () => {
    for (const row of analysis.unitOfAnalysis!) {
      const vector = SUB.unit_of_analysis[row.key];
      expect(row.successesPass, row.key).toBe(vector.successes_pass);
      expect(row.trialsPass, row.key).toBe(vector.trials_pass);
      expect(row.successesFail, row.key).toBe(vector.successes_fail);
      expect(row.trialsFail, row.key).toBe(vector.trials_fail);
      expect(row.trialZ, row.key).toBeCloseTo(vector.trial_z, PRECISION);
      expect(row.trialP, row.key).toBeCloseTo(vector.trial_p, PRECISION);
      expect(row.siteP, row.key).toBeCloseTo(vector.site_p, PRECISION);
    }
  });

  it("the wrong unit turns a p of 0.03 into a p of 5e-8", () => {
    const llms = analysis.unitOfAnalysis!.find((r) => r.key === "lh_llms_txt")!;
    expect(llms.trialZ).toBeGreaterThan(5);
    expect(llms.trialP).toBeLessThan(1e-7);
    expect(llms.siteP).toBeGreaterThan(0.03);
    expect(llms.ratio).toBeGreaterThan(100000);
    expect(llms.ratio).toBeCloseTo(649733, 0);
    // 51/60 vs 95/210 — six websites, counted as sixty independent observations.
    expect([llms.trialsPass, llms.trialsFail]).toEqual([60, 210]);
  });

  it("refuses a degenerate two-proportion test rather than dividing by zero", () => {
    expect(twoProportionZ(0, 0, 1, 2)).toBeNull();
    expect(twoProportionZ(2, 2, 3, 3)).toBeNull();
  });
});

describe("[C11] the estimator note and the pooled panel", () => {
  it("mean-of-site-rates equals the pooled trial rate in v1, to every digit printed", () => {
    for (const agentId of [LITE, FLASH]) {
      const vector = SUB.estimator_equivalence[agentId];
      // Equal because every measured site carries the same number of trials. The estimator
      // choice is right on principle and currently invisible; the first partially-excluded
      // site in a future batch makes it visible.
      expect(vector.trials_per_site).toEqual([SUB.trials_per_site]);
      expect(vector.mean_of_site_rates).toBeCloseTo(vector.pooled_trial_rate, PRECISION);
      const sites = vectors.v1[agentId].sites;
      expect(mean(sites.map((s) => s.success_rate))!).toBeCloseTo(
        vectors.v1[agentId].successes / vectors.v1[agentId].trials,
        PRECISION
      );
    }
  });

  it("pooling the two agents manufactures the only sub-0.05 number in the analysis", () => {
    const llms = analysis.pooled!.rows.find((r) => r.key === "lh_llms_txt")!;
    const vector = SUB.pooled_panel_rejected.audits.lh_llms_txt;
    expect(llms.gap).toBeCloseTo(vector.gap, PRECISION);
    expect(llms.ci!.lo).toBeCloseTo(vector.ci95!.lo, PRECISION);
    expect(llms.ci!.hi).toBeCloseTo(vector.ci95!.hi, PRECISION);
    expect(llms.pExact).toBeCloseTo(vector.p_exact, PRECISION);

    // The number a reader who pools the frozen artifacts will find.
    expect(llms.pExact).toBeLessThan(ALPHA);
    expect(relationshipVerdict(llms.ci!)).toBe("positive");
    // And the reason it is not the headline: neither per-agent family-wise p is close.
    expect(rowFor(LITE, "lh_llms_txt").pFamilyWise!).toBeGreaterThan(ALPHA);
    expect(rowFor(FLASH, "lh_llms_txt").pFamilyWise!).toBeGreaterThan(ALPHA);
  });

  it("the two agents disagree per site, which is what pooling averages away", () => {
    expect(analysis.pooled!.betweenAgentSpearman!).toBeCloseTo(
      SUB.pooled_panel_rejected.between_agent_spearman,
      PRECISION
    );
    expect(analysis.pooled!.betweenAgentSpearman!).toBeLessThan(0.6);
    expect(analysis.pooled!.flipped.map((f) => f.site_id)).toEqual(
      SUB.pooled_panel_rejected.flipped_sites.map((f) => f.site_id)
    );
    expect(analysis.pooled!.flipped).toHaveLength(6);
    // In BOTH directions — the disagreement is not one model simply being better.
    expect(analysis.pooled!.flipped.some((f) => f.second > f.first)).toBe(true);
    expect(analysis.pooled!.flipped.some((f) => f.second < f.first)).toBe(true);
  });

  it("applies the MIN_GROUP gate to the pooled panel too", () => {
    const webmcp = analysis.pooled!.rows.find((r) => r.key === "lh_webmcp")!;
    expect(webmcp.ci).toBeNull();
    expect(webmcp.pExact).toBeCloseTo(1, PRECISION);
  });
});

describe("[C6] costco: excluded, or scored 0%?", () => {
  it("reproduces the reference sensitivity table", () => {
    expect(analysis.excludedSiteIds).toEqual(["costco"]);
    for (const row of analysis.exclusionSensitivity!) {
      const vector = SUB.costco_sensitivity[row.key];
      expect(row.excludedGap, row.key).toBeCloseTo(vector.gap_27, PRECISION);
      expect(row.excludedP, row.key).toBeCloseTo(vector.p_27, PRECISION);
      expect(row.includedGap, row.key).toBeCloseTo(vector.gap_28, PRECISION);
      expect(row.includedP, row.key).toBeCloseTo(vector.p_28, PRECISION);
    }
  });

  it("changes nothing qualitatively — and moves against the exclusion being self-serving", () => {
    const llms = analysis.exclusionSensitivity!.find((r) => r.key === "lh_llms_txt")!;
    expect(llms.excludedP).toBeCloseTo(0.0326, 4);
    expect(llms.includedP).toBeCloseTo(0.0258, 4);
    // Including costco makes the pooled llms.txt result look slightly STRONGER, and it is
    // still not published as a finding.
    expect(llms.includedP).toBeLessThan(llms.excludedP);
    const webmcp = analysis.exclusionSensitivity!.find((r) => r.key === "lh_webmcp")!;
    expect(webmcp.excludedP).toBe(1);
    expect(webmcp.includedP).toBe(1);
  });

  it("never lets an unmeasured site into an estimate by default", () => {
    // 28 points went in; every gap is computed on the 27 that have a measurement.
    expect(analysis.siteCount).toBe(27);
    const withoutCostco = analyzeSubAudits(panelFromVectors(false));
    expect(withoutCostco.family!.criticalValue).toBe(analysis.family!.criticalValue);
    expect(withoutCostco.exclusionSensitivity).toBeNull();
    for (const agentRows of withoutCostco.agents) {
      for (const row of agentRows.rows) {
        const same = rowFor(agentRows.agent_id, row.key);
        expect(row.groups, row.key).toEqual(same.groups);
      }
    }
  });
});

describe("exact permutation p", () => {
  it("agrees with the Monte-Carlo p to within its own error", () => {
    for (const agentRows of analysis.agents) {
      for (const row of agentRows.rows) {
        if (row.pUnadjusted === null || row.pExact === null) continue;
        expect(Math.abs(row.pUnadjusted - row.pExact), row.key).toBeLessThan(0.01);
      }
    }
  });

  it("enumerates the whole null: C(n, k) splits", () => {
    const result = exactGapP([1, 1, 0, 0, 0], [1, 1, 0.5, 0, 0], 2)!;
    expect(result.splits).toBe(10); // C(5, 2)
    expect(result.p).toBeCloseTo(result.extreme / result.splits, PRECISION);
  });

  it("returns null when the outcomes are not multiples of 1/denominator", () => {
    expect(exactGapP([1, 0, 0], [0.3333, 0, 1], 5)).toBeNull();
    expect(exactGapP([1, 1, 1], [1, 1, 1], 5)).toBeNull();
  });

  it("gives a two-sided p of 1 when the observed split is the least extreme available", () => {
    expect(exactGapP([1, 0, 1, 0], [0.5, 0.5, 0.5, 0.5], 2)!.p).toBe(1);
  });

  it("bounds minimumAttainableP below every observable p on the same split", () => {
    for (const agentId of [LITE, FLASH]) {
      for (const key of AUDIT_KEYS) {
        const pairs = auditPairs(agentId, key);
        const predictor = pairs.map((p) => p.x);
        const outcome = pairs.map((p) => p.y);
        const floor = minimumAttainableP(predictor, outcome, SUB.trials_per_site)!;
        expect(exactGapP(predictor, outcome, SUB.trials_per_site)!.p, key).toBeGreaterThanOrEqual(
          floor - 1e-12
        );
      }
    }
  });
});

describe("[C5] calibration: what each procedure does when nothing is there", () => {
  it("reproduces the pinned false-positive rates from a live simulation", () => {
    // CALIBRATION in lib/sub-audits.ts is what the page prints. This case re-runs the actual
    // simulation, so the constant cannot drift from the code that produced it.
    for (const agentId of [LITE, FLASH]) {
      const outcome = vectors.v1[agentId].sites.map((s) => s.success_rate);
      for (const split of CALIBRATION.falsePositive.agents[agentId]) {
        const result = simulateFalsePositiveRate({
          outcome,
          ones: split.ones,
          replicates: CALIBRATION.falsePositive.replicates,
          seed: DEFAULT_SEED,
          iterations: CALIBRATION.falsePositive.iterations,
          level: CALIBRATION.falsePositive.level,
          denominator: SUB.trials_per_site,
        })!;
        const label = `${agentId} ${split.ones}/${split.zeros}`;
        expect(result.bootstrap, label).toBeCloseTo(split.bootstrap, PRECISION);
        expect(result.permutation, label).toBeCloseTo(split.permutation, PRECISION);

        const vector = SUB.calibration.false_positive.agents[agentId][String(split.ones)];
        expect(result.bootstrap, label).toBeCloseTo(vector.bootstrap, PRECISION);
        expect(result.permutation, label).toBeCloseTo(vector.permutation, PRECISION);
      }
    }
  });

  it("THE GATE'S JUSTIFICATION: at 1-vs-26 the bootstrap fires nine times in ten", () => {
    for (const agentId of [LITE, FLASH]) {
      const degenerate = CALIBRATION.falsePositive.agents[agentId].find((s) => s.ones === 1)!;
      expect(degenerate.bootstrap, agentId).toBeGreaterThan(0.5);
      // Meanwhile the permutation test cannot fire at all — see the unfalsifiability floor.
      expect(degenerate.permutation, agentId).toBe(0);
    }
  });

  it("overshoots its nominal level on the 6-vs-21 split", () => {
    // The split the one marginal interval that excludes zero was computed on.
    const flash = CALIBRATION.falsePositive.agents[FLASH].find((s) => s.ones === 6)!;
    expect(flash.bootstrap).toBeGreaterThan(ALPHA);
    expect(flash.bootstrap).toBeCloseTo(0.074, 3);
    const lite = CALIBRATION.falsePositive.agents[LITE].find((s) => s.ones === 6)!;
    expect(lite.bootstrap).toBeGreaterThan(ALPHA);
  });

  it("the permutation test holds its level on every reportable split", () => {
    for (const agentId of [LITE, FLASH]) {
      for (const split of CALIBRATION.falsePositive.agents[agentId]) {
        if (Math.min(split.ones, split.zeros) < MIN_GROUP) continue;
        expect(split.permutation, `${agentId} ${split.ones}`).toBeLessThanOrEqual(ALPHA + 0.005);
      }
    }
  });
});

describe("[C2] power simulation: 1.854x is a floor, not an estimate", () => {
  it("reproduces the pinned power figures from a live simulation", () => {
    const baseRates = vectors.v1[CALIBRATION.power.baseRateAgent].sites.map((s) => s.success_rate);
    const criticalValue = analysis.family!.criticalValue;
    const reference = analysis.power!.find(
      (p) => p.agent_id === CALIBRATION.power.baseRateAgent
    )!.split;

    for (const design of CALIBRATION.power.designs) {
      const result = simulatePower({
        baseRates,
        ones: design.ones,
        zeros: design.zeros,
        effect: CALIBRATION.power.effect,
        trials: CALIBRATION.power.trials,
        replicates: CALIBRATION.power.replicates,
        seed: DEFAULT_SEED,
        criticalValue,
        referenceOnes: reference.ones,
        referenceZeros: reference.zeros,
      })!;
      expect(result.power, `n=${design.sites}`).toBeCloseTo(design.power, PRECISION);
      expect(result.meanGap, `n=${design.sites}`).toBeCloseTo(design.meanGap, PRECISION);

      const vector = SUB.calibration.power_simulation.designs.find((d) => d.n === design.sites)!;
      expect(result.power).toBeCloseTo(vector.power, PRECISION);
      expect(result.criticalValue).toBeCloseTo(vector.critical_value, PRECISION);
    }
  });

  it("delivers far less power than the analytic sizing promises", () => {
    const [small, large] = CALIBRATION.power.designs;
    // The analytic table says 50 sites is 50% power and 93 is 80%. With v1's own outcome
    // distribution it is a fraction of that, so 1.854x is the floor of the correction.
    expect(small.power).toBeLessThan(0.2);
    expect(large.power).toBeLessThan(0.4);
    expect(large.power).toBeGreaterThan(small.power);
  });

  it("and the reason is the ceiling: a 30-point audit delivers a 17-point gap", () => {
    for (const design of CALIBRATION.power.designs) {
      expect(design.meanGap, `n=${design.sites}`).toBeLessThan(CALIBRATION.power.effect * 0.7);
    }
    // Three quarters of the cohort is already at exactly 0% or 100%, where +30 points has
    // nowhere to go — the same arithmetic as maximumAttainableGap.
    for (const report of analysis.power!) {
      expect(report.sitesAtExtremes / analysis.siteCount, report.agent_id).toBeGreaterThan(0.7);
    }
  });
});

describe("subAuditVerdict — one place decides the chip's wording", () => {
  it("reads a family-wise p, not a point estimate and not an interval", () => {
    expect(subAuditVerdict(0.04, 0.05)).toBe("distinguishable");
    expect(subAuditVerdict(0.05, 0.05)).toBe("distinguishable");
    expect(subAuditVerdict(0.051, 0.05)).toBe("not-distinguishable");
  });

  it("calls the whole v1 family not-distinguishable", () => {
    for (const comparison of analysis.family!.comparisons) {
      expect(subAuditVerdict(comparison.pFamilyWise, ALPHA), comparison.key).toBe(
        "not-distinguishable"
      );
    }
  });
});

describe("fixture-shaped input renders an honest empty state", () => {
  // The three dev fixtures: accessibility tree 1/2, layout stability 2/1, llms.txt 0/3,
  // WebMCP 0/3. No audit clears MIN_GROUP on both sides, so there is no family at all — and
  // the page must say so rather than print a table of zeros.
  const fixtures: AgentPoints[] = [
    {
      agent_id: "gemini-2.0-flash",
      points: [
        makePoint("stripe", "anchor", 0.8, { lh_accessibility_tree: 1, lh_layout_stability: 1 }),
        makePoint("irs", "government", 0.2, {}),
        makePoint("ca_dmv", "government", 0.4, { lh_layout_stability: 1 }),
      ],
    },
  ];
  const fixtureAnalysis = analyzeSubAudits(fixtures);

  it("has no family, so no p-value and no critical value exist", () => {
    expect(fixtureAnalysis.family).toBeNull();
    expect(fixtureAnalysis.power).toBeNull();
    expect(fixtureAnalysis.sizing).toBeNull();
    expect(fixtureAnalysis.confound).toBeNull();
    expect(fixtureAnalysis.pooled).toBeNull();
    expect(fixtureAnalysis.unitOfAnalysis).toBeNull();
  });

  it("still reports every split honestly, with no estimate attached", () => {
    expect(fixtureAnalysis.siteCount).toBe(3);
    for (const row of fixtureAnalysis.agents[0].rows) {
      expect(row.estimate, row.key).toBeNull();
      expect(row.verdict, row.key).toBe("not-reportable");
      expect(row.pFamilyWise, row.key).toBeNull();
      expect(row.groups.ones + row.groups.zeros, row.key).toBe(3);
    }
    const llms = fixtureAnalysis.agents[0].rows.find((r) => r.key === "lh_llms_txt")!;
    expect(llms.groups).toEqual({ ones: 0, zeros: 3 });
    // Nothing passes, so there is nothing to compare — not even a degenerate interval.
    expect(llms.degenerate).toBeNull();
  });
});

describe("the analysis never reads a sub-audit as absent", () => {
  it("every point carries all four audit values", () => {
    // toCorrelationPoints coerces a missing sub-audit to 0, which would silently read as
    // "fails the audit". Unreachable — the columns are NOT NULL CHECK (… in (0,1)) — but this
    // analysis depends on it, so it is pinned rather than trusted.
    for (const agentId of [LITE, FLASH]) {
      for (const site of vectors.v1[agentId].sites) {
        for (const key of AUDIT_KEYS) {
          expect([0, 1], `${site.site_id}.${key}`).toContain(site[key]);
        }
      }
    }
  });
});

function gapStatistic(predictor: number[], outcome: number[]): number | null {
  return meanGap(predictor.map((x, i) => ({ x, y: outcome[i] })));
}

function makePoint(
  siteId: string,
  tier: string,
  successRate: number,
  audits: Partial<Record<AuditKey, number>>
) {
  return {
    site_id: siteId,
    name: siteId,
    tier,
    success_rate: successRate,
    trial_count: 5,
    lh_accessibility_tree: 0,
    lh_layout_stability: 0,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    ...audits,
  };
}
