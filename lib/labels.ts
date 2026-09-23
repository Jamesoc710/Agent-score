import type { FailureMode, LighthouseResult } from "./types";
import { v1AuditStates, type V1AuditStates } from "./edition";

// The words a recorded value may be shown as. One module, so the leaderboard and the site page
// cannot word the same row two ways.

/**
 * Badge labels for the fixed failure-mode enum. On v1 every `blocked` row is the agent's own
 * BLOCKED answer, which the harness recorded and could not verify, so it reads "self-reported
 * block" wherever it renders (plan rule 12). The enum value itself is unchanged.
 */
export const FAILURE_MODE_BADGES: Record<FailureMode, string> = {
  success: "✓ success",
  blocked: "⛔ self-reported block",
  timeout: "⏱ timeout",
  wrong_extraction: "⚠ wrong answer",
  navigation_stuck: "🔀 nav stuck",
  error: "💥 error",
};

/** The same, without the glyph, for breakdown lists. */
export const FAILURE_MODE_WORDS: Record<FailureMode, string> = {
  success: "success",
  blocked: "self-reported block",
  timeout: "timeout",
  wrong_extraction: "wrong answer",
  navigation_stuck: "navigation stuck",
  error: "error",
};

type Flags = Pick<
  LighthouseResult,
  "lh_accessibility_tree" | "lh_layout_stability" | "lh_llms_txt" | "lh_webmcp"
>;

/** The v1 reading of a row's four flags, or null when any flag is missing. */
export function auditStatesOf(row: { [K in keyof Flags]: number | null }): V1AuditStates | null {
  const { lh_accessibility_tree, lh_layout_stability, lh_llms_txt, lh_webmcp } = row;
  if (lh_accessibility_tree === null || lh_layout_stability === null || lh_llms_txt === null || lh_webmcp === null) {
    return null;
  }
  return v1AuditStates({ lh_accessibility_tree, lh_layout_stability, lh_llms_txt, lh_webmcp });
}

/**
 * One of v1's flags, named for the audit and never for the fact it is mistaken for (design S2-7
 * section 9). `tone` is "pass" only where the flag records Lighthouse's own pass; a CLS below
 * 1.00 may still pass Lighthouse's >= 0.9 rule, and WebMCP applicability is a property of the
 * browser, so neither is ever toned as a verdict.
 */
export interface AuditLine {
  key: keyof V1AuditStates;
  /** Row label on the site page. */
  label: string;
  /** What the flag says, in the words v1 can support. */
  value: string;
  /** Leaderboard chip text; null where the chip is not shown (WebMCP). */
  chip: string | null;
  tone: "pass" | "muted" | "neutral";
}

export function v1AuditLines(states: V1AuditStates): AuditLine[] {
  const a11y = states.a11y_tree === "pass";
  const cls = states.cls === "1.00";
  const llms = states.llms_txt === "pass";
  return [
    {
      key: "a11y_tree",
      label: "Accessibility-tree audit",
      value: a11y ? "✓ pass" : "✗ fail",
      chip: a11y ? "✓ A11y tree" : "✗ A11y tree",
      tone: a11y ? "pass" : "muted",
    },
    {
      key: "cls",
      label: "Layout shift (CLS)",
      value: cls ? "1.00" : "below 1.00",
      chip: cls ? "CLS 1.00" : "CLS below 1.00",
      tone: "neutral",
    },
    {
      key: "llms_txt",
      label: "llms.txt audit",
      value: llms ? "✓ pass" : "did not pass or did not apply",
      chip: llms ? "✓ llms.txt audit" : "– llms.txt audit",
      tone: llms ? "pass" : "muted",
    },
    {
      key: "webmcp",
      label: "WebMCP audits",
      value: states.webmcp === "applied" ? "applied (no tool count in v1)" : "did not apply (browser)",
      // An applicability flag is a property of the Chrome build, not of the site.
      chip: null,
      tone: "neutral",
    },
  ];
}
