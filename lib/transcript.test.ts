import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODE_DEFINITIONS,
  actionSteps,
  annotateSteps,
  describeOutcome,
  normalizeTranscript,
  resolveTrialParam,
} from "./transcript";
import { FAKE_RUNS } from "./fake-data";
import type { FailureMode, Run, TranscriptStep } from "./types";

// Two layers of test.
//
// The unit cases below pin each branch of describeOutcome, including every way a transcript can
// be absent or malformed.
//
// The invariant block at the bottom runs the same functions over the real committed artifact,
// data/agent-runs-v1.jsonl (280 published trials). Those assertions are the interesting ones:
// they state the properties the published wording depends on — no timeout run has a recorded
// failure step, every success carries the candidate it matched — so if a future batch violates
// one, the sentences on the site have stopped being true and this suite says so.

function run(overrides: Partial<Run> = {}): Run {
  return {
    site_id: "stripe",
    agent_id: "gemini-3.5-flash-lite",
    batch_label: "v1",
    trial_number: 1,
    success: false,
    step_count: 1,
    duration_seconds: 5,
    failure_mode: "timeout",
    transcript: null,
    run_at: "2026-08-19T16:14:58.078314+00:00",
    ...overrides,
  };
}

function step(n: number, action: TranscriptStep["action"], extra: Partial<TranscriptStep> = {}): TranscriptStep {
  return { step: n, url: "https://example.com/", action, ...extra };
}

// ---------------------------------------------------------------------------
// normalizeTranscript — the boundary guard
// ---------------------------------------------------------------------------

describe("normalizeTranscript", () => {
  it("returns no steps for every shape of absence, rather than an empty timeline", () => {
    for (const value of [null, undefined, "", "[]", 0, {}, { step: 1 }, NaN]) {
      expect(normalizeTranscript(value)).toEqual([]);
    }
  });

  it("skips entries that are not objects but keeps the ones that are", () => {
    const steps = normalizeTranscript([null, "nope", 7, { step: 0, note: "kept" }]);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("note");
  });

  it("classifies each entry by the one field it carries", () => {
    const steps = normalizeTranscript([
      { step: 0, action: { action: "click", selector: "Pricing" } },
      { step: 1, error: "boom" },
      { step: 2, note: "followed newly opened tab" },
      { step: 3 },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["action", "error", "note", "unknown"]);
  });

  it("numbers steps from 1 for display because the harness numbers them from 0", () => {
    const steps = normalizeTranscript([{ step: 0, action: { action: "scroll" } }]);
    expect(steps[0].recordedStep).toBe(0);
    expect(steps[0].displayStep).toBe(1);
  });

  it("falls back to array position when `step` is missing or not a number", () => {
    const steps = normalizeTranscript([{ action: { action: "click" } }, { step: "two", error: "e" }]);
    expect(steps.map((s) => s.displayStep)).toEqual([1, 2]);
    expect(steps.map((s) => s.recordedStep)).toEqual([null, null]);
  });

  it("keeps an action kind outside the documented union instead of dropping it", () => {
    const steps = normalizeTranscript([{ step: 0, action: { action: "teleport", selector: "#x" } }]);
    expect(steps[0].kind).toBe("action");
    expect(steps[0].actionKind).toBe("teleport");
    expect(steps[0].target).toBe("#x");
  });

  it("reads the action target from selector, then text, then url", () => {
    const steps = normalizeTranscript([
      { step: 0, action: { action: "click", selector: "Pricing" } },
      { step: 1, action: { action: "type", text: "search me" } },
      { step: 2, action: { action: "navigate", url: "https://example.com/x" } },
    ]);
    expect(steps.map((s) => s.target)).toEqual(["Pricing", "search me", "https://example.com/x"]);
  });

  it("distinguishes an absent `matched` key from a recorded null", () => {
    const [absent, nulled, present] = normalizeTranscript([
      { step: 0, action: { action: "done", answer: "x" } },
      { step: 1, action: { action: "done", answer: "x" }, matched: null },
      { step: 2, action: { action: "done", answer: "x" }, matched: "2.9%" },
    ]);
    expect([absent.hasMatchedKey, absent.matched]).toEqual([false, null]);
    expect([nulled.hasMatchedKey, nulled.matched]).toEqual([true, null]);
    expect([present.hasMatchedKey, present.matched]).toEqual([true, "2.9%"]);
  });
});

// ---------------------------------------------------------------------------
// annotateSteps — observations, not verdicts
// ---------------------------------------------------------------------------

describe("annotateSteps", () => {
  const clicking = (n: number, selector: string, url: string) =>
    ({ step: n, url, action: { action: "click", selector } }) as TranscriptStep;

  it("marks an unchanged URL from the step the run of them began", () => {
    const steps = normalizeTranscript([
      clicking(0, "a", "https://x/"),
      clicking(1, "b", "https://x/"),
      clicking(2, "c", "https://x/"),
    ]);
    const ann = annotateSteps(steps);
    expect(ann.get(0)?.urlUnchangedSince).toBeNull();
    expect(ann.get(1)?.urlUnchangedSince).toBe(1);
    expect(ann.get(2)?.urlUnchangedSince).toBe(1);
  });

  it("does not mark an unchanged URL after an action that could not have moved it", () => {
    const steps = normalizeTranscript([
      { step: 0, url: "https://x/", action: { action: "scroll", direction: "down" } },
      clicking(1, "a", "https://x/"),
    ]);
    expect(annotateSteps(steps).get(1)?.urlUnchangedSince).toBeNull();
  });

  it("clears the marker once the URL changes", () => {
    const steps = normalizeTranscript([
      clicking(0, "a", "https://x/"),
      clicking(1, "b", "https://x/"),
      clicking(2, "c", "https://y/"),
    ]);
    expect(annotateSteps(steps).get(2)?.urlUnchangedSince).toBeNull();
  });

  it("points a repeated target at the first step that used it, ignoring reasoning", () => {
    const steps = normalizeTranscript([
      { step: 0, url: "https://x/", action: { action: "click", selector: "HISTORY", reasoning: "one" } },
      { step: 1, url: "https://x/", action: { action: "click", selector: "HISTORY", reasoning: "different prose" } },
      { step: 2, url: "https://x/", action: { action: "click", selector: "MENU", reasoning: "one" } },
    ]);
    const ann = annotateSteps(steps);
    expect(ann.get(0)?.repeatsStep).toBeNull();
    expect(ann.get(1)?.repeatsStep).toBe(1);
    expect(ann.get(2)?.repeatsStep).toBeNull();
  });

  it("annotates only action steps, so a note never becomes a step of its own", () => {
    const steps = normalizeTranscript([
      clicking(0, "a", "https://x/"),
      { step: 1, note: "followed newly opened tab", url: "https://y/" },
      clicking(1, "b", "https://y/"),
    ]);
    const ann = annotateSteps(steps);
    expect(ann.has(1)).toBe(false);
    expect(actionSteps(steps)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// describeOutcome — recorded vs not recorded
// ---------------------------------------------------------------------------

describe("describeOutcome", () => {
  it("reports no-transcript rather than inventing a failure step", () => {
    const outcome = describeOutcome(run({ failure_mode: "wrong_extraction", transcript: null }));
    expect(outcome.evidence).toBe("no-transcript");
    expect(outcome.failureStep).toBeNull();
    expect(outcome.contradicted).toBe(false);
  });

  it("records the matched candidate on a success", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "success",
        success: true,
        step_count: 2,
        transcript: [
          step(0, { action: "click", selector: "Pricing" }),
          step(1, { action: "done", answer: "2.9% + $0.30" }, { matched: "2.9%" }),
        ],
      })
    );
    expect(outcome.evidence).toBe("recorded");
    expect(outcome.failureStep).toBe(2);
    expect(outcome.matched).toBe("2.9%");
    expect(outcome.contradicted).toBe(false);
    expect(outcome.unrecordedSteps).toBe(0);
  });

  it("keeps a success with no recorded candidate distinct from one that matched nothing", () => {
    const noKey = describeOutcome(
      run({
        failure_mode: "success",
        success: true,
        step_count: 1,
        transcript: [step(0, { action: "done", answer: "1948" })],
      })
    );
    expect(noKey.hasMatchedKey).toBe(false);
    expect(noKey.matched).toBeNull();
    expect(noKey.contradicted).toBe(false);

    const scoredNull = describeOutcome(
      run({
        failure_mode: "success",
        success: true,
        step_count: 1,
        transcript: [step(0, { action: "done", answer: "1948" }, { matched: null })],
      })
    );
    expect(scoredNull.hasMatchedKey).toBe(true);
    expect(scoredNull.contradicted).toBe(true);
  });

  it("treats a BLOCKED answer as the agent's own report", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "blocked",
        step_count: 2,
        transcript: [
          step(0, { action: "type", selector: "input", text: "q" }),
          step(1, { action: "done", answer: "BLOCKED" }),
        ],
      })
    );
    expect(outcome.evidence).toBe("recorded");
    expect(outcome.failureStep).toBe(2);
    expect(outcome.answer).toBe("BLOCKED");
    expect(outcome.hasMatchedKey).toBe(false);
    expect(outcome.contradicted).toBe(false);
  });

  it("marks a wrong_extraction at the step that answered", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "wrong_extraction",
        step_count: 1,
        transcript: [step(0, { action: "done", answer: "nope" }, { matched: null })],
      })
    );
    expect(outcome.evidence).toBe("recorded");
    expect(outcome.failureStep).toBe(1);
    expect(outcome.contradicted).toBe(false);
  });

  it("puts a navigation failure before step 1 and flags it as never reaching the site", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "error",
        step_count: 0,
        transcript: [{ step: 0, error: "net::ERR_HTTP2_PROTOCOL_ERROR" }],
      })
    );
    expect(outcome.evidence).toBe("recorded");
    expect(outcome.failureStep).toBeNull();
    expect(outcome.neverReachedSite).toBe(true);
    expect(outcome.errorMessage).toContain("ERR_HTTP2");
    expect(outcome.unrecordedSteps).toBe(0);
  });

  it("records a mid-run harness error at its step and keeps it in the denominator", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "error",
        step_count: 4,
        transcript: [
          step(0, { action: "click", selector: "a" }),
          step(1, { action: "type", selector: "input", text: "q" }),
          step(2, { action: "type", selector: "input", text: "q2" }),
          { step: 3, error: "state capture failed" },
        ],
      })
    );
    expect(outcome.failureStep).toBe(4);
    expect(outcome.neverReachedSite).toBe(false);
    // The erroring step counts but wrote an error entry, not an action.
    expect(outcome.unrecordedSteps).toBe(1);
  });

  it("refuses to name a failure step for a timeout", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "timeout",
        step_count: 4,
        transcript: [
          step(0, { action: "click", selector: "a" }),
          step(1, { action: "click", selector: "a" }),
          step(2, { action: "click", selector: "a" }),
        ],
      })
    );
    expect(outcome.evidence).toBe("not-recorded");
    expect(outcome.failureStep).toBeNull();
    // The clock is checked at the start of a step, so the final counted step wrote nothing.
    expect(outcome.unrecordedSteps).toBe(1);
    expect(outcome.contradicted).toBe(false);
  });

  it("refuses to name a failure step for navigation_stuck", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "navigation_stuck",
        step_count: 3,
        transcript: [
          step(0, { action: "click", selector: "HISTORY" }),
          step(1, { action: "click", selector: "HISTORY" }),
          step(2, { action: "click", selector: "HISTORY" }),
        ],
      })
    );
    expect(outcome.evidence).toBe("not-recorded");
    expect(outcome.failureStep).toBeNull();
    expect(outcome.unrecordedSteps).toBe(0);
  });

  it("flags a label the transcript positively disagrees with", () => {
    const outcome = describeOutcome(
      run({
        failure_mode: "success",
        success: true,
        step_count: 1,
        transcript: [step(0, { action: "click", selector: "a" })],
      })
    );
    expect(outcome.contradicted).toBe(true);
    // The row stays authoritative; the mismatch is surfaced, not corrected.
    expect(outcome.mode).toBe("success");
  });

  it("never lets a malformed transcript produce a negative step budget", () => {
    const outcome = describeOutcome(
      run({ failure_mode: "timeout", step_count: 0, transcript: [step(0, { action: "click" })] })
    );
    expect(outcome.unrecordedSteps).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveTrialParam
// ---------------------------------------------------------------------------

describe("resolveTrialParam", () => {
  const runs = [{ trial_number: 1 }, { trial_number: 2 }, { trial_number: 3 }];

  it("opens a trial that exists", () => {
    expect(resolveTrialParam("3", runs)).toBe(3);
    expect(resolveTrialParam(["2", "3"], runs)).toBe(2);
  });

  it("opens nothing for anything unrecognised, rather than 404ing or inventing a trial", () => {
    for (const value of ["", "0", "99", "abc", "1.5", "1e1", " ", null, undefined, "-1"]) {
      expect(resolveTrialParam(value, runs)).toBeNull();
    }
  });

  it("opens nothing when there are no runs at all", () => {
    expect(resolveTrialParam("1", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixtures: the missing-transcript path is what USE_FAKE_DATA=true exercises
// ---------------------------------------------------------------------------

describe("lib/fake-data.ts fixtures", () => {
  it("has exactly one run with a transcript, so fixture mode tests the absent path", () => {
    const withTranscript = FAKE_RUNS.filter((r) => normalizeTranscript(r.transcript).length > 0);
    expect(withTranscript).toHaveLength(1);
    expect(FAKE_RUNS.length - withTranscript.length).toBe(14);
  });

  it("renders every transcript-less fixture run as no-transcript, never as an empty timeline", () => {
    for (const r of FAKE_RUNS) {
      const outcome = describeOutcome(r);
      const expected = normalizeTranscript(r.transcript).length === 0;
      expect(outcome.evidence === "no-transcript").toBe(expected);
    }
  });

  it("has a fixture success whose done step records no candidate", () => {
    const outcome = describeOutcome(FAKE_RUNS.find((r) => normalizeTranscript(r.transcript).length > 0)!);
    expect(outcome.mode).toBe("success");
    expect(outcome.hasMatchedKey).toBe(false);
    expect(outcome.contradicted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invariants over the published v1 artifact
// ---------------------------------------------------------------------------

const ARTIFACT = join(__dirname, "..", "data", "agent-runs-v1.jsonl");

function loadV1(): Run[] {
  let raw: string;
  try {
    raw = readFileSync(ARTIFACT, "utf8");
  } catch {
    throw new Error(
      `Could not read ${ARTIFACT}. It is the committed record of the published v1 batch and these invariants are asserted against it directly.`
    );
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Run);
}

describe("data/agent-runs-v1.jsonl invariants", () => {
  const rows = loadV1();

  it("is the published batch: 280 trials across two agents", () => {
    expect(rows).toHaveLength(280);
    expect(new Set(rows.map((r) => r.agent_id))).toEqual(
      new Set(["gemini-3.5-flash-lite", "gemini-3.6-flash"])
    );
    expect(new Set(rows.map((r) => r.batch_label))).toEqual(new Set(["v1"]));
  });

  it("stores a transcript for every trial", () => {
    for (const r of rows) {
      expect(normalizeTranscript(r.transcript).length).toBeGreaterThan(0);
    }
  });

  it("writes exactly one of action, error or note per entry", () => {
    for (const r of rows) {
      for (const s of normalizeTranscript(r.transcript)) {
        expect(s.kind).not.toBe("unknown");
        const carried = [s.action !== null, s.error !== null, s.note !== null].filter(Boolean);
        expect(carried).toHaveLength(1);
      }
    }
  });

  it("numbers action entries contiguously from 0, so step + 1 is a safe display index", () => {
    for (const r of rows) {
      const recorded = actionSteps(normalizeTranscript(r.transcript)).map((s) => s.recordedStep);
      expect(recorded).toEqual(recorded.map((_, i) => i));
    }
  });

  it("records a failure step for every success, blocked and error trial", () => {
    const modes: FailureMode[] = ["success", "blocked", "error"];
    const subject = rows.filter((r) => modes.includes(r.failure_mode));
    expect(subject.length).toBe(146 + 26 + 45);
    for (const r of subject) {
      expect(describeOutcome(r).evidence).toBe("recorded");
    }
  });

  it("records NO failure step for any timeout or navigation_stuck trial", () => {
    const subject = rows.filter(
      (r) => r.failure_mode === "timeout" || r.failure_mode === "navigation_stuck"
    );
    // 57 timeouts + 6 navigation_stuck: 63 of 280 published trials whose failure point the
    // record does not identify. The UI must say "not recorded" for every one of them.
    expect(subject).toHaveLength(63);
    for (const r of subject) {
      const outcome = describeOutcome(r);
      expect(outcome.evidence).toBe("not-recorded");
      expect(outcome.failureStep).toBeNull();
    }
  });

  it("carries a non-null matched candidate on every success", () => {
    const successes = rows.filter((r) => r.failure_mode === "success");
    expect(successes).toHaveLength(146);
    for (const r of successes) {
      const outcome = describeOutcome(r);
      expect(outcome.hasMatchedKey).toBe(true);
      expect(outcome.matched).not.toBeNull();
      expect(outcome.matched!.length).toBeGreaterThan(0);
    }
  });

  it("never leaves a published label uncorroborated by its own transcript", () => {
    for (const r of rows) {
      expect(describeOutcome(r).contradicted).toBe(false);
    }
  });

  it("accounts for every counted step: unrecordedSteps is 1 only where a step wrote nothing", () => {
    for (const r of rows) {
      const outcome = describeOutcome(r);
      expect([0, 1]).toContain(outcome.unrecordedSteps);

      const startedButWroteNoAction =
        r.failure_mode === "timeout" ||
        (r.failure_mode === "error" && r.step_count > 0);
      expect(outcome.unrecordedSteps).toBe(startedButWroteNoAction ? 1 : 0);
    }
  });

  it("excludes exactly the ten costco trials that never reached the site", () => {
    const excluded = rows.filter((r) => describeOutcome(r).neverReachedSite);
    expect(excluded).toHaveLength(10);
    expect(new Set(excluded.map((r) => r.site_id))).toEqual(new Set(["costco"]));
    for (const r of excluded) {
      expect(r.step_count).toBe(0);
      expect(describeOutcome(r).errorMessage).toContain("ERR_HTTP2_PROTOCOL_ERROR");
    }
  });

  it("has a definition for every failure mode the batch actually produced", () => {
    for (const mode of new Set(rows.map((r) => r.failure_mode))) {
      expect(MODE_DEFINITIONS[mode]).toBeTruthy();
    }
  });

  it("keeps the in-n-out looping exhibit intact: 15 identical clicks, one URL, no failure step", () => {
    const exhibit = rows.find(
      (r) => r.site_id === "innout" && r.agent_id === "gemini-3.5-flash-lite" && r.trial_number === 3
    )!;
    const steps = normalizeTranscript(exhibit.transcript);
    const ann = annotateSteps(steps);
    const actions = actionSteps(steps);

    expect(exhibit.failure_mode).toBe("navigation_stuck");
    expect(actions).toHaveLength(15);
    expect(new Set(actions.map((s) => s.url)).size).toBe(1);
    expect(actions.every((s) => s.actionKind === "click")).toBe(true);
    expect(ann.get(actions[14].index)?.urlUnchangedSince).toBe(1);
    expect(describeOutcome(exhibit).evidence).toBe("not-recorded");
  });
});
