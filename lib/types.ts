// Frozen data contract between the lanes and the frontend. Changes are a James decision,
// not a refactor. Mirrors supabase/migrations/20260727190050_init_schema.sql; the columns
// on Site mirror data/cohort.csv, which is the canonical cohort.

export type SiteTier =
  | "anchor"
  | "middle"
  | "government"
  | "small_business"
  | "off_diagonal"
  | "blocker";

export interface Site {
  site_id: string;   // slug, e.g. "stripe"
  name: string;      // display name
  tier: SiteTier;    // cohort design bucket
  start_url: string; // where the agent starts; navigation is part of the test
  question: string;  // the per-site question; the task shape never varies
  // Pre-registered answer key. " | " separates any-of alternates (METHODOLOGY rule 6).
  // Never goes into an agent prompt or task hint.
  answer_substring: string;
  match_rule: string;   // which normalization rules apply to this row
  flag: string;         // cohort design note, e.g. "consent-wall obstacle"
  answer_note: string;  // human-readable description of the expected answer
}

export interface LighthouseResult {
  site_id: string;
  batch_label: string;            // which Lane 1 batch this row belongs to
  lh_total: number;               // 0–100 Agentic Browsing category score
  lh_accessibility_tree: number;  // 0 or 1 (pass/fail)
  lh_layout_stability: number;    // 0 or 1
  lh_llms_txt: number;            // 0 or 1
  lh_webmcp: number;              // 0 or 1
  screenshot_path?: string;
  run_at: string; // ISO timestamp
}

export type FailureMode =
  | "success"
  | "blocked"           // anti-bot / login wall
  | "timeout"           // hit step or time limit
  | "wrong_extraction"  // navigated fine but wrong/no answer
  | "navigation_stuck"  // couldn't find the path
  | "error";            // harness/technical failure

// One decision the agent made, as emitted by the harness loop.
export interface AgentAction {
  action: "click" | "type" | "scroll" | "navigate" | "done";
  selector?: string;
  text?: string;
  direction?: string;
  url?: string;
  answer?: string;
  reasoning?: string;
}

export interface TranscriptStep {
  step: number;
  url?: string;
  action?: AgentAction;
  error?: string;
  note?: string;           // harness annotation, e.g. "followed newly opened tab"
  matched?: string | null; // on "done" steps: which registered candidate matched, if any
}

export interface Run {
  site_id: string;
  agent_id: string;     // which agent produced this run; enables a multi-agent panel
  batch_label: string;  // which Lane 2 batch this trial belongs to
  trial_number: number; // 1..N
  success: boolean;     // output matched answer_substring under the METHODOLOGY rules
  step_count: number;
  duration_seconds: number;
  failure_mode: FailureMode;
  transcript?: TranscriptStep[] | null; // always stored; makes the failure label auditable
  run_at: string;       // ISO timestamp
}

// Derived view for the leaderboard — computed from sites + lighthouse + runs
export interface SiteLeaderboardEntry {
  site_id: string;
  name: string;
  start_url: string;
  tier: SiteTier; // cohort design bucket, shown so expected outliers read as designed
  flag: string;   // cohort design note, e.g. "intentional blocker (expect blocked)"
  lh_total: number | null;
  lh_accessibility_tree: number | null;
  lh_layout_stability: number | null;
  lh_llms_txt: number | null;
  lh_webmcp: number | null;
  success_rate: number;      // 0–1
  trial_count: number;
  mean_steps: number;
  top_failure_mode: FailureMode;
  rank: number;
}

// Derived view: what one published (batch, agent) slice actually measured. Every field is a
// denominator or a window the pages are required to state — a success rate is never shown
// without the trials it came from or the dates it was measured on.
export interface DatasetSummary {
  batch_label: string;
  agent_id: string;
  site_count: number;            // sites in the cohort
  measured_site_count: number;   // sites with at least one measured trial
  unmeasured_site_ids: string[]; // reached-the-site never happened; not 0% success
  trial_count: number;           // measured trials (the success-rate denominator)
  excluded_trial_count: number;  // recorded but never reached the site
  success_count: number;
  success_rate: number | null;   // null when nothing was measured, never 0
  run_window: { first: string; last: string } | null;
}

// Derived view: one row per agent in the published panel, for the model-gap comparison.
export interface AgentPanelSummary {
  agent_id: string;
  trial_count: number;
  success_count: number;
  success_rate: number | null;
  measured_site_count: number;
}

// For the correlation page
export interface CorrelationPoint {
  site_id: string;
  name: string;
  lh_total: number;
  success_rate: number;
  // sub-audits for the "which audit matters" analysis
  lh_accessibility_tree: number;
  lh_layout_stability: number;
  lh_llms_txt: number;
  lh_webmcp: number;
}
