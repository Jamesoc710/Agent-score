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
  formatInterval,
  linearRegression,
  mulberry32,
  pearson,
  relationshipVerdict,
  percentile,
  rankAverage,
  spearmanRho,
  strengthLabel,
  type Pair,
} from "./stats";

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

interface Vectors {
  constants: Record<string, number>;
  prng: { seed: number; first_10: number[]; seed_1_first_5: number[] };
  rank_average: { values: number[]; ranks: number[] }[];
  percentile: { sorted: number[]; q: number; value: number }[];
  edge_cases: CaseVector[];
  v1: Record<string, AgentVector>;
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
