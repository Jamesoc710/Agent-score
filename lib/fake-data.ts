// Dev fixtures. Rendered only when USE_FAKE_DATA=true — never a fallback for a
// misconfigured backend.
//
// The three rows are a faithful sample of data/cohort.csv (same site_ids, questions, answer
// keys and match rules), so clicking through in fixture mode exercises the same shapes the
// real cohort produces. The behavioral numbers are invented.

import {
  Site,
  LighthouseResult,
  Run,
  SiteLeaderboardEntry,
  CorrelationPoint,
} from "./types";

const FIXTURE_AGENT = "gemini-2.0-flash";
const FIXTURE_BATCH = "fixtures";

export const FAKE_SITES: Site[] = [
  {
    site_id: "stripe",
    name: "Stripe",
    tier: "anchor",
    start_url: "https://stripe.com",
    question: "What is Stripe's standard rate for online domestic card payments?",
    answer_substring: "2.9%",
    match_rule: "exact; case/space-normalize",
    flag: "",
    answer_note:
      "Standard online card processing rate, 2.9% + 30 cents per transaction, from the pricing page.",
  },
  {
    site_id: "irs",
    name: "IRS",
    tier: "government",
    start_url: "https://www.irs.gov",
    question: "What is the 2025 standard deduction for a single filer?",
    answer_substring: "15750",
    match_rule: "strip $, commas",
    flag: "",
    answer_note:
      "2025 standard deduction for a single filer, $15,750. Discriminates from MFJ ($31,500) and head of household ($23,625).",
  },
  {
    site_id: "ca_dmv",
    name: "California DMV",
    tier: "government",
    start_url: "https://www.dmv.ca.gov",
    question: "By what time must written tests be completed at California DMV offices?",
    answer_substring: "4:30",
    match_rule: "exact",
    flag: "",
    answer_note:
      "REAL ID page. Written tests are unavailable at DMV offices after 4:30 p.m. (buried in step 3).",
  },
];

export const FAKE_LIGHTHOUSE: LighthouseResult[] = [
  {
    site_id: "stripe",
    batch_label: FIXTURE_BATCH,
    lh_total: 82,
    lh_accessibility_tree: 1,
    lh_layout_stability: 1,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    run_at: "2026-05-30T10:00:00Z",
  },
  {
    site_id: "irs",
    batch_label: FIXTURE_BATCH,
    lh_total: 44,
    lh_accessibility_tree: 0,
    lh_layout_stability: 0,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    run_at: "2026-05-30T10:05:00Z",
  },
  {
    site_id: "ca_dmv",
    batch_label: FIXTURE_BATCH,
    lh_total: 31,
    lh_accessibility_tree: 0,
    lh_layout_stability: 1,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    run_at: "2026-05-30T10:10:00Z",
  },
];

function fakeRun(
  site_id: string,
  trial_number: number,
  success: boolean,
  step_count: number,
  duration_seconds: number,
  failure_mode: Run["failure_mode"],
  run_at: string,
  transcript?: Run["transcript"]
): Run {
  return {
    site_id,
    agent_id: FIXTURE_AGENT,
    batch_label: FIXTURE_BATCH,
    trial_number,
    success,
    step_count,
    duration_seconds,
    failure_mode,
    transcript: transcript ?? null,
    run_at,
  };
}

export const FAKE_RUNS: Run[] = [
  // Stripe — 4/5 success
  fakeRun("stripe", 1, true, 3, 14, "success", "2026-05-30T11:00:00Z", [
    { step: 0, url: "https://stripe.com", action: { action: "click", selector: "Pricing", reasoning: "Pricing page should carry the rate." } },
    { step: 1, url: "https://stripe.com/pricing", action: { action: "done", answer: "2.9% + 30c per successful card charge", reasoning: "Found the standard rate." } },
  ]),
  fakeRun("stripe", 2, true, 4, 18, "success", "2026-05-30T11:03:00Z"),
  fakeRun("stripe", 3, true, 3, 12, "success", "2026-05-30T11:06:00Z"),
  fakeRun("stripe", 4, false, 7, 35, "wrong_extraction", "2026-05-30T11:09:00Z"),
  fakeRun("stripe", 5, true, 3, 13, "success", "2026-05-30T11:12:00Z"),

  // IRS — 2/5 success
  fakeRun("irs", 1, true, 6, 42, "success", "2026-05-30T11:20:00Z"),
  fakeRun("irs", 2, false, 15, 90, "timeout", "2026-05-30T11:23:00Z"),
  fakeRun("irs", 3, false, 9, 60, "navigation_stuck", "2026-05-30T11:26:00Z"),
  fakeRun("irs", 4, true, 8, 55, "success", "2026-05-30T11:29:00Z"),
  fakeRun("irs", 5, false, 15, 90, "timeout", "2026-05-30T11:32:00Z"),

  // CA DMV — 1/5 success
  fakeRun("ca_dmv", 1, false, 15, 90, "timeout", "2026-05-30T11:40:00Z"),
  fakeRun("ca_dmv", 2, false, 12, 78, "navigation_stuck", "2026-05-30T11:43:00Z"),
  fakeRun("ca_dmv", 3, true, 7, 48, "success", "2026-05-30T11:46:00Z"),
  fakeRun("ca_dmv", 4, false, 15, 90, "blocked", "2026-05-30T11:49:00Z"),
  fakeRun("ca_dmv", 5, false, 15, 90, "timeout", "2026-05-30T11:52:00Z"),
];

// Pre-computed leaderboard view over the fixture rows
export const FAKE_LEADERBOARD: SiteLeaderboardEntry[] = [
  {
    site_id: "stripe",
    name: "Stripe",
    start_url: "https://stripe.com",
    lh_total: 82,
    lh_accessibility_tree: 1,
    lh_layout_stability: 1,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    success_rate: 0.8,
    trial_count: 5,
    mean_steps: 4,
    top_failure_mode: "wrong_extraction",
    rank: 1,
  },
  {
    site_id: "irs",
    name: "IRS",
    start_url: "https://www.irs.gov",
    lh_total: 44,
    lh_accessibility_tree: 0,
    lh_layout_stability: 0,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    success_rate: 0.4,
    trial_count: 5,
    mean_steps: 10.6,
    top_failure_mode: "timeout",
    rank: 2,
  },
  {
    site_id: "ca_dmv",
    name: "California DMV",
    start_url: "https://www.dmv.ca.gov",
    lh_total: 31,
    lh_accessibility_tree: 0,
    lh_layout_stability: 1,
    lh_llms_txt: 0,
    lh_webmcp: 0,
    success_rate: 0.2,
    trial_count: 5,
    mean_steps: 12.8,
    top_failure_mode: "timeout",
    rank: 3,
  },
];

export const FAKE_CORRELATION_POINTS: CorrelationPoint[] = FAKE_LEADERBOARD.map((e) => ({
  site_id: e.site_id,
  name: e.name,
  lh_total: e.lh_total ?? 0,
  success_rate: e.success_rate,
  lh_accessibility_tree: e.lh_accessibility_tree ?? 0,
  lh_layout_stability: e.lh_layout_stability ?? 0,
  lh_llms_txt: e.lh_llms_txt ?? 0,
  lh_webmcp: e.lh_webmcp ?? 0,
}));
