import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIGHTHOUSE_PASS_THRESHOLD,
  ROUNDING_SLACK,
  clsAlternativeRule,
  clsAssignments,
  clsDecomposition,
  impliedCls,
  type ClsAlternativeRule,
  type ImpliedCls,
  type LighthouseFlagsRow,
  type Range,
} from "./x-axis";

// The cross-language contract for the x-axis decomposition (S2-7 section 8): the Python
// reference computes the `x_axis_decomposition` block from data/lighthouse-v1.json, this file
// proves the TypeScript agrees, then pins the sentences the exhibit and the CLS append quote.
const vectors = JSON.parse(
  readFileSync(join(__dirname, "..", "scripts", "tests", "stats-vectors.json"), "utf8")
);
const X = vectors.x_axis_decomposition as XAxisVectors;

interface XAxisVectors {
  rounding_slack: number;
  rows: LighthouseFlagsRow[];
  implied_cls: Record<string, ImpliedCls>;
  resolved: string[];
  ambiguous: { site_id: string; values: number[] }[];
  inconsistent: string[];
  identical_input: { sites: string[]; span: { min: number; max: number } | null };
  assignments: number;
  rho_lh_total_cls: Range & { n: number };
  measured: { excluded: string[]; assignments: number; rho_lh_total_cls: Range & { n: number } };
  alternative_rule: { threshold: number; agents: Record<string, ClsAlternativeRule> };
}

const LITE = "gemini-3.5-flash-lite";
const FLASH = "gemini-3.6-flash";
const PRECISION = 12;

const decomposition = clsDecomposition(X.rows);

function outcomes(agentId: string): { site_id: string; success_rate: number }[] {
  return (vectors.v1[agentId].sites as { site_id: string; success_rate: number }[]).map((s) => ({
    site_id: s.site_id,
    success_rate: s.success_rate,
  }));
}

function expectRange(actual: Range | null, expected: Range | null, label: string) {
  if (expected === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual!.min, label).toBeCloseTo(expected.min, PRECISION);
  expect(actual!.median, label).toBeCloseTo(expected.median, PRECISION);
  expect(actual!.max, label).toBeCloseTo(expected.max, PRECISION);
}

describe("impliedCls", () => {
  it("reproduces the reference candidates for every v1 row", () => {
    expect(ROUNDING_SLACK).toBe(X.rounding_slack);
    expect(X.rows).toHaveLength(28);
    for (const row of X.rows) {
      const implied = impliedCls(row);
      const vector = X.implied_cls[row.site_id];
      expect(implied.resolved, row.site_id).toBe(vector.resolved);
      expect(implied.candidates.length, row.site_id).toBe(vector.candidates.length);
      implied.candidates.forEach((candidate, i) => {
        const expected = vector.candidates[i];
        expect(candidate.denominator, row.site_id).toBe(expected.denominator);
        expect(candidate.schema, row.site_id).toBe(expected.schema);
        expect(candidate.cls, row.site_id).toBeCloseTo(expected.cls, PRECISION);
        expect(candidate.lo, row.site_id).toBeCloseTo(expected.lo, PRECISION);
        expect(candidate.hi, row.site_id).toBeCloseTo(expected.hi, PRECISION);
      });
      expect(implied.values.length, row.site_id).toBe(vector.values.length);
      implied.values.forEach((v, i) => expect(v, row.site_id).toBeCloseTo(vector.values[i], PRECISION));
      if (vector.cls === null) expect(implied.cls, row.site_id).toBeNull();
      else expect(implied.cls!, row.site_id).toBeCloseTo(vector.cls, PRECISION);
    }
  });

  it("reads a passing llms.txt as weighted, so the two-audit denominator is out", () => {
    const stripe = impliedCls({ site_id: "stripe", lh_total: 100, lh_accessibility_tree: 1, lh_layout_stability: 1, lh_llms_txt: 1, lh_webmcp: 0 });
    expect(stripe.candidates.map((c) => c.denominator)).toEqual([3]);
    expect(stripe.cls).toBe(1);
  });

  it("solves the failing-llms.txt row both ways: applied and failed, or absent", () => {
    // bestbuy: 33 with a11y 0. Two audits: CLS 0.66. Three, llms.txt failed: CLS 0.99.
    const bestbuy = impliedCls(X.rows.find((r) => r.site_id === "bestbuy")!);
    expect(bestbuy.candidates.map((c) => [c.denominator, c.cls])).toEqual([
      [2, 0.66],
      [3, 0.99],
    ]);
    expect(bestbuy.resolved).toBe(false);
  });

  it("tries schema validity only where WebMCP applied, and target resolves to CLS 1.0 either way", () => {
    const target = impliedCls(X.rows.find((r) => r.site_id === "target")!);
    expect(target.candidates.map((c) => [c.denominator, c.schema])).toEqual([
      [3, null],
      [4, 1],
    ]);
    expect(target.resolved).toBe(true);
    expect(target.cls).toBe(1);
    const noWebmcp = X.rows.filter((r) => r.lh_webmcp === 0);
    expect(noWebmcp.length).toBe(27);
    for (const row of noWebmcp) {
      expect(impliedCls(row).candidates.some((c) => c.denominator === 4), row.site_id).toBe(false);
    }
  });

  it("keeps a candidate only when the rounding slack meets [0, 1]", () => {
    // costco: 49 with a11y 1. Two audits would need CLS -0.02, outside the slack; three gives 0.47.
    const costco = impliedCls(X.rows.find((r) => r.site_id === "costco")!);
    expect(costco.candidates.map((c) => c.denominator)).toEqual([3]);
    expect(costco.cls!).toBeCloseTo(0.47, PRECISION);
    // ca_dmv: 67 with a11y 1. Three audits gives 1.01, inside the slack, clamped to 1.
    const caDmv = impliedCls(X.rows.find((r) => r.site_id === "ca_dmv")!);
    expect(caDmv.candidates.find((c) => c.denominator === 3)!.cls).toBe(1);
  });

  it("names a row no denominator fits as inconsistent rather than forcing one", () => {
    const impossible = impliedCls({ site_id: "x", lh_total: 100, lh_accessibility_tree: 0, lh_layout_stability: 0, lh_llms_txt: 0, lh_webmcp: 0 });
    expect(impossible.candidates).toEqual([]);
    expect(impossible.values).toEqual([]);
    expect(impossible.resolved).toBe(false);
    expect(impossible.cls).toBeNull();
  });
});

describe("clsDecomposition", () => {
  it("reproduces the reference sets, span and assignment count", () => {
    expect(decomposition.resolved).toEqual(X.resolved);
    expect(decomposition.ambiguous.map((a) => a.site_id)).toEqual(X.ambiguous.map((a) => a.site_id));
    decomposition.ambiguous.forEach((site, i) => {
      site.values.forEach((v, j) => expect(v, site.site_id).toBeCloseTo(X.ambiguous[i].values[j], PRECISION));
    });
    expect(decomposition.inconsistent).toEqual(X.inconsistent);
    expect(decomposition.identical_input).toEqual(X.identical_input);
    expect(decomposition.assignments).toBe(X.assignments);
    expect(decomposition.rho_lh_total_cls!.n).toBe(X.rho_lh_total_cls.n);
    expectRange(decomposition.rho_lh_total_cls, X.rho_lh_total_cls, "rho");
  });

  it("THE EXHIBIT: 20 rows resolve, 8 do not, 256 assignments, nothing inconsistent", () => {
    expect(decomposition.resolved).toHaveLength(20);
    expect(decomposition.ambiguous.map((a) => a.site_id)).toEqual([
      "bear",
      "bestbuy",
      "ca_dmv",
      "powells",
      "ticketmaster",
      "twilio",
      "voodoo",
      "zalando",
    ]);
    expect(decomposition.assignments).toBe(256);
    expect(decomposition.inconsistent).toEqual([]);
  });

  it("fourteen of the 28 sites are identical on every agent-specific input and span 3 to 50", () => {
    expect(decomposition.identical_input.sites).toEqual([
      "amazon",
      "apple",
      "bear",
      "bestbuy",
      "craigslist",
      "ikea",
      "innout",
      "irs",
      "oregon_state",
      "powells",
      "ticketmaster",
      "twilio",
      "usps",
      "voodoo",
    ]);
    expect(decomposition.identical_input.span).toEqual({ min: 3, max: 50 });
  });

  it("the category mean's rank order follows layout shift: rho +0.68, +0.60 to +0.75 on the measured 27", () => {
    // D1 section 2 computed this on the 27 measured sites; costco (unmeasured on the y-axis)
    // resolves either way, so the 28-row figure differs only by its inclusion.
    const measured = clsDecomposition(X.rows.filter((r) => !X.measured.excluded.includes(r.site_id)));
    expect(X.measured.excluded).toEqual(["costco"]);
    expect(measured.assignments).toBe(X.measured.assignments);
    expectRange(measured.rho_lh_total_cls, X.measured.rho_lh_total_cls, "measured rho");
    expect(measured.rho_lh_total_cls!.n).toBe(27);
    expect(measured.rho_lh_total_cls!.median).toBeCloseTo(0.68, 2);
    expect(measured.rho_lh_total_cls!.min).toBeCloseTo(0.6, 2);
    expect(measured.rho_lh_total_cls!.max).toBeCloseTo(0.75, 2);
    expect(decomposition.rho_lh_total_cls!.median).toBeCloseTo(0.7, 2);
    for (const range of [measured.rho_lh_total_cls!, decomposition.rho_lh_total_cls!]) {
      expect(range.min).toBeGreaterThan(0.5);
      expect(range.median).toBeGreaterThanOrEqual(range.min);
      expect(range.max).toBeGreaterThanOrEqual(range.median);
    }
  });

  it("is invariant to the order rows arrive in", () => {
    const reversed = clsDecomposition([...X.rows].reverse());
    expect(reversed.resolved).toEqual(decomposition.resolved);
    expect(reversed.rho_lh_total_cls).toEqual(decomposition.rho_lh_total_cls);
  });

  it("enumerates every assignment once, first ambiguous site fastest, values ascending", () => {
    const assignments = clsAssignments(decomposition);
    expect(assignments).toHaveLength(256);
    const first = assignments[0];
    for (const site of decomposition.ambiguous) expect(first[site.site_id], site.site_id).toBe(site.values[0]);
    expect(assignments[1].bear).toBe(decomposition.ambiguous[0].values[1]);
    expect(assignments[1].bestbuy).toBe(decomposition.ambiguous[1].values[0]);
    expect(assignments[2].bear).toBe(decomposition.ambiguous[0].values[0]);
    expect(assignments[2].bestbuy).toBe(decomposition.ambiguous[1].values[1]);
    const keys = new Set(assignments.map((a) => decomposition.ambiguous.map((s) => a[s.site_id]).join("|")));
    expect(keys.size).toBe(256);
    for (const assignment of assignments) expect(Object.keys(assignment)).toHaveLength(28);
  });
});

describe.each([LITE, FLASH])("clsAlternativeRule — %s", (agentId) => {
  const result = clsAlternativeRule(decomposition, outcomes(agentId));
  const vector = X.alternative_rule.agents[agentId];

  it("reproduces the reference range under Lighthouse's pass rule", () => {
    expect(X.alternative_rule.threshold).toBe(LIGHTHOUSE_PASS_THRESHOLD);
    expect(result.threshold).toBe(vector.threshold);
    expect(result.n).toBe(vector.n);
    expect(result.assignments).toBe(vector.assignments);
    expect(result.splits).toEqual(vector.splits);
    expectRange(result.gap, vector.gap, "gap");
    expectRange(result.rho_cls_rate, vector.rho_cls_rate, "rho");
  });

  it("is computed on the 27 measured sites over all 256 assignments", () => {
    expect(result.n).toBe(27);
    expect(result.assignments).toBe(256);
    expect(result.splits.map(([ones]) => ones)).toEqual([17, 18, 19, 20, 21]);
  });
});

describe("clsAlternativeRule — the figures the CLS append quotes", () => {
  it("lite: the CLS row's point estimate becomes -11.0, range -31.3 to +6.7", () => {
    const gap = clsAlternativeRule(decomposition, outcomes(LITE)).gap!;
    expect(gap.median * 100).toBeCloseTo(-11.0, 1);
    expect(gap.min * 100).toBeCloseTo(-31.3, 1);
    expect(gap.max * 100).toBeCloseTo(6.7, 1);
  });

  it("3.6-flash: -2.6, range -23.3 to +15.6", () => {
    const gap = clsAlternativeRule(decomposition, outcomes(FLASH)).gap!;
    expect(gap.median * 100).toBeCloseTo(-2.6, 1);
    expect(gap.min * 100).toBeCloseTo(-23.3, 1);
    expect(gap.max * 100).toBeCloseTo(15.6, 1);
  });

  it("changes the sign of the published point estimate on both agents, and no verdict", () => {
    const sub = vectors.sub_audit_attribution.agents;
    for (const agentId of [LITE, FLASH]) {
      const published = sub[agentId].lh_layout_stability.gap as number;
      const alternative = clsAlternativeRule(decomposition, outcomes(agentId)).gap!;
      expect(published, agentId).toBeGreaterThan(0);
      expect(alternative.median, agentId).toBeLessThan(0);
      // Nowhere near the family's 49-point critical value under either rule.
      const critical = vectors.sub_audit_attribution.family.critical_value as number;
      expect(Math.abs(alternative.min), agentId).toBeLessThan(critical);
      expect(Math.abs(alternative.max), agentId).toBeLessThan(critical);
    }
  });

  it("the behavioral half is exploratory and near zero: +0.00 and +0.09 medians", () => {
    const lite = clsAlternativeRule(decomposition, outcomes(LITE)).rho_cls_rate!;
    const flash = clsAlternativeRule(decomposition, outcomes(FLASH)).rho_cls_rate!;
    expect(lite.median).toBeCloseTo(0.0, 1);
    expect(lite.min).toBeCloseTo(-0.14, 2);
    expect(lite.max).toBeCloseTo(0.16, 2);
    expect(flash.median).toBeCloseTo(0.09, 2);
    // D1 section 2 printed this minimum as -0.06; the computed value is -0.0549, which D1's
    // three-decimal output showed as -0.055 before it was rounded by hand.
    expect(flash.min).toBeCloseTo(-0.055, 3);
    expect(flash.max).toBeCloseTo(0.25, 2);
  });

  it("returns null ranges when no site has an outcome", () => {
    const empty = clsAlternativeRule(decomposition, []);
    expect(empty.n).toBe(0);
    expect(empty.gap).toBeNull();
    expect(empty.rho_cls_rate).toBeNull();
  });
});
