import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ardSchemaOutcome,
  buildPanelRow,
  extractLighthouseRow,
  invalidReason,
  llmsTxtOutcome,
  selectMedianRepeat,
  toLighthouseResult,
  type Lhr,
  type LhrAudit,
} from "../lane1-extract";

// Lane 1's extraction had no fixture and no test in v1 (design S2-7 §3). Two retained 13.3.0
// reports pin it: twilio.com (three audits in the denominator, the CLS score on the 0.9 line,
// a failing llms.txt) and example.com (A3 F1's two-audit case, category score 1.0).

const ROOT = join(__dirname, "..", "..");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Lhr;

const twilio = fixture("lhr-twilio-13.3.0.json");
const example = fixture("lhr-example-13.3.0.json");

// TODO(P4): add lhr-twilio-13.5.0.json, generated from the 13.5.0 companion batch
// (data/lhr/lh-v2-<yyyymmdd>-13.5.0/twilio.<median repeat>.json, fullPageScreenshot removed), and
// pin the seven-audit shape: ard-schema's status as measured that day, lighthouse_version
// "13.5.0", and a category with seven auditRefs (S2-7 §3, amended R2-01).

describe("the twilio.com fixture (13.3.0, system Chrome 152, 2026-09-08)", () => {
  const row = extractLighthouseRow(twilio, { clsRule: "v1" });

  it("carries v1's typed row: the mean and the four flags under v1's rule", () => {
    expect(row.lh_total).toBe(30);
    expect(row.lh_accessibility_tree).toBe(0);
    expect(row.lh_layout_stability).toBe(0); // CLS 0.9 is not === 1
    expect(row.lh_llms_txt).toBe(0);
    expect(row.lh_webmcp).toBe(0);
  });

  it("records Chrome's fraction: CLS at 0.90 passes Lighthouse's >= 0.9, so 1 of 3", () => {
    // S2-7 §3 wrote "lh_passed 0 of 3"; Lighthouse's own renderer says 1 of 3 (asserted below
    // against ReportUtils), because the same section's CLS verdict is "pass" under >= 0.9.
    expect(row.lh_passed).toBe(1);
    expect(row.lh_passable).toBe(3);
  });

  it("records CLS as a continuous score with both verdicts derivable", () => {
    expect(row.lh_cls_score).toBe(0.9);
    expect(row.lh_cls_value).toBeCloseTo(0.0995, 4);
    expect(row.lh_cls_lighthouse_pass).toBe(1);
    expect(extractLighthouseRow(twilio, { clsRule: "lighthouse" }).lh_layout_stability).toBe(1);
  });

  it("records llms.txt as a failing file, with the audit's reason", () => {
    expect(row.lh_llms_txt_status).toBe("fail");
    expect(row.lh_llms_txt_branch).toBe("non_conforming");
    expect(row.lh_llms_txt_reasons).toEqual(['File is missing a required H1 header (e.g., "# Title").']);
  });

  it("records WebMCP as not applied (the browser exposed no API), never as adoption", () => {
    expect(row.lh_webmcp_applied).toBe(0);
    expect(row.lh_webmcp_tool_count).toBeNull();
    expect(row.lh_webmcp_schema_validity).toBeNull();
    expect(row.lh_webmcp_form_gaps).toBeNull();
    for (const id of ["webmcp-form-coverage", "webmcp-registered-tools", "webmcp-schema-validity"]) {
      expect(row.audits[id].scoreDisplayMode).toBe("notApplicable");
    }
  });

  it("records the versions and has no ard-schema audit at 13.3.0", () => {
    expect(row.lighthouse_version).toBe("13.3.0");
    expect(row.chrome_version).toBe("152.0.0.0");
    expect(row.lh_ard_schema_status).toBeNull();
  });

  it("records the run: the emulated phone, the observed denominator, the warnings", () => {
    expect(row.run.category_score).toBe(0.3);
    expect(row.run.category_score_display_mode).toBe("fraction");
    expect(row.run.form_factor).toBe("mobile");
    expect(row.run.throttling_method).toBe("simulate");
    expect(row.run.screen_emulation).toMatchObject({ mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 });
    expect(row.run.requested_url).toBe("https://www.twilio.com/");
    expect(row.run.final_displayed_url).toBe("https://www.twilio.com/en-us");
    expect(row.run.run_warnings).toHaveLength(2);
    expect(row.run.timing_total_ms).toBeCloseTo(55120.57, 2);
    expect(row.run.runtime_error).toBeNull();
    expect(row.run.weights).toEqual([
      { id: "agent-accessibility-tree", weight: 1 },
      { id: "webmcp-form-coverage", weight: 0 },
      { id: "webmcp-registered-tools", weight: 0 },
      { id: "webmcp-schema-validity", weight: 0 },
      { id: "cumulative-layout-shift", weight: 1 },
      { id: "llms-txt", weight: 1 },
    ]);
  });

  it("extracts every audit with its display mode and applied weight", () => {
    expect(Object.keys(row.audits).sort()).toEqual([
      "agent-accessibility-tree",
      "cumulative-layout-shift",
      "llms-txt",
      "webmcp-form-coverage",
      "webmcp-registered-tools",
      "webmcp-schema-validity",
    ]);
    expect(row.audits["cumulative-layout-shift"]).toMatchObject({
      score: 0.9,
      scoreDisplayMode: "numeric",
      weight: 1,
      displayValue: "0.099",
    });
    expect(row.audits["agent-accessibility-tree"]).toMatchObject({ score: 0, scoreDisplayMode: "binary", weight: 1 });
  });
});

describe("the example.com fixture (13.3.0, Playwright's Chromium 151, 2026-09-23)", () => {
  const row = extractLighthouseRow(example, { clsRule: "v1" });

  it("is A3 F1's two-audit case: llms.txt absent, category score 1.0", () => {
    expect(row.lh_total).toBe(100);
    expect(row.lh_passed).toBe(2);
    expect(row.lh_passable).toBe(2);
    expect(row.lh_accessibility_tree).toBe(1);
    expect(row.lh_layout_stability).toBe(1);
    expect(row.lh_cls_score).toBe(1);
    expect(row.lh_cls_value).toBe(0);
    expect(row.lh_llms_txt_status).toBe("absent");
    expect(row.lh_llms_txt_branch).toBe("http_4xx");
    expect(row.lh_llms_txt).toBe(0);
    expect(row.run.weights.filter((w) => w.weight > 0).map((w) => w.id)).toEqual([
      "agent-accessibility-tree",
      "cumulative-layout-shift",
    ]);
  });

  it("shows the WebMCP flag measuring the browser: Chromium 151 exposes the API", () => {
    // webmcp-registered-tools is informative with score 1 whenever the API is exposed, so v1's
    // `=== 1` rule records lh_webmcp 1 for a page with no tools.
    expect(row.lh_webmcp_applied).toBe(1);
    expect(row.lh_webmcp_tool_count).toBe(0);
    expect(row.lh_webmcp).toBe(1);
    expect(row.lh_webmcp_schema_validity).toBeNull();
    expect(row.lh_webmcp_form_gaps).toBe(0);
  });

  it("records the pinned browser as its user agent reports it", () => {
    expect(row.lighthouse_version).toBe("13.3.0");
    expect(row.chrome_version).toBe("151.0.0.0");
    expect(row.run.host_user_agent).toContain("HeadlessChrome/151.0.0.0");
  });
});

describe("Chrome's fraction is Lighthouse's own", () => {
  type Renderer = {
    ReportUtils: {
      prepareReportResult(lhr: unknown): { categories: Record<string, unknown> };
      calculateCategoryFraction(category: unknown): { numPassed: number; numPassableAudits: number };
    };
  };

  it.each([
    ["twilio", twilio],
    ["example", example],
  ])("matches ReportUtils.calculateCategoryFraction on %s", async (_name, lhr) => {
    const { ReportUtils } = (await import(
      "lighthouse/report/renderer/report-utils.js"
    )) as unknown as Renderer;
    const prepared = ReportUtils.prepareReportResult(structuredClone(lhr));
    const expected = ReportUtils.calculateCategoryFraction(prepared.categories["agentic-browsing"]);
    const row = extractLighthouseRow(lhr, { clsRule: "v1" });
    expect({ passed: row.lh_passed, passable: row.lh_passable }).toEqual({
      passed: expected.numPassed,
      passable: expected.numPassableAudits,
    });
  });
});

describe("a v1-mode row is comparable with data/lighthouse-v1.json", () => {
  it("has exactly LighthouseResult's fields, in v1's order", () => {
    const v1 = JSON.parse(readFileSync(join(ROOT, "data", "lighthouse-v1.json"), "utf8"));
    const extracted = extractLighthouseRow(twilio, { clsRule: "v1" });
    const row = buildPanelRow("twilio", "lh-v2-test", extracted, { lh_repeat: 1, lh_total_min: 30, lh_total_max: 30 }, { valid: 1, attempted: 1 });
    const typed = toLighthouseResult(row);
    expect(Object.keys(typed)).toEqual(Object.keys(v1.twilio));
    expect(typed.run_at).toBe(twilio.fetchTime);
  });
});

describe("the llms-txt branches (llms-txt.js 13.3.0 :64-81, :104; 13.4.1 :68-74)", () => {
  const audit = (a: Partial<LhrAudit>): LhrAudit => ({ score: null, scoreDisplayMode: "binary", ...a });

  it("reads each branch", () => {
    expect(llmsTxtOutcome(audit({ score: 1 }))).toEqual({ status: "pass", branch: "conforming", reasons: [] });
    expect(llmsTxtOutcome(audit({ scoreDisplayMode: "notApplicable" }))?.status).toBe("absent");
    expect(llmsTxtOutcome(audit({ score: 0, displayValue: "Failed with HTTP status 503" }))).toEqual({
      status: "error",
      branch: "http_5xx",
      reasons: ["Failed with HTTP status 503"],
    });
    expect(llmsTxtOutcome(audit({ score: 0, explanation: "Fetch of llms.txt failed" }))).toEqual({
      status: "error",
      branch: "fetch_failed",
      reasons: ["Fetch of llms.txt failed"],
    });
    expect(llmsTxtOutcome(audit({ scoreDisplayMode: "error", errorMessage: "boom" }))).toEqual({
      status: "error",
      branch: "audit_error",
      reasons: ["boom"],
    });
    expect(llmsTxtOutcome(undefined)).toBeNull();
  });
});

describe("the ard-schema statuses (13.5.0 ard-schema.js:60-131)", () => {
  const audit = (a: Partial<LhrAudit>): LhrAudit => ({ score: null, scoreDisplayMode: "binary", ...a });
  const issues = (...issue: string[]) => ({ type: "table", items: issue.map((i) => ({ element: "x", issue: i, severity: "Error" })) });

  it("reads each branch, and a missing audit (before 13.5.0) as null", () => {
    expect(ardSchemaOutcome(undefined)).toBeNull();
    expect(ardSchemaOutcome(audit({ scoreDisplayMode: "notApplicable", score: null }))?.status).toBe("absent");
    expect(ardSchemaOutcome(audit({ score: 0, explanation: "Catalog file could not be loaded for schema validation." }))).toEqual({
      status: "unloadable",
      reasons: ["Catalog file could not be loaded for schema validation."],
    });
    expect(ardSchemaOutcome(audit({ score: 0, details: issues("Malformed JSON") }))).toEqual({
      status: "fails_validation",
      reasons: ["Malformed JSON"],
    });
    expect(ardSchemaOutcome(audit({ score: 0.9, details: issues("minor") }))?.status).toBe("warnings");
    expect(ardSchemaOutcome(audit({ score: 1 }))?.status).toBe("pass");
  });
});

describe("WebMCP when the audits applied", () => {
  it("counts tools across the imperative and declarative sections, and form gaps", () => {
    const lhr = structuredClone(example);
    lhr.audits!["webmcp-registered-tools"] = {
      score: 1,
      scoreDisplayMode: "informative",
      details: {
        type: "list",
        items: [
          { type: "list-section", value: { type: "table", items: [{ tool: "a" }, { tool: "b" }] } },
          { type: "list-section", value: { type: "table", items: [{ tool: "c" }] } },
        ],
      },
    };
    lhr.audits!["webmcp-schema-validity"] = { score: 0.5, scoreDisplayMode: "binary" };
    lhr.audits!["webmcp-form-coverage"] = {
      score: 1,
      scoreDisplayMode: "informative",
      details: { type: "table", items: [{ node: {} }, { node: {} }] },
    };
    const row = extractLighthouseRow(lhr, { clsRule: "v1" });
    expect(row.lh_webmcp_tool_count).toBe(3);
    expect(row.lh_webmcp_schema_validity).toBe(0.5);
    expect(row.lh_webmcp_form_gaps).toBe(2);
  });
});

describe("the per-site rule", () => {
  const r = (repeat: number, lh_total: number, minute: number) => ({
    repeat,
    lh_total,
    fetch_time: `2026-09-23T10:${String(minute).padStart(2, "0")}:00.000Z`,
  });

  it("takes the median repeat, ties to the earliest fetchTime, with the spread", () => {
    expect(selectMedianRepeat([r(1, 33, 1), r(2, 30, 2), r(3, 30, 3)])).toEqual({ lh_repeat: 2, lh_total_min: 30, lh_total_max: 33 });
    expect(selectMedianRepeat([r(1, 50, 1), r(2, 67, 2), r(3, 33, 3)])).toEqual({ lh_repeat: 1, lh_total_min: 33, lh_total_max: 67 });
    expect(selectMedianRepeat([r(3, 30, 1), r(1, 30, 9), r(2, 30, 5)])?.lh_repeat).toBe(3);
  });

  it("takes the lower of two valid repeats, and refuses fewer than two", () => {
    expect(selectMedianRepeat([r(1, 67, 1), r(3, 33, 3)])).toEqual({ lh_repeat: 3, lh_total_min: 33, lh_total_max: 67 });
    expect(selectMedianRepeat([r(1, 67, 1)])).toBeNull();
    expect(selectMedianRepeat([r(1, 67, 1)], 1)?.lh_repeat).toBe(1);
    expect(selectMedianRepeat([], 1)).toBeNull();
  });

  it("treats a runtimeError or a null category score as an invalid repeat", () => {
    expect(invalidReason(twilio)).toBeNull();
    expect(invalidReason({ ...twilio, runtimeError: { code: "NO_FCP", message: "no paint" } })).toMatch(/NO_FCP/);
    const nullScore = structuredClone(twilio);
    nullScore.categories!["agentic-browsing"]!.score = null;
    expect(invalidReason(nullScore)).toMatch(/score is null/);
    expect(() => extractLighthouseRow(nullScore, { clsRule: "v1" })).toThrow();
  });
});
