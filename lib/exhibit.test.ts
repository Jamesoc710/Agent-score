import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCohort } from "../scripts/cohort-csv";
import { EXHIBIT_BATCH, deriveExhibit, routeFor, successAcrossPages } from "./exhibit";
import { EXHIBIT } from "./exhibit-data";
import { measuredRuns } from "./runs";
import type { LighthouseResult, Run } from "./types";

// The authored Goodhart exhibit (docs/EXHIBIT.md). Two things are tested here and they are
// different in kind.
//
// The first is a freshness contract, the same one scoring-vectors.json and stats-vectors.json
// provide: data/exhibit-goodhart.json is committed because the page cannot read JSONL at
// request time, so it has to be provably the fold of the artifacts it claims to summarise.
//
// The second is an isolation contract, and it is the one that matters most. The exhibit exists
// to make a point about the cohort's measurements; it must not become one of them. So the
// separation between the two datasets is asserted from both directions rather than assumed.

const ROOT = join(__dirname, "..");
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const readJsonl = (p: string): Run[] =>
  readFileSync(join(ROOT, p), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Run);

const exhibitSites = readCohort(join(ROOT, "data", "exhibit-cohort.csv"));
const cohortSites = readCohort(join(ROOT, "data", "cohort.csv"));

const lighthouseRows = (file: string): LighthouseResult[] =>
  Object.entries(readJson(file) as Record<string, LighthouseResult>).map(([site_id, row]) => ({
    ...row,
    site_id,
  }));

const exhibitRuns = readJsonl("data/agent-runs-goodhart.jsonl");
const exhibitLighthouse = lighthouseRows("data/lighthouse-goodhart.json");

describe("the committed derivation matches its artifacts", () => {
  it("is exactly the fold of the exhibit CSV, the Lane 1 batch and the Lane 2 batch", () => {
    const derived = deriveExhibit(exhibitSites, exhibitLighthouse, exhibitRuns, EXHIBIT_BATCH);
    expect(derived).toEqual(readJson("data/exhibit-goodhart.json"));
  });

  it("is what the app actually imports", () => {
    expect(EXHIBIT).toEqual(readJson("data/exhibit-goodhart.json"));
  });

  it("carries every recorded trial, with its transcript", () => {
    const carried = EXHIBIT.pages.flatMap((p) => p.agents.flatMap((a) => a.runs));
    expect(carried).toHaveLength(exhibitRuns.length);
    // The transcripts are the evidence for the failure labels; a summary without them would
    // be an assertion rather than a record.
    expect(carried.every((r) => Array.isArray(r.transcript) && r.transcript.length > 0)).toBe(true);
  });

  it("applies the pre-registered denominator rule rather than its own", () => {
    for (const page of EXHIBIT.pages) {
      for (const agent of page.agents) {
        const measured = measuredRuns(agent.runs);
        expect(agent.measured_trial_count).toBe(measured.length);
        expect(agent.excluded_trial_count).toBe(agent.runs.length - measured.length);
        expect(agent.success_count).toBe(measured.filter((r) => r.success).length);
        expect(agent.success_rate).toBe(
          measured.length > 0 ? measured.filter((r) => r.success).length / measured.length : null
        );
      }
    }
  });

  it("reports no rate at all rather than 0% when nothing was measured", () => {
    const empty = deriveExhibit(exhibitSites, [], [], EXHIBIT_BATCH);
    expect(empty.pages.every((p) => p.agents.length === 0)).toBe(true);
    expect(empty.run_window).toBeNull();
  });
});

describe("the exhibit is isolated from the cohort", () => {
  it("is its own batch, and never v1", () => {
    expect(EXHIBIT.batch_label).toBe(EXHIBIT_BATCH);
    expect(EXHIBIT.batch_label).not.toBe("v1");
    expect(exhibitRuns.every((r) => r.batch_label === EXHIBIT_BATCH)).toBe(true);
    expect(exhibitLighthouse.every((r) => r.batch_label === EXHIBIT_BATCH)).toBe(true);
  });

  it("shares no site_id with the 28-site cohort", () => {
    const cohortIds = new Set(cohortSites.map((s) => s.site_id));
    expect(cohortIds.size).toBe(28);
    for (const site of exhibitSites) expect(cohortIds.has(site.site_id)).toBe(false);
  });

  it("puts no exhibit row in the published v1 artifacts", () => {
    const exhibitIds = new Set(exhibitSites.map((s) => s.site_id));
    const v1Runs = readJsonl("data/agent-runs-v1.jsonl");
    expect(v1Runs.some((r) => exhibitIds.has(r.site_id))).toBe(false);
    expect(v1Runs.every((r) => r.batch_label === "v1")).toBe(true);

    const v1Lighthouse = lighthouseRows("data/lighthouse-v1.json");
    expect(v1Lighthouse.some((r) => exhibitIds.has(r.site_id))).toBe(false);
    expect(v1Lighthouse).toHaveLength(28);
  });

  it("puts no cohort row in the exhibit batch", () => {
    const cohortIds = new Set(cohortSites.map((s) => s.site_id));
    expect(exhibitRuns.some((r) => cohortIds.has(r.site_id))).toBe(false);
    expect(exhibitLighthouse.some((r) => cohortIds.has(r.site_id))).toBe(false);
  });

  it("drops rows from any other batch, so a mixed artifact cannot blend two experiments", () => {
    const stray: Run = { ...exhibitRuns[0], batch_label: "v1", site_id: "stripe" };
    const derived = deriveExhibit(exhibitSites, exhibitLighthouse, [...exhibitRuns, stray]);
    const carried = derived.pages.flatMap((p) => p.agents.flatMap((a) => a.runs));
    expect(carried).toHaveLength(exhibitRuns.length);
    expect(carried.some((r) => r.site_id === "stripe")).toBe(false);
  });
});

describe("the pair is registered as a pair", () => {
  it("asks both halves the same question against the same key", () => {
    const [a, b] = exhibitSites;
    expect(a.question).toBe(b.question);
    expect(a.answer_substring).toBe(b.answer_substring);
    expect(a.match_rule).toBe(b.match_rule);
    expect(EXHIBIT.question).toBe(a.question);
    expect(EXHIBIT.answer_substring).toBe(a.answer_substring);
  });

  it("runs both halves under the same agents and the same trial count", () => {
    const [a, b] = EXHIBIT.pages;
    expect(a.agents.map((x) => x.agent_id)).toEqual(b.agents.map((x) => x.agent_id));
    expect(a.agents.map((x) => x.runs.length)).toEqual(b.agents.map((x) => x.runs.length));
  });

  it("scores both halves on the same static axis", () => {
    const [a, b] = EXHIBIT.pages;
    expect(a.lighthouse?.lh_total).toBe(b.lighthouse?.lh_total);
    expect(a.lighthouse?.lh_accessibility_tree).toBe(b.lighthouse?.lh_accessibility_tree);
    expect(a.lighthouse?.lh_layout_stability).toBe(b.lighthouse?.lh_layout_stability);
  });

  it("totals successes across the panel for each half", () => {
    for (const page of EXHIBIT.pages) {
      const total = successAcrossPages(EXHIBIT, page.site.site_id);
      expect(total.measured).toBe(
        page.agents.reduce((n, a) => n + a.measured_trial_count, 0)
      );
      expect(total.successes).toBe(page.agents.reduce((n, a) => n + a.success_count, 0));
    }
    expect(successAcrossPages(EXHIBIT, "not-a-page")).toEqual({ successes: 0, measured: 0 });
  });
});

describe("routeFor", () => {
  it("keeps the path and drops the localhost origin the run was served from", () => {
    expect(routeFor("http://127.0.0.1:3100/exhibit/pair-a.html")).toBe("/exhibit/pair-a.html");
    expect(EXHIBIT.pages.map((p) => p.route)).toEqual([
      "/exhibit/pair-a.html",
      "/exhibit/pair-b.html",
    ]);
  });

  it("returns anything unparseable unchanged rather than throwing on a page render", () => {
    expect(routeFor("not a url")).toBe("not a url");
  });
});
