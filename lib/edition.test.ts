import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgainstVectors,
  deriveEdition,
  findRegistrationDate,
  resolveVectorPath,
  v1AuditStates,
  vectorPaths,
  type EditionSnapshot,
} from "./edition";
import { EDITION, editionMatches } from "./edition-data";
import { loadEditionInputs } from "./edition-inputs";
import type { LighthouseResult } from "./types";

// The edition snapshot (design S2-4 section 8). It is committed because the crawled and shared
// surfaces must not read the database, so it has to be provably the fold of the artifacts it
// claims to summarise, and every number in it has to be the number the Python reference pinned.

const ROOT = join(__dirname, "..");
const COMMITTED = JSON.parse(readFileSync(join(ROOT, "data", "edition-v1.json"), "utf8")) as EditionSnapshot;
const { inputs, gitResolved } = loadEditionInputs("v1");

describe("the committed snapshot matches its artifacts", () => {
  it("is exactly the fold of the cohort, the v1 lanes, the re-measurement and the vectors", () => {
    const derived = deriveEdition(inputs);
    if (!gitResolved) {
      // A checkout without the answer-key tags (a shallow CI clone) cannot read these two
      // git-derived fields; everything else is still compared.
      derived.answer_key_tag = COMMITTED.answer_key_tag;
      derived.lane1.lighthouse_version = COMMITTED.lane1.lighthouse_version;
      derived.lane1.version_source = COMMITTED.lane1.version_source;
    }
    expect(derived, "data/edition-v1.json is stale: run npx tsx scripts/build-edition-snapshot.ts").toEqual(
      COMMITTED
    );
  });

  it("is what the app actually imports", () => {
    expect(EDITION).toEqual(COMMITTED);
  });

  it("names the answer key the cohort file is byte-identical to", () => {
    if (!gitResolved) return;
    expect(COMMITTED.answer_key_tag).toBe("answer-key-v3");
    expect(COMMITTED.lane1.lighthouse_version).toBe("13.3.0");
  });
});

describe("every number is the pinned number", () => {
  it("cites only vector paths that resolve in scripts/tests/stats-vectors.json", () => {
    const paths = vectorPaths(EDITION);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(resolveVectorPath(inputs.vectors, path), path).toBeDefined();
  });

  it("agrees with the Python reference at every cited path", () => {
    expect(checkAgainstVectors(EDITION, inputs.vectors)).toEqual([]);
  });

  it("uses the real paths the design names", () => {
    const paths = vectorPaths(EDITION);
    expect(paths).toContain("v1/gemini-3.5-flash-lite/spearman_ci");
    expect(paths).toContain("v1/gemini-3.6-flash");
    expect(paths).toContain("study_v2/sensitivity/gemini-3.5-flash-lite/rule_b");
    expect(paths).toContain("study_v2/bootstrap_rows/v1_model_gap");
    expect(paths).toContain("x_axis_decomposition");
  });

  it("catches a disagreement rather than passing it through", () => {
    const tampered = structuredClone(EDITION);
    tampered.stats.sensitivity.by_agent["gemini-3.5-flash-lite"].point += 0.01;
    tampered.stats.model_gap.vector = "study_v2/no_such_block";
    const problems = checkAgainstVectors(tampered, inputs.vectors);
    expect(problems.some((p) => p.startsWith("study_v2/sensitivity/gemini-3.5-flash-lite/rule_b/rho"))).toBe(true);
    expect(problems).toContain("study_v2/no_such_block: not in stats-vectors.json");
  });

  it("prints the figures the claims table allows (D14, P6a)", () => {
    const lite = EDITION.stats.sensitivity.by_agent["gemini-3.5-flash-lite"];
    const flash = EDITION.stats.sensitivity.by_agent["gemini-3.6-flash"];
    expect([lite.n, flash.n]).toEqual([26, 26]);
    expect(lite.point).toBeCloseTo(0.129, 3);
    expect(flash.point).toBeCloseTo(-0.006, 3);
    expect(EDITION.stats.rho["gemini-3.5-flash-lite"].n).toBe(27);
    const gap = EDITION.stats.model_gap;
    expect([gap.lo * 100, gap.hi * 100].map((v) => Math.round(v * 100) / 100)).toEqual([-8.89, 22.22]);
    expect(EDITION.stats.group_split["gemini-3.5-flash-lite"].rule_b.all_failed.mean!).toBeCloseTo(64.4, 1);
  });
});

describe("the exclusion list and the pending prediction", () => {
  it("rule (b) names exactly the sites whose every trial was a harness error", () => {
    expect(EDITION.exclusions.map((e) => e.site_id)).toEqual(["trimet"]);
    expect(EDITION.stats.sensitivity.excluded).toEqual(["trimet"]);
    const trimet = EDITION.exclusions[0];
    expect(trimet.errors).toBe(trimet.recorded);
    expect(EDITION.sites.filter((s) => s.provenance !== null).map((s) => s.site_id)).toEqual(["trimet"]);
  });

  it("keeps a self-reported 0 of 5 out of the list: Target is not an artifact by any rule", () => {
    const target = EDITION.sites.find((s) => s.site_id === "target")!;
    expect(target.results["gemini-3.5-flash-lite"].k).toBe(0);
    expect(target.provenance).toBeNull();
    expect(EDITION.exclusions.map((e) => e.site_id)).not.toContain("target");
  });

  it("carries a pending site as pending only: no provenance mark, no exclusion, no sensitivity", () => {
    for (const p of EDITION.pending) {
      expect(EDITION.sites.find((s) => s.site_id === p.site_id)!.provenance).toBeNull();
      expect(EDITION.exclusions.map((e) => e.site_id)).not.toContain(p.site_id);
      expect(EDITION.stats.sensitivity.excluded).not.toContain(p.site_id);
      expect(p.status).toBe("control not run");
    }
  });

  it("refuses to fold once an instrument-v1 summary exists, until rule (d) is amended in", () => {
    expect(() => deriveEdition({ ...inputs, instrument_summary_exists: true })).toThrow(/rule \(d\)/);
  });
});

describe("findRegistrationDate", () => {
  const doc = [
    "# Methodology",
    "## Amendments (2026-09-23)",
    "### 2026-09-23: the instrument control (registered on 2026-09-23; not yet run)",
    "text",
    "## Later (2026-10-01)",
    "### the instrument-v1 result",
  ].join("\n");

  it("reads the date from the matching heading", () => {
    expect(findRegistrationDate(doc, /instrument control/i)).toBe("2026-09-23");
  });

  it("falls back to the nearest enclosing dated heading", () => {
    expect(findRegistrationDate(doc, /instrument-v1 result/i)).toBe("2026-10-01");
  });

  it("returns null when nothing is registered, never a guess", () => {
    expect(findRegistrationDate(doc, /identity arm/i)).toBeNull();
    expect(findRegistrationDate("## Undated\n### instrument control", /instrument control/i)).toBeNull();
  });
});

describe("the batch-mismatch guard", () => {
  it("accepts the edition's own batch and nothing else", () => {
    expect(editionMatches(EDITION.batch_label)).toBe(true);
    expect(editionMatches("dev")).toBe(false);
    expect(editionMatches("v2-retest")).toBe(false);
  });
});

describe("v1 audit states", () => {
  const row = (flags: Partial<LighthouseResult>): LighthouseResult => ({
    site_id: "x",
    batch_label: "v1",
    lh_total: 50,
    lh_accessibility_tree: 0,
    lh_layout_stability: 0,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    run_at: "2026-08-19T00:00:00Z",
    ...flags,
  });

  it("never reads a v1 zero as a measured absence", () => {
    expect(v1AuditStates(row({}))).toEqual({
      a11y_tree: "fail",
      cls: "below_1.00",
      llms_txt: "fail_or_na",
      webmcp: "not_applicable",
    });
    expect(v1AuditStates(row({ lh_accessibility_tree: 1, lh_layout_stability: 1, lh_llms_txt: 1, lh_webmcp: 1 }))).toEqual({
      a11y_tree: "pass",
      cls: "1.00",
      llms_txt: "pass",
      webmcp: "applied",
    });
  });
});
