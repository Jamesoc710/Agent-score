import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITERATIONS,
  MIN_GROUP,
  MIN_N,
  bootstrapRows,
  comb,
  mean,
  median,
  minAttainableRerandomizationP,
  pFromRerandomization,
  relationshipVerdict,
  rerandomizationNull,
  rerandomizationStatistic,
  type RerandomizationCell,
  type RerandomizationKind,
} from "./stats";
import { measuredRuns } from "./runs";
import {
  answeredTrials,
  classifyAnswer,
  groupSplit,
  registrableDomain,
  sensitivity,
  siteDomains,
  type AnsweredTrials,
  type GroupSplit,
  type SiteCell,
  type SiteDomainInput,
  type TrialAnswer,
} from "./study";
import type { Run } from "./types";

// The cross-language contract for the study functions (S2-2 section 7): scripts/stats_reference.py
// computes every value in the `study_v2` block from the committed v1 artifacts, this file proves
// the TypeScript agrees, and a second layer of cases pins the sentences the pages will print.
const ROOT = join(__dirname, "..");
const vectors = JSON.parse(readFileSync(join(ROOT, "scripts", "tests", "stats-vectors.json"), "utf8"));
const STUDY = vectors.study_v2 as StudyVectors;

// The v1 transcripts themselves: answeredTrials is a rule over transcripts, and pinning 280
// transcripts in the vector file would only copy the artifact. The artifact is committed.
const V1_RUNS: Run[] = readFileSync(join(ROOT, "data", "agent-runs-v1.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Run);

interface Interval {
  point: number;
  lo: number;
  hi: number;
  used: number;
  iterations: number;
}

interface RerandomizationVector {
  cells: RerandomizationCell[];
  sum: RerandomizationResultVector | null;
  dispersion: RerandomizationResultVector | null;
}

interface RerandomizationResultVector {
  statistic: number;
  scale: number;
  p: number;
  min_attainable_p: number;
  informative: number;
  support_min: number;
  support_max: number;
  /** Reachable statistic values only; every other index of the dense pmf is exactly 0. */
  pmf: Record<string, number>;
}

interface StudyVectors {
  sites: Record<string, SiteDomainInput>;
  exclusions: {
    rule_b: string[];
    rule_b_by_agent: Record<string, string[]>;
    rule_d: { status: string; conditional: string[] };
  };
  answered_trials: {
    pooled: AnsweredTrials;
    by_agent: Record<string, AnsweredTrials>;
    self_reported_by_site: Record<string, Record<string, number>>;
    v2_synthetic: {
      sites: Record<string, SiteDomainInput>;
      runs: Run[];
      per_run: (TrialAnswer | null)[];
      result: AnsweredTrials;
      no_transcripts: null;
    };
  };
  cells: Record<string, SiteCell[]>;
  group_split: Record<string, Record<string, GroupSplit>>;
  sensitivity: Record<
    string,
    Record<string, { excluded: string[]; removed: string[]; n: number; rho: number; ci: Interval; group_split: GroupSplit }>
  >;
  bootstrap_rows: {
    v1_model_gap: { arms: string[]; n: number; sites_moved: number; ci: Interval };
    synthetic: { rows: RerandomizationCell[]; ci: Interval };
  };
  rerandomization: Record<string, RerandomizationVector>;
}

const LITE = "gemini-3.5-flash-lite";
const FLASH = "gemini-3.6-flash";
const PRECISION = 12;

const pairedDelta = (rows: RerandomizationCell[]) =>
  mean(rows.map((r) => r.k2 / r.n2 - r.k1 / r.n1));

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

describe("registrableDomain", () => {
  it("takes the last two labels, so a country site and its .com are different domains", () => {
    expect(registrableDomain("https://www.zalando.pt/adidas-x.html")).toBe("zalando.pt");
    expect(registrableDomain("https://www.zalando.com/")).toBe("zalando.com");
    expect(registrableDomain("https://financialaid.oregonstate.edu/cost")).toBe("oregonstate.edu");
    expect(registrableDomain("https://www.dmv.ca.gov/portal/")).toBe("ca.gov");
    expect(registrableDomain("https://www.google.com/sorry/index?continue=x")).toBe("google.com");
  });

  it("treats an IP literal and a single-label host as their own domain", () => {
    expect(registrableDomain("http://127.0.0.1:3100/exhibit/pair-a.html")).toBe("127.0.0.1");
    expect(registrableDomain("chrome-error://chromewebdata/")).toBe("chromewebdata");
    expect(registrableDomain("https://[::1]/")).toBe("::1");
  });

  it("ignores userinfo, ports and case", () => {
    expect(registrableDomain("https://user:pw@Shop.Example.COM:8443/x")).toBe("example.com");
  });

  it("returns null for anything without an authority, never a made-up domain", () => {
    expect(registrableDomain("")).toBeNull();
    expect(registrableDomain(null)).toBeNull();
    expect(registrableDomain("about:blank")).toBeNull();
    expect(registrableDomain("https:///path")).toBeNull();
  });
});

describe("the pinned answer-page domains", () => {
  it("cover every cohort site and equal the start domain except zalando", () => {
    const ids = Object.keys(STUDY.sites).sort();
    expect(ids).toHaveLength(28);
    for (const id of ids) {
      const site = STUDY.sites[id];
      const start = registrableDomain(site.start_url);
      if (id === "zalando") {
        expect(site.answer_domain).toBe("zalando.pt");
        expect(start).toBe("zalando.com");
      } else {
        expect(site.answer_domain, id).toBe(start);
      }
    }
  });

  it("make zalando.pt one of zalando's own domains, so its blocks are on-site", () => {
    const run = V1_RUNS.find((r) => r.site_id === "zalando" && r.failure_mode === "blocked")!;
    expect([...siteDomains(run, STUDY.sites.zalando)].sort()).toEqual(["zalando.com", "zalando.pt"]);
  });
});

// ---------------------------------------------------------------------------
// Answered trials
// ---------------------------------------------------------------------------

describe("answeredTrials on the v1 artifact", () => {
  const pooled = answeredTrials(V1_RUNS, STUDY.sites)!;

  it("reproduces the reference counts, pooled and per agent", () => {
    expect(pooled).toEqual(STUDY.answered_trials.pooled);
    for (const agentId of [LITE, FLASH]) {
      const runs = V1_RUNS.filter((r) => r.agent_id === agentId);
      expect(answeredTrials(runs, STUDY.sites), agentId).toEqual(STUDY.answered_trials.by_agent[agentId]);
    }
  });

  it("THE SENTENCE: 172 answered, 146 matched, 26 self-reported blocks, 0 wrong facts", () => {
    // Hardcoded on purpose, like the 69/135 block in stats.test.ts: these are the numbers the
    // no-wrong-fact card prints, so a regeneration that moves them has to fail here.
    expect(pooled.recorded).toBe(280);
    expect(pooled.answered).toBe(172);
    expect(pooled.matched).toBe(146);
    expect(pooled.corroborated_blocked).toBe(0);
    expect(pooled.self_reported_blocked).toBe(26);
    expect(pooled.wrong_answer).toBe(0);
    expect(pooled.answered).toBe(
      pooled.matched + pooled.corroborated_blocked + pooled.self_reported_blocked + pooled.wrong_answer
    );
  });

  it("splits the 26 self-reports 3 off-site, 4 blank, 19 on-site, with 2 at the first observation", () => {
    expect(pooled.self_reported_split).toEqual({
      off_site: 3,
      blank_report: 4,
      on_site_report: 19,
      first_observation: 2,
    });
    // Seven of the 26 describe a blank page or Google's CAPTCHA rather than the site.
    expect(pooled.self_reported_split.off_site + pooled.self_reported_split.blank_report).toBe(7);
  });

  it("names where each self-report was made, site by site", () => {
    const bySite = new Map<string, Record<string, number>>();
    for (const run of V1_RUNS) {
      const answer = classifyAnswer(run, STUDY.sites[run.site_id]);
      if (answer?.self_reported == null) continue;
      const split = bySite.get(run.site_id) ?? {
        off_site: 0,
        blank_report: 0,
        on_site_report: 0,
        first_observation: 0,
      };
      split[answer.self_reported]++;
      if (answer.first_observation) split.first_observation++;
      bySite.set(run.site_id, split);
    }
    expect(Object.fromEntries([...bySite.entries()].sort())).toEqual(
      STUDY.answered_trials.self_reported_by_site
    );
    // ticketmaster: three on Google's /sorry/ page, two on a blank ticketmaster.com/search.
    expect(bySite.get("ticketmaster")).toEqual({
      off_site: 3,
      blank_report: 2,
      on_site_report: 0,
      first_observation: 0,
    });
    // amazon: two blank pages reported from the first observation, before any action.
    expect(bySite.get("amazon")).toEqual({
      off_site: 0,
      blank_report: 2,
      on_site_report: 0,
      first_observation: 2,
    });
    expect(bySite.get("zalando")!.on_site_report).toBe(9);
  });

  it("counts the 108 non-answers by their recorded mode: 57 timeouts, 45 errors, 6 stuck", () => {
    expect(pooled.not_answered).toEqual({
      count: 108,
      by_failure_mode: { error: 45, navigation_stuck: 6, timeout: 57 },
    });
    expect(pooled.answered + pooled.not_answered.count).toBe(pooled.recorded);
  });

  it("never classes a v1 answer as corroborated or wrong: the harness recorded no signal", () => {
    for (const run of V1_RUNS) {
      const answer = classifyAnswer(run, STUDY.sites[run.site_id]);
      if (answer === null) continue;
      expect(["matched", "self_reported_blocked"]).toContain(answer.answer_class);
      // On v1 the class and the enum agree exactly.
      expect(answer.answer_class === "matched", `${run.site_id} ${run.trial_number}`).toBe(run.success);
    }
  });

  it("finds the two matched answers reported off the site: ticketmaster's, both on google.com", () => {
    // S2-1b section 6 counted three trials that visited google.com and succeeded (ticketmaster
    // 2, ikea 1). The registered rule R-C is about the `done` URL, and ikea's trial reported
    // from ikea.com after its detour, so it is on-site here.
    const offDomain = V1_RUNS.filter((run) => {
      const answer = classifyAnswer(run, STUDY.sites[run.site_id]);
      return answer?.answer_class === "matched" && answer.off_domain;
    });
    expect(pooled.matched_off_domain).toBe(2);
    expect(offDomain.map((r) => r.site_id)).toEqual(["ticketmaster", "ticketmaster"]);
  });

  it("agrees with the published success counts, so the classes add nothing to the rate", () => {
    for (const agentId of [LITE, FLASH]) {
      const measured = measuredRuns(V1_RUNS.filter((r) => r.agent_id === agentId));
      expect(STUDY.answered_trials.by_agent[agentId].matched).toBe(
        measured.filter((r) => r.success).length
      );
      expect(STUDY.answered_trials.by_agent[agentId].matched).toBe(vectors.v1[agentId].successes);
    }
  });
});

describe("answeredTrials on v2-shaped rows", () => {
  const synthetic = STUDY.answered_trials.v2_synthetic;

  it("reproduces the reference classes, one row at a time and in total", () => {
    expect(synthetic.runs.map((run) => classifyAnswer(run, synthetic.sites[run.site_id]))).toEqual(
      synthetic.per_run
    );
    expect(answeredTrials(synthetic.runs, synthetic.sites)).toEqual(synthetic.result);
  });

  it("classes one row of each kind by hand", () => {
    const result = answeredTrials(synthetic.runs, synthetic.sites)!;
    expect(result).toMatchObject({
      recorded: 8,
      answered: 6,
      matched: 3,
      corroborated_blocked: 1,
      self_reported_blocked: 1,
      wrong_answer: 1,
      matched_off_domain: 1,
      not_answered: { count: 2, by_failure_mode: { blocked: 1, timeout: 1 } },
    });
    // The off-domain match is scored a failure by R-C and still classed by its content.
    const offDomain = synthetic.runs[1];
    expect(offDomain.success).toBe(false);
    expect(classifyAnswer(offDomain, synthetic.sites.v2site)).toMatchObject({
      answer_class: "matched",
      off_domain: true,
    });
    // A login wall corroborates; an uncorroborated BLOCKED is self-reported, never wrong.
    expect(classifyAnswer(synthetic.runs[2], synthetic.sites.v2site)!.answer_class).toBe(
      "corroborated_blocked"
    );
    expect(classifyAnswer(synthetic.runs[3], synthetic.sites.v2site)).toMatchObject({
      answer_class: "self_reported_blocked",
      self_reported: "blank_report",
    });
    // A start load that redirected to another registrable domain makes that domain the site's.
    expect(classifyAnswer(synthetic.runs[7], synthetic.sites.v2site)).toMatchObject({
      answer_class: "matched",
      off_domain: false,
    });
  });

  it("returns null when no run carries a transcript, never a table of zeros", () => {
    expect(synthetic.no_transcripts).toBeNull();
    expect(
      answeredTrials(
        [
          { ...synthetic.runs[0], transcript: null },
          { ...synthetic.runs[1], transcript: [] },
        ],
        synthetic.sites
      )
    ).toBeNull();
    expect(answeredTrials([], synthetic.sites)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The exclusion rule, the group split and the sensitivity
// ---------------------------------------------------------------------------

describe("the registered exclusion rule", () => {
  it("derives rule (b) from the rows: a measured site whose every trial is a harness error", () => {
    for (const agentId of [LITE, FLASH]) {
      const bySite = new Map<string, Run[]>();
      for (const run of V1_RUNS.filter((r) => r.agent_id === agentId)) {
        bySite.set(run.site_id, [...(bySite.get(run.site_id) ?? []), run]);
      }
      const ruleB = [...bySite.entries()]
        .filter(([, runs]) => measuredRuns(runs).length > 0 && runs.every((r) => r.failure_mode === "error"))
        .map(([id]) => id)
        .sort();
      expect(ruleB, agentId).toEqual(STUDY.exclusions.rule_b_by_agent[agentId]);
      expect(ruleB, agentId).toEqual(["trimet"]);
    }
    expect(STUDY.exclusions.rule_b).toEqual(["trimet"]);
  });

  it("keeps costco out of rule (b): unmeasured is rule (c), not a harness-error cell", () => {
    expect(STUDY.exclusions.rule_b).not.toContain("costco");
    expect(STUDY.group_split[LITE].published.unmeasured).toEqual(["costco"]);
  });

  it("carries rule (d) as pending, with its predicted site labelled conditional", () => {
    expect(STUDY.exclusions.rule_d.status).toMatch(/pending/);
    expect(STUDY.exclusions.rule_d.conditional).toEqual(["oregon_state"]);
  });
});

describe.each([LITE, FLASH])("groupSplit — %s", (agentId) => {
  const rows = () => STUDY.cells[agentId];

  it("reproduces the reference split under every list", () => {
    const ruleB = STUDY.exclusions.rule_b;
    const conditional = [...ruleB, ...STUDY.exclusions.rule_d.conditional];
    expectSplit(groupSplit(rows()), STUDY.group_split[agentId].published);
    expectSplit(groupSplit(rows(), ruleB), STUDY.group_split[agentId].rule_b);
    expectSplit(groupSplit(rows(), conditional), STUDY.group_split[agentId].rule_b_and_d_conditional);
  });

  it("is invariant to row order and to the order of the exclusion list", () => {
    const base = groupSplit(rows(), ["trimet", "oregon_state"]);
    expect(groupSplit([...rows()].reverse(), ["oregon_state", "trimet"])).toEqual(base);
  });
});

describe("groupSplit — the published figures", () => {
  it("lite: 11 sites at 72.1 [12, 100] succeeded on every trial, 9 at 68.1 [33, 100] on none", () => {
    const split = groupSplit(STUDY.cells[LITE]);
    expect(split.all_succeeded.count).toBe(11);
    expect(split.all_succeeded.mean!).toBeCloseTo(72.1, 1);
    expect([split.all_succeeded.min, split.all_succeeded.max]).toEqual([12, 100]);
    expect(split.all_failed.count).toBe(9);
    expect(split.all_failed.mean!).toBeCloseTo(68.1, 1);
    expect([split.all_failed.min, split.all_failed.max]).toEqual([33, 100]);
    expect(split.all_failed.sites).toContain("trimet");
  });

  it("lite under rule (b): 8 at 64.4; with oregon_state also removed, 7 at 66.7", () => {
    const ruleB = groupSplit(STUDY.cells[LITE], ["trimet"]);
    expect(ruleB.removed).toEqual(["trimet"]);
    expect(ruleB.all_failed.count).toBe(8);
    expect(ruleB.all_failed.mean!).toBeCloseTo(64.4, 1);
    expect(ruleB.all_succeeded.count).toBe(11);
    const conditional = groupSplit(STUDY.cells[LITE], ["trimet", "oregon_state"]);
    expect(conditional.all_failed.count).toBe(7);
    expect(conditional.all_failed.mean!).toBeCloseTo(66.7, 1);
  });

  it("3.6-flash: 13 at 61.4 and 8 at 64.1; under (b) 7 at 59.3; conditional 6 at 61.2", () => {
    const published = groupSplit(STUDY.cells[FLASH]);
    expect([published.all_succeeded.count, published.all_failed.count]).toEqual([13, 8]);
    expect(published.all_succeeded.mean!).toBeCloseTo(61.4, 1);
    expect(published.all_failed.mean!).toBeCloseTo(64.1, 1);
    expect(groupSplit(STUDY.cells[FLASH], ["trimet"]).all_failed.mean!).toBeCloseTo(59.3, 1);
    expect(groupSplit(STUDY.cells[FLASH], ["trimet", "oregon_state"]).all_failed.mean!).toBeCloseTo(61.2, 1);
  });

  it("nulls the mean of a group below MIN_GROUP and counts a site with no static score", () => {
    const rows: SiteCell[] = [
      { site_id: "a", k: 5, n: 5, lh_total: 100 },
      { site_id: "b", k: 5, n: 5, lh_total: null },
      { site_id: "c", k: 0, n: 5, lh_total: 40 },
      { site_id: "d", k: 0, n: 5, lh_total: 60 },
      { site_id: "e", k: 0, n: 5, lh_total: 80 },
      { site_id: "f", k: 2, n: 5, lh_total: 10 },
      { site_id: "g", k: 0, n: 0, lh_total: 99 },
    ];
    const split = groupSplit(rows, ["zzz"]);
    expect(split.all_succeeded).toEqual({
      sites: ["a", "b"],
      count: 2,
      dropped_null_lh: 1,
      mean: null,
      min: null,
      max: null,
    });
    expect(split.all_failed).toEqual({
      sites: ["c", "d", "e"],
      count: 3,
      dropped_null_lh: 0,
      mean: 60,
      min: 40,
      max: 80,
    });
    expect(split.all_failed.count).toBeGreaterThanOrEqual(MIN_GROUP);
    expect(split.unmeasured).toEqual(["g"]);
    expect(split.excluded).toEqual(["zzz"]);
    expect(split.removed).toEqual([]);
  });
});

describe.each([LITE, FLASH])("sensitivity — %s", (agentId) => {
  it("reproduces the reference rho, interval and n under rule (b) and the conditional list", () => {
    for (const [name, list] of [
      ["rule_b", STUDY.exclusions.rule_b],
      ["rule_b_and_d_conditional", [...STUDY.exclusions.rule_b, ...STUDY.exclusions.rule_d.conditional]],
    ] as const) {
      const vector = STUDY.sensitivity[agentId][name];
      const result = sensitivity(STUDY.cells[agentId], [...list])!;
      expect(result.n, name).toBe(vector.n);
      expect(result.removed, name).toEqual(vector.removed);
      expect(result.rho, name).toBeCloseTo(vector.rho, PRECISION);
      expect(result.ci.point, name).toBeCloseTo(vector.ci.point, PRECISION);
      expect(result.ci.lo, name).toBeCloseTo(vector.ci.lo, PRECISION);
      expect(result.ci.hi, name).toBeCloseTo(vector.ci.hi, PRECISION);
      expect(result.ci.used, name).toBe(vector.ci.used);
      expect(result.ci.iterations, name).toBe(DEFAULT_ITERATIONS);
      expectSplit(result.group_split, vector.group_split);
    }
  });

  it("uses the same list for the correlation and the group split", () => {
    const result = sensitivity(STUDY.cells[agentId], ["trimet"])!;
    expect(result.group_split).toEqual(groupSplit(STUDY.cells[agentId], ["trimet"]));
    expect(result.excluded).toEqual(result.group_split.excluded);
  });

  it("still spans zero: the null holds under every rule", () => {
    for (const list of [["trimet"], ["trimet", "oregon_state"]]) {
      expect(relationshipVerdict(sensitivity(STUDY.cells[agentId], list)!.ci)).toBe("none");
    }
  });
});

describe("sensitivity — the published figures", () => {
  it("under rule (b), n = 26: lite +0.129, 3.6-flash -0.006", () => {
    const lite = sensitivity(STUDY.cells[LITE], ["trimet"])!;
    const flash = sensitivity(STUDY.cells[FLASH], ["trimet"])!;
    expect(lite.n).toBe(26);
    expect(flash.n).toBe(26);
    expect(lite.rho).toBeCloseTo(0.129, 3);
    expect(flash.rho).toBeCloseTo(-0.006, 3);
  });

  it("with oregon_state also removed (conditional on rule (d)), n = 25: +0.112 and -0.046", () => {
    expect(sensitivity(STUDY.cells[LITE], ["trimet", "oregon_state"])!.rho).toBeCloseTo(0.112, 3);
    expect(sensitivity(STUDY.cells[FLASH], ["trimet", "oregon_state"])!.rho).toBeCloseTo(-0.046, 3);
  });

  it("reproduces the published n = 27 correlation when nothing is excluded", () => {
    for (const agentId of [LITE, FLASH]) {
      const result = sensitivity(STUDY.cells[agentId], [])!;
      expect(result.n).toBe(27);
      expect(result.rho).toBeCloseTo(vectors.v1[agentId].spearman, PRECISION);
      expect(result.ci.lo).toBeCloseTo(vectors.v1[agentId].spearman_ci.lo, PRECISION);
      expect(result.ci.hi).toBeCloseTo(vectors.v1[agentId].spearman_ci.hi, PRECISION);
    }
  });

  it("returns null below MIN_N rather than a correlation over two sites", () => {
    const rows = STUDY.cells[LITE].filter((r) => r.n > 0).slice(0, MIN_N);
    expect(sensitivity(rows, [])).not.toBeNull();
    expect(sensitivity(rows, [rows[0].site_id])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bootstrapRows: the paired model gap
// ---------------------------------------------------------------------------

function pairedCells(): RerandomizationCell[] {
  const [first, second] = STUDY.bootstrap_rows.v1_model_gap.arms;
  const byId = new Map(STUDY.cells[second].map((c) => [c.site_id, c]));
  return STUDY.cells[first]
    .filter((c) => c.n > 0 && byId.get(c.site_id)!.n > 0)
    .map((c) => ({ site_id: c.site_id, k1: c.k, n1: c.n, k2: byId.get(c.site_id)!.k, n2: byId.get(c.site_id)!.n }));
}

describe("bootstrapRows", () => {
  const cells = pairedCells();

  it("reproduces the reference paired interval for the v1 model gap", () => {
    const vector = STUDY.bootstrap_rows.v1_model_gap;
    expect(vector.arms).toEqual([LITE, FLASH]);
    expect(cells).toHaveLength(vector.n);
    const ci = bootstrapRows(cells, (r) => r.site_id, pairedDelta)!;
    expect(ci.point).toBeCloseTo(vector.ci.point, PRECISION);
    expect(ci.lo).toBeCloseTo(vector.ci.lo, PRECISION);
    expect(ci.hi).toBeCloseTo(vector.ci.hi, PRECISION);
    expect(ci.used).toBe(vector.ci.used);
    expect(ci.iterations).toBe(DEFAULT_ITERATIONS);
    expect(cells.filter((c) => c.k1 !== c.k2)).toHaveLength(vector.sites_moved);
  });

  it("THE MODEL GAP: +5.9 points, 95% CI [-8.9, +22.2], spanning zero; 11 of 27 sites moved", () => {
    // G2 section 7 reported [-9.6, +21.5] from its own scratch resampler; this stream is the
    // page's seeded one, and the point estimate and the verdict are the same.
    const ci = bootstrapRows(cells, (r) => r.site_id, pairedDelta)!;
    expect(ci.point * 100).toBeCloseTo(5.9, 1);
    expect(ci.lo * 100).toBeCloseTo(-8.9, 1);
    expect(ci.hi * 100).toBeCloseTo(22.2, 1);
    expect(relationshipVerdict(ci)).toBe("none");
    expect(cells.filter((c) => c.k1 !== c.k2)).toHaveLength(11);
    expect(ci.point).toBeCloseTo((77 - 69) / 5 / 27, PRECISION);
  });

  it("is invariant to the order rows arrive in", () => {
    const base = bootstrapRows(cells, (r) => r.site_id, pairedDelta);
    expect(bootstrapRows([...cells].reverse(), (r) => r.site_id, pairedDelta)).toEqual(base);
    expect(bootstrapRows([...cells.slice(9), ...cells.slice(0, 9)], (r) => r.site_id, pairedDelta)).toEqual(base);
  });

  it("reproduces the three-row synthetic interval", () => {
    const vector = STUDY.bootstrap_rows.synthetic;
    const ci = bootstrapRows(vector.rows, (r) => r.site_id, pairedDelta)!;
    expect(ci.point).toBeCloseTo(vector.ci.point, PRECISION);
    expect(ci.lo).toBeCloseTo(vector.ci.lo, PRECISION);
    expect(ci.hi).toBeCloseTo(vector.ci.hi, PRECISION);
    expect(ci.used).toBe(vector.ci.used);
    expect(ci.point).toBeCloseTo(0.2, PRECISION);
  });

  it("refuses a duplicate key, and returns null for an uncomputable statistic", () => {
    expect(() =>
      bootstrapRows([cells[0], { ...cells[0] }], (r) => r.site_id, pairedDelta)
    ).toThrow(/duplicate key/);
    expect(bootstrapRows(cells, (r) => r.site_id, () => null)).toBeNull();
    expect(bootstrapRows([], (r: RerandomizationCell) => r.site_id, pairedDelta)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The exact within-site rerandomization null
// ---------------------------------------------------------------------------

describe("rerandomizationNull", () => {
  const kinds: RerandomizationKind[] = ["sum", "dispersion"];

  it.each(Object.keys(STUDY.rerandomization))("reproduces the reference null: %s", (name) => {
    const vector = STUDY.rerandomization[name];
    for (const kind of kinds) {
      const expected = vector[kind];
      const distribution = rerandomizationNull(vector.cells, kind);
      if (expected === null) {
        expect(distribution, kind).toBeNull();
        continue;
      }
      expect(distribution, kind).not.toBeNull();
      const statistic = rerandomizationStatistic(vector.cells, kind)!;
      expect(statistic.value, kind).toBe(expected.statistic);
      expect(statistic.scale, kind).toBe(expected.scale);
      expect(distribution!.scale, kind).toBe(expected.scale);
      expect(distribution!.informative, kind).toBe(expected.informative);
      expect(distribution!.min, kind).toBe(expected.support_min);
      expect(distribution!.min + distribution!.pmf.length - 1, kind).toBe(expected.support_max);
      const reachable = new Set<number>();
      for (const [value, p] of Object.entries(expected.pmf)) {
        const index = Number(value) - distribution!.min;
        reachable.add(index);
        expect(distribution!.pmf[index], `${kind} T=${value}`).toBeCloseTo(p, PRECISION);
      }
      distribution!.pmf.forEach((p, i) => {
        if (!reachable.has(i)) expect(p, `${kind}[${i}]`).toBe(0);
      });
      expect(pFromRerandomization(distribution!, statistic.value), kind).toBeCloseTo(expected.p, PRECISION);
      expect(minAttainableRerandomizationP(distribution!), kind).toBeCloseTo(
        expected.min_attainable_p,
        PRECISION
      );
      let total = 0;
      for (const p of distribution!.pmf) total += p;
      expect(total, kind).toBeCloseTo(1, PRECISION);
    }
  });

  it("THE MODEL GAP TEST: S = 8, p = 0.1750 two-sided; D = 118, p = 4.6e-9", () => {
    const cells = pairedCells();
    const sum = rerandomizationNull(cells, "sum")!;
    const sumStatistic = rerandomizationStatistic(cells, "sum")!;
    expect(sumStatistic).toEqual({ value: 8, scale: 5 });
    expect(pFromRerandomization(sum, 8)).toBeCloseTo(0.175, 4);

    const dispersion = rerandomizationNull(cells, "dispersion")!;
    expect(rerandomizationStatistic(cells, "dispersion")!.value).toBe(118);
    const p = pFromRerandomization(dispersion, 118);
    expect(p).toBeLessThan(1e-8);
    expect(p / 4.57e-9).toBeCloseTo(1, 2);
    // The two models are not distinguishable in level, and disagree site by site far beyond
    // trial noise: the panel's two headline sentences.
    expect(pFromRerandomization(sum, 8)).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.05);
    // Only the sites with a total strictly between 0 and 10 carry randomness.
    expect(sum.informative).toBe(cells.filter((c) => c.k1 + c.k2 > 0 && c.k1 + c.k2 < 10).length);
  });

  it("agrees with a two-site null worked by hand", () => {
    const cells: RerandomizationCell[] = [
      { site_id: "a", k1: 0, n1: 2, k2: 2, n2: 2 },
      { site_id: "b", k1: 1, n1: 2, k2: 1, n2: 2 },
    ];
    // Per site: x in {0, 1, 2} with probabilities 1/6, 4/6, 1/6; terms 2x - 2 in {-2, 0, 2}.
    const sum = rerandomizationNull(cells, "sum")!;
    expect(sum.scale).toBe(2);
    expect(sum.min).toBe(-4);
    expect(sum.pmf).toHaveLength(9);
    expect(sum.pmf[0]).toBeCloseTo(1 / 36, PRECISION);
    expect(sum.pmf[4]).toBeCloseTo(18 / 36, PRECISION);
    expect(rerandomizationStatistic(cells, "sum")!.value).toBe(2);
    expect(pFromRerandomization(sum, 2)).toBeCloseTo(0.5, PRECISION);
    expect(minAttainableRerandomizationP(sum)).toBeCloseTo(2 / 36, PRECISION);

    const dispersion = rerandomizationNull(cells, "dispersion")!;
    expect(rerandomizationStatistic(cells, "dispersion")!.value).toBe(4);
    expect(pFromRerandomization(dispersion, 4)).toBeCloseTo(20 / 36, PRECISION);
    expect(minAttainableRerandomizationP(dispersion)).toBeCloseTo(4 / 36, PRECISION);
  });

  it("handles unequal arms: 5 versus 7 keeps every term an integer with g = 1", () => {
    const vector = STUDY.rerandomization.five_v_seven;
    expect(vector.sum!.scale).toBe(1);
    expect(rerandomizationStatistic(vector.cells, "sum")!.value).toBe(
      vector.cells.reduce((s, c) => s + 12 * c.k2 - 7 * (c.k1 + c.k2), 0)
    );
    // A p is a probability even when the float pmf sums to 1 + 2e-16.
    expect(vector.sum!.p).toBeLessThanOrEqual(1);
  });

  it("returns null when nothing is random, and for no cells", () => {
    expect(STUDY.rerandomization.all_boundary.sum).toBeNull();
    expect(rerandomizationNull(STUDY.rerandomization.all_boundary.cells, "sum")).toBeNull();
    expect(rerandomizationNull(STUDY.rerandomization.all_boundary.cells, "dispersion")).toBeNull();
    expect(rerandomizationNull([], "sum")).toBeNull();
    expect(rerandomizationStatistic([], "sum")).toBeNull();
    expect(rerandomizationNull([{ site_id: "x", k1: 0, n1: 0, k2: 0, n2: 0 }], "sum")).toBeNull();
  });

  it("throws on a malformed cell rather than reporting a p over invented counts", () => {
    expect(() => rerandomizationNull([{ site_id: "x", k1: 6, n1: 5, k2: 0, n2: 5 }], "sum")).toThrow(
      /malformed/
    );
    expect(() => rerandomizationNull([{ site_id: "x", k1: 1.5, n1: 5, k2: 0, n2: 5 }], "sum")).toThrow(
      /malformed/
    );
  });

  it("is invariant to the order cells arrive in", () => {
    const cells = pairedCells();
    const base = rerandomizationNull(cells, "dispersion");
    expect(rerandomizationNull([...cells].reverse(), "dispersion")).toEqual(base);
  });
});

describe("comb and median", () => {
  it("computes exact binomial coefficients", () => {
    expect(comb(10, 5)).toBe(252);
    expect(comb(14, 7)).toBe(3432);
    expect(comb(52, 26)).toBe(495918532948104);
    expect(comb(5, 0)).toBe(1);
    expect(comb(5, 6)).toBe(0);
    expect(comb(5, -1)).toBe(0);
  });

  it("takes the mean of the middle two for an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectSplit(actual: GroupSplit, expected: GroupSplit) {
  expect(actual.excluded).toEqual(expected.excluded);
  expect(actual.removed).toEqual(expected.removed);
  expect(actual.unmeasured).toEqual(expected.unmeasured);
  for (const group of ["all_succeeded", "all_failed"] as const) {
    expect(actual[group].sites, group).toEqual(expected[group].sites);
    expect(actual[group].count, group).toBe(expected[group].count);
    expect(actual[group].dropped_null_lh, group).toBe(expected[group].dropped_null_lh);
    expect(actual[group].min, group).toBe(expected[group].min);
    expect(actual[group].max, group).toBe(expected[group].max);
    if (expected[group].mean === null) expect(actual[group].mean, group).toBeNull();
    else expect(actual[group].mean!, group).toBeCloseTo(expected[group].mean!, PRECISION);
  }
}
