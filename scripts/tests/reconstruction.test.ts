import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Lhr } from "../lane1-extract";
import { reconstructSite, v1ConsistentDenominators, type SiteReconstruction } from "../reconstruction";
import type { LighthouseResult } from "../../lib/types";

// The reconstruction check (design S2-7 §5): every v1 flag reproduces or differs for an
// evidenced reason, and no v1 value is edited to make it so.

const ROOT = join(__dirname, "..", "..");
const V1_PATH = join(ROOT, "data", "lighthouse-v1.json");
const V1_COMMIT = "174f603";
// sha256 of data/lighthouse-v1.json at 174f603, for a checkout without that commit.
const V1_SHA256 = "016449e7f4a74163b95d04fd8d39f7c60884fed5bc38e14dae745a4f0d0b0986";

// Sites whose reconstruction differs for a reason outside the fixed enum, named after review.
// Keyed by batch label; empty until a dated 13.3.0 batch exists and its differences are read.
const NAMED_UNEXPLAINED: Record<string, string[]> = {};

const v1 = JSON.parse(readFileSync(V1_PATH, "utf8")) as Record<string, LighthouseResult>;
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8")) as Lhr;

describe("no v1 value was edited", () => {
  it("data/lighthouse-v1.json is byte-identical to the file at 174f603", () => {
    const current = readFileSync(V1_PATH);
    let original: Buffer | null = null;
    try {
      original = execFileSync("git", ["show", `${V1_COMMIT}:data/lighthouse-v1.json`], { cwd: ROOT });
    } catch {
      original = null; // shallow clone: fall back to the pinned digest
    }
    if (original) expect(current.equals(original)).toBe(true);
    expect(createHash("sha256").update(current).digest("hex")).toBe(V1_SHA256);
  });
});

describe("v1's denominator, inferred from its row", () => {
  it("resolves twilio to three audits (A3 F2): 33 is (0 + 1 + 0) / 3", () => {
    expect(v1ConsistentDenominators(v1.twilio)).toEqual([
      {
        weighted_audits: ["agent-accessibility-tree", "cumulative-layout-shift", "llms-txt"],
        size: 3,
        cls_score_min: 1,
        cls_score_max: 1,
      },
    ]);
  });

  it("leaves a 100 with a failing-or-absent llms.txt at two audits", () => {
    const configs = v1ConsistentDenominators({ lh_total: 100, lh_accessibility_tree: 1, lh_layout_stability: 1, lh_llms_txt: 0, lh_webmcp: 0 });
    expect(configs.map((c) => c.weighted_audits)).toEqual([["agent-accessibility-tree", "cumulative-layout-shift"]]);
  });

  it("returns a CLS range when the flag is 0", () => {
    // github in v1: 99 with CLS below 1.00 and llms.txt passing.
    const configs = v1ConsistentDenominators(v1.github);
    const three = configs.find((c) => c.size === 3)!;
    expect(three.cls_score_min).toBeGreaterThanOrEqual(0.96);
    expect(three.cls_score_max).toBeLessThanOrEqual(0.99);
  });
});

describe("reconstructSite", () => {
  it("attributes twilio's change to CLS: 1.00 in v1, 0.90 in the fixture", () => {
    const site = reconstructSite("twilio", v1.twilio, { lhr: fixture("lhr-twilio-13.3.0.json"), path: "fixture" });
    expect(site.status).toBe("differ");
    expect(site.v1).toEqual({ lh_total: 33, lh_accessibility_tree: 0, lh_layout_stability: 1, lh_llms_txt: 0, lh_webmcp: 0 });
    expect(site.v2).toEqual({ lh_total: 30, lh_accessibility_tree: 0, lh_layout_stability: 0, lh_llms_txt: 0, lh_webmcp: 0 });
    expect(site.observed_in_v1_set).toBe(true);
    expect(site.reasons).toEqual(["cls_moved"]);
    expect(site.differences.map((d) => d.field)).toEqual(["lh_layout_stability", "lh_total"]);
  });

  it("matches when nothing moved, and names WebMCP applicability when only the browser did", () => {
    const example = fixture("lhr-example-13.3.0.json");
    const same = { lh_total: 100, lh_accessibility_tree: 1, lh_layout_stability: 1, lh_llms_txt: 0, lh_webmcp: 1 };
    expect(reconstructSite("example", same, { lhr: example, path: "fixture" }).status).toBe("match");
    const site = reconstructSite("example", { ...same, lh_webmcp: 0 }, { lhr: example, path: "fixture" });
    expect(site.status).toBe("differ");
    expect(site.reasons).toEqual(["webmcp_applicability"]);
  });

  it("names a changed llms.txt when the denominator moved and no flag did (the spotify case)", () => {
    const lhr = fixture("lhr-example-13.3.0.json");
    lhr.audits!["llms-txt"] = {
      score: 0,
      scoreDisplayMode: "binary",
      details: { type: "table", items: [{ message: 'File is missing a required H1 header (e.g., "# Title").' }] },
    };
    const category = lhr.categories!["agentic-browsing"]!;
    category.auditRefs = category.auditRefs.map((r) => (r.id === "llms-txt" ? { ...r, weight: 1 } : r));
    category.score = 0.67;
    const v1Row = { lh_total: 100, lh_accessibility_tree: 1, lh_layout_stability: 1, lh_llms_txt: 0, lh_webmcp: 1 };
    const site = reconstructSite("spotify", v1Row, { lhr, path: "fixture" });
    expect(site.v2?.lh_total).toBe(67);
    expect(site.observed_in_v1_set).toBe(false);
    expect(site.differences).toEqual([{ field: "lh_total", v1: 100, v2: 67, reasons: ["llms_status_changed"] }]);
  });

  it("records a site with no median repeat as not measured, never as a difference", () => {
    const site = reconstructSite("costco", v1.costco, null);
    expect(site.status).toBe("not_measured");
    expect(site.v2).toBeNull();
  });
});

// Every committed reconstruction.json (one per dated 13.3.0 batch).
const lhrRoot = join(ROOT, "data", "lhr");
const reports = existsSync(lhrRoot)
  ? readdirSync(lhrRoot)
      .map((batch) => join(lhrRoot, batch, "reconstruction.json"))
      .filter((file) => existsSync(file))
  : [];

describe("committed reconstructions", () => {
  if (reports.length === 0) {
    it.todo("no data/lhr/<batch>/reconstruction.json yet: runs once the dated 13.3.0 batch is reconstructed");
    return;
  }

  for (const file of reports) {
    const report = JSON.parse(readFileSync(file, "utf8")) as {
      batch_label: string;
      sites: Record<string, SiteReconstruction>;
    };
    const named = NAMED_UNEXPLAINED[report.batch_label] ?? [];

    it(`${report.batch_label}: quotes v1 exactly`, () => {
      for (const site of Object.values(report.sites)) {
        const row = v1[site.site_id];
        expect(site.v1).toEqual({
          lh_total: row.lh_total,
          lh_accessibility_tree: row.lh_accessibility_tree,
          lh_layout_stability: row.lh_layout_stability,
          lh_llms_txt: row.lh_llms_txt,
          lh_webmcp: row.lh_webmcp,
        });
      }
    });

    it(`${report.batch_label}: every match row is equal`, () => {
      for (const site of Object.values(report.sites).filter((s) => s.status === "match")) {
        expect(site.v2).toEqual(site.v1);
        expect(site.differences).toEqual([]);
      }
    });

    it(`${report.batch_label}: every differ row carries an evidenced reason or is named`, () => {
      for (const site of Object.values(report.sites).filter((s) => s.status === "differ")) {
        expect(site.reasons.length).toBeGreaterThan(0);
        if (site.reasons.includes("unexplained")) expect(named).toContain(site.site_id);
      }
    });

    it(`${report.batch_label}: is the fold of its retained reports`, () => {
      for (const site of Object.values(report.sites)) {
        if (!site.lhr) continue;
        const lhr = JSON.parse(readFileSync(join(ROOT, site.lhr), "utf8")) as Lhr;
        const again = reconstructSite(site.site_id, v1[site.site_id], { lhr, path: site.lhr }, pickGet(site.evidence));
        expect(again).toEqual(site);
      }
    });
  }
});

function pickGet(evidence: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(evidence).filter(([k]) => k.startsWith("llms_get_")));
}
