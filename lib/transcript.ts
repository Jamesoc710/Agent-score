import type { AgentAction, FailureMode, Run } from "./types";

// Reading a stored transcript into something a page can render.
//
// Pure functions, no data access — the lib/stats.ts arrangement, and for the same reason: the
// claims this file makes end up as sentences on a public page, so they get tested separately
// from the rendering.
//
// Two rules run through it.
//
//  1. `transcript` is a jsonb column holding whatever the harness wrote, which is in turn
//     whatever the model emitted. lib/types.ts describes what Lane 2 *writes*, not what the
//     database *guarantees*. So nothing here casts; everything validates, and an unrecognised
//     shape renders verbatim rather than being dropped or crashed on.
//  2. A failure step is reported only where the record actually marks one. A timeout ends at
//     the wall clock and a navigation_stuck run ends at the step budget: neither writes down a
//     step that caused it, and pointing at the last recorded action would invent the finding.
//     Those return evidence "not-recorded", and the UI says so in those words.

// ---------------------------------------------------------------------------
// Normalized steps
// ---------------------------------------------------------------------------

/**
 * What one recorded entry is. The harness writes exactly one of `action`, `error` or `note`
 * per entry (true of all 1024 entries in the v1 artifact); "unknown" exists so an entry that
 * fits none of them still renders instead of vanishing.
 */
export type StepKind = "action" | "error" | "note" | "unknown";

export interface NormalizedStep {
  /** Position in the recorded array. Nothing is reordered or dropped, so this is stable. */
  index: number;
  kind: StepKind;
  /** 1-based label for display; the harness numbers its steps from 0. */
  displayStep: number;
  /** The `step` field exactly as recorded, when it was a number. */
  recordedStep: number | null;
  url: string | null;
  action: AgentAction | null;
  /** The action kind as recorded — may be outside the documented union. */
  actionKind: string | null;
  /** What the action was aimed at: selector, typed text, or target URL. */
  target: string | null;
  reasoning: string | null;
  answer: string | null;
  error: string | null;
  note: string | null;
  /** The registered candidate recorded on a scored `done` step. */
  matched: string | null;
  /** Whether the entry carried a `matched` key at all — absent is not the same as null. */
  hasMatchedKey: boolean;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read a stored transcript into an ordered list of steps.
 *
 * Every input that is not a usable entry list — null, undefined, a string, an object, an array
 * of junk — yields an empty list, which the UI renders as "no transcript recorded". It never
 * renders as an empty timeline: a trial that recorded nothing and a trial where the agent did
 * nothing are different claims.
 */
export function normalizeTranscript(transcript: unknown): NormalizedStep[] {
  if (!Array.isArray(transcript)) return [];

  const steps: NormalizedStep[] = [];

  transcript.forEach((raw, index) => {
    const entry = asRecord(raw);
    if (!entry) return;

    const recordedStep =
      typeof entry.step === "number" && Number.isFinite(entry.step) ? entry.step : null;
    const action = asRecord(entry.action);
    const error = asString(entry.error);
    const note = asString(entry.note);

    const kind: StepKind = action ? "action" : error ? "error" : note ? "note" : "unknown";

    steps.push({
      index,
      kind,
      // Falls back to array position when `step` is missing, so the list still numbers.
      displayStep: (recordedStep ?? index) + 1,
      recordedStep,
      url: asString(entry.url),
      action: (action as AgentAction | null) ?? null,
      actionKind: action ? asString(action.action) : null,
      target: action
        ? asString(action.selector) ?? asString(action.text) ?? asString(action.url)
        : null,
      reasoning: action ? asString(action.reasoning) : null,
      answer: action ? asString(action.answer) : null,
      error,
      note,
      matched: typeof entry.matched === "string" ? entry.matched : null,
      hasMatchedKey: "matched" in entry,
    });
  });

  return steps;
}

/** Only the entries the harness counts as a step; notes are annotations attached to one. */
export function actionSteps(steps: NormalizedStep[]): NormalizedStep[] {
  return steps.filter((s) => s.kind === "action");
}

// ---------------------------------------------------------------------------
// Derived annotations — observations about the record, never verdicts
// ---------------------------------------------------------------------------

/**
 * Mechanical comparisons between recorded fields. Both are deliberately weak claims:
 *
 * - `urlUnchangedSince` is a fact about the record, not about the browser. The URL is captured
 *   at the START of each step, before the action runs, and a click that matched nothing is
 *   never written down at all (try_click only prints). So an unchanged URL does not show that
 *   the click failed — an in-page update is invisible here.
 * - `repeatsStep` ignores `reasoning`, which varies between otherwise identical attempts.
 */
export interface StepAnnotations {
  /** Display step where the unchanged-URL run began, when the previous action could have moved it. */
  urlUnchangedSince: number | null;
  /** Display step of the first earlier action with an identical kind and target. */
  repeatsStep: number | null;
}

/** Actions that could have changed the URL, so an unchanged one is worth noting. */
const NAVIGATING_ACTIONS = new Set(["click", "type", "navigate"]);

export function annotateSteps(steps: NormalizedStep[]): Map<number, StepAnnotations> {
  const annotations = new Map<number, StepAnnotations>();
  const seenTargets = new Map<string, number>();

  let previous: NormalizedStep | null = null;
  let unchangedRunStart: number | null = null;

  for (const step of actionSteps(steps)) {
    const key = `${step.actionKind ?? ""} ${step.target ?? ""}`;
    const repeatsStep = seenTargets.get(key) ?? null;
    if (repeatsStep === null) seenTargets.set(key, step.displayStep);

    let urlUnchangedSince: number | null = null;
    if (
      previous &&
      previous.url !== null &&
      step.url !== null &&
      previous.url === step.url &&
      NAVIGATING_ACTIONS.has(previous.actionKind ?? "")
    ) {
      unchangedRunStart = unchangedRunStart ?? previous.displayStep;
      urlUnchangedSince = unchangedRunStart;
    } else {
      unchangedRunStart = null;
    }

    annotations.set(step.index, { urlUnchangedSince, repeatsStep });
    previous = step;
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Outcome — what the record does and does not say about how the trial ended
// ---------------------------------------------------------------------------

/**
 * Whether the transcript itself marks where the trial ended.
 *
 * "recorded"      — the last entry is the ending: a scored answer, the agent's own BLOCKED
 *                   report, or a harness error.
 * "not-recorded"  — the trial was ended from outside the transcript (the wall clock or the step
 *                   budget). The last recorded action is simply the last one that happened; it
 *                   is not the cause and must not be presented as one.
 * "no-transcript" — nothing was stored for this trial.
 */
export type OutcomeEvidence = "recorded" | "not-recorded" | "no-transcript";

export interface TrialOutcome {
  /** The stored failure_mode. The row is authoritative; the transcript is the evidence for it. */
  mode: FailureMode;
  evidence: OutcomeEvidence;
  /** Display step the record marks as the ending, or null when there is none (or it preceded step 1). */
  failureStep: number | null;
  /** The registered candidate recorded on the scored `done` step. */
  matched: string | null;
  /** Whether that step carried a `matched` key at all. */
  hasMatchedKey: boolean;
  /** The answer the agent reported, when it reported one. */
  answer: string | null;
  /** The harness error recorded on the final entry, when there is one. */
  errorMessage: string | null;
  /**
   * step_count minus the entries that produced an action: a step that began and wrote nothing.
   * 1 for every timeout (the clock is checked at the start of a step) and for a step that
   * errored; 0 otherwise.
   */
  unrecordedSteps: number;
  /** The trial never reached the site (navigation itself failed), so it measures nothing about it. */
  neverReachedSite: boolean;
  /** The transcript positively disagrees with the stored failure_mode. Silent when false. */
  contradicted: boolean;
}

/** Describe how one trial ended, using only what the record actually contains. */
export function describeOutcome(run: Run): TrialOutcome {
  const steps = normalizeTranscript(run.transcript);
  const recordedActions = actionSteps(steps).length;
  const unrecordedSteps = Math.max(0, (run.step_count ?? 0) - recordedActions);
  // The METHODOLOGY denominator rule, read off the row itself (see measuredRuns in queries.ts).
  const neverReachedSite = run.failure_mode === "error" && run.step_count === 0;

  const base = {
    mode: run.failure_mode,
    matched: null,
    hasMatchedKey: false,
    answer: null,
    errorMessage: null,
    unrecordedSteps,
    neverReachedSite,
  };

  if (steps.length === 0) {
    return { ...base, evidence: "no-transcript", failureStep: null, contradicted: false };
  }

  const last = steps[steps.length - 1];
  const isDone = last.kind === "action" && last.actionKind === "done";
  const selfReportedBlocked = isDone && last.answer === "BLOCKED";

  if (last.kind === "error") {
    return {
      ...base,
      evidence: "recorded",
      // step_count 0 means the failure preceded the first step: page.goto never returned.
      failureStep: run.step_count === 0 ? null : last.displayStep,
      errorMessage: last.error,
      contradicted: run.failure_mode !== "error",
    };
  }

  if (isDone) {
    return {
      ...base,
      evidence: "recorded",
      failureStep: last.displayStep,
      matched: last.matched,
      hasMatchedKey: last.hasMatchedKey,
      answer: last.answer,
      contradicted: contradictsDone(
        run.failure_mode,
        last.matched,
        last.hasMatchedKey,
        selfReportedBlocked
      ),
    };
  }

  // The transcript ends on an ordinary action, so something outside it stopped the trial.
  return {
    ...base,
    evidence: "not-recorded",
    failureStep: null,
    contradicted: run.failure_mode === "success",
  };
}

function contradictsDone(
  mode: FailureMode,
  matched: string | null,
  hasMatchedKey: boolean,
  selfReportedBlocked: boolean
): boolean {
  switch (mode) {
    // A success whose scored step recorded no matching candidate disagrees with itself. A
    // success with no `matched` key at all does not: nothing was written either way.
    case "success":
      return hasMatchedKey && matched === null;
    case "wrong_extraction":
      return matched !== null;
    case "blocked":
      return !selfReportedBlocked;
    // The agent reported an answer, so neither the clock nor the step budget ended this run.
    case "timeout":
    case "navigation_stuck":
    case "error":
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Copy shared with the replay UI
// ---------------------------------------------------------------------------

/**
 * Plain-English definitions of the fixed failure-mode enum (docs/METHODOLOGY.md). Deliberately
 * separate from the short badge labels in the trial-log table: these are sentences shown next
 * to evidence, and `blocked` is worded as the agent's own report because that is all the
 * harness records — the agent answering the literal string "BLOCKED".
 */
export const MODE_DEFINITIONS: Record<FailureMode, string> = {
  success: "the reported answer contained a pre-registered candidate",
  blocked: "the agent reported hitting an anti-bot or login wall",
  timeout: "the trial clock ran out",
  wrong_extraction: "the agent navigated and answered, but matched no registered candidate",
  navigation_stuck: "the step budget ran out before the agent reported any answer",
  error: "a harness or technical failure, not a result about the site",
};

/** Which trial to open, from `?trial=`. Anything unrecognised opens nothing — never a 404. */
export function resolveTrialParam(
  raw: string | string[] | undefined | null,
  runs: Pick<Run, "trial_number">[]
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return runs.some((r) => r.trial_number === parsed) ? parsed : null;
}
