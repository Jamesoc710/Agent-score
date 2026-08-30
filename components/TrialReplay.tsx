import type { Run } from "@/lib/types";
import {
  annotateSteps,
  describeOutcome,
  MODE_DEFINITIONS,
  normalizeTranscript,
  type NormalizedStep,
  type StepAnnotations,
  type TrialOutcome,
} from "@/lib/transcript";

// One trial's recorded steps, so the failure label above it can be audited instead of trusted.
//
// A server component and a native <details>: the transcripts are already fetched with the page
// (they are the only large column, and one site's five trials come to at most ~12 KB), so
// expanding costs no round trip, no client JavaScript, and no second query.
//
// The wording rule here is the project's one rule. Everything the panel states is either read
// off a recorded field or labelled as an observation about the record. In particular, a
// timeout and a navigation_stuck run have NO recorded failure step — the clock and the step
// budget end them from outside the transcript — and the panel says "not recorded" rather than
// pointing at whatever action happens to be last.

// Categorical, not ordinal: these separate kinds of action, they do not rank them. The
// action name is always printed beside the colour.
const ACTION_STYLES: Record<string, string> = {
  click: "chip-sky",
  type: "chip-violet",
  scroll: "chip-slate",
  navigate: "chip-indigo",
  done: "chip-emerald",
};

function Chip({ tone, children }: { tone: "slate" | "amber"; children: React.ReactNode }) {
  const styles = tone === "amber" ? "bg-mid-soft text-mid-ink" : "bg-surface-2 text-ink-body";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${styles}`}>{children}</span>
  );
}

/** The answer the agent reported, and what the scorer recorded about it. */
function AnswerCallout({ step }: { step: NormalizedStep }) {
  // Checked first: the harness returns "blocked" before scoring, so a BLOCKED step never
  // carries a `matched` key at all.
  if (step.answer === "BLOCKED") {
    return (
      <div className="mt-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2">
        <p className="text-xs font-medium text-bad-ink">
          The agent reported <code className="font-mono">BLOCKED</code>.
        </p>
        <p className="mt-0.5 text-[11px] text-bad-ink">
          This is the agent&apos;s own report of a wall, not an independent observation that the
          site blocked it. The harness records the report and scores the trial as blocked.
        </p>
      </div>
    );
  }

  const matched = step.matched;
  const tone =
    matched !== null
      ? "border-good/30 bg-good-soft"
      : step.hasMatchedKey
        ? "border-mid/30 bg-mid-soft"
        : "border-line bg-surface-2";

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 ${tone}`}>
      <p className="text-xs text-ink-muted">Reported answer</p>
      <p className="mt-0.5 break-words font-mono text-xs text-ink">
        {step.answer ?? <span className="text-ink-muted">(empty)</span>}
      </p>
      {matched !== null ? (
        <p className="mt-1 text-[11px] text-good-ink">
          Matched the registered candidate{" "}
          <code className="rounded bg-good/15 px-1 font-mono">{matched}</code>.
        </p>
      ) : step.hasMatchedKey ? (
        <p className="mt-1 text-[11px] text-mid-ink">
          Scored against the pre-registered key; no candidate matched.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-ink-muted">
          The transcript does not record which registered candidate matched.
        </p>
      )}
    </div>
  );
}

function StepEntry({
  step,
  annotations,
  navigationFailure,
}: {
  step: NormalizedStep;
  annotations: StepAnnotations | undefined;
  /** This trial never reached the site, so its one error entry precedes step 1 rather than being it. */
  navigationFailure: boolean;
}) {
  if (step.kind === "note") {
    return (
      <li className="border-l-2 border-line py-1.5 pl-4 text-xs text-ink-muted">
        <span className="font-medium text-ink-body">Harness note</span>, before step{" "}
        {step.displayStep}: <span className="italic">{step.note}</span>
        {step.url && (
          <span className="ml-1 break-all font-mono text-[11px] text-ink-muted">{step.url}</span>
        )}
      </li>
    );
  }

  if (step.kind === "error") {
    return (
      <li className="border-l-2 border-bad py-2 pl-4">
        <p className="text-xs font-semibold text-ink-strong">
          {navigationFailure ? "Before step 1" : `Step ${step.displayStep}`}
          <span className="ml-2 rounded bg-bad-soft px-1.5 py-0.5 text-[11px] font-medium text-bad-ink">
            harness error
          </span>
        </p>
        <pre className="code-well mt-1.5">{step.error}</pre>
        <p className="mt-1 text-[11px] text-ink-muted">
          Recorded by the harness. A technical failure is not a result about the site.
        </p>
      </li>
    );
  }

  if (step.kind === "unknown") {
    return (
      <li className="border-l-2 border-line py-2 pl-4 text-xs text-ink-muted">
        Step {step.displayStep}: entry recorded in an unrecognised shape, shown as stored in the
        raw JSON below.
      </li>
    );
  }

  const kind = step.actionKind ?? "unknown";
  const isDone = kind === "done";

  return (
    <li className={`border-l-2 py-2 pl-4 ${isDone ? "border-ink-muted" : "border-line"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-ink-strong">Step {step.displayStep}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            ACTION_STYLES[kind] ?? "chip-slate"
          }`}
        >
          {kind}
        </span>
        {annotations?.repeatsStep != null && (
          <Chip tone="slate">same target as step {annotations.repeatsStep}</Chip>
        )}
        {annotations?.urlUnchangedSince != null && (
          <Chip tone="amber">URL unchanged since step {annotations.urlUnchangedSince}</Chip>
        )}
      </div>

      {step.url && (
        <p className="mt-1 break-all font-mono text-[11px] text-ink-muted">{step.url}</p>
      )}

      {step.target && !isDone && (
        <p className="mt-1 break-all font-mono text-xs text-ink-body">{step.target}</p>
      )}

      {step.reasoning && (
        <p className="mt-1 text-xs italic leading-relaxed text-ink-muted">
          &ldquo;{step.reasoning}&rdquo;
        </p>
      )}

      {isDone && <AnswerCallout step={step} />}
    </li>
  );
}

/**
 * What the record does and does not say about how this trial ended.
 *
 * The second line is the point of the whole feature: it says "recorded" or "not recorded" in
 * those words, so a reader can tell an audited failure point from an absent one.
 */
function Verdict({
  run,
  outcome,
  lastActionStep,
}: {
  run: Run;
  outcome: TrialOutcome;
  lastActionStep: number | null;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs text-ink-body">
        <span className="font-semibold text-ink">Recorded outcome:</span>{" "}
        <code className="font-mono">{outcome.mode}</code> — {MODE_DEFINITIONS[outcome.mode]}.
      </p>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-body">
        <span className="font-semibold text-ink">Failure point:</span>{" "}
        <VerdictDetail run={run} outcome={outcome} lastActionStep={lastActionStep} />
      </p>

      {outcome.contradicted && (
        <p className="mt-1.5 text-xs text-mid-ink">
          The transcript does not corroborate this label. The recorded row is authoritative and
          is what the success rate counts; the mismatch is shown rather than smoothed over.
        </p>
      )}
    </div>
  );
}

function VerdictDetail({
  run,
  outcome,
  lastActionStep,
}: {
  run: Run;
  outcome: TrialOutcome;
  lastActionStep: number | null;
}) {
  if (outcome.evidence === "no-transcript") {
    return (
      <>
        <span className="font-medium text-ink-muted">not recorded.</span> No transcript was
        stored for this trial, so there is nothing here to audit. The outcome above comes from
        the recorded row.
      </>
    );
  }

  if (outcome.evidence === "not-recorded") {
    if (outcome.mode === "timeout") {
      return (
        <>
          <span className="font-medium text-ink-muted">not recorded.</span> The trial clock ran
          out, so nothing in the transcript is written down as the cause.{" "}
          {outcome.unrecordedSteps > 0 && (
            <>
              Step {run.step_count} began and the clock expired before it produced an action, so{" "}
              {run.step_count} steps are counted and {run.step_count - outcome.unrecordedSteps}{" "}
              are recorded.{" "}
            </>
          )}
          {lastActionStep !== null && <>The last recorded action is step {lastActionStep}.</>}
        </>
      );
    }

    if (outcome.mode === "navigation_stuck") {
      return (
        <>
          <span className="font-medium text-ink-muted">not recorded.</span> The agent used its
          full step budget ({run.step_count} steps) without ever reporting an answer, so no
          single step is the failure point.
        </>
      );
    }

    return (
      <>
        <span className="font-medium text-ink-muted">not recorded.</span> The transcript ends on
        an ordinary action; nothing in it marks where or why the trial stopped.
      </>
    );
  }

  // evidence === "recorded"
  if (outcome.mode === "error") {
    if (outcome.neverReachedSite) {
      return (
        <>
          <span className="font-medium text-ink">recorded, before step 1.</span> Navigation
          to the start URL failed, so the agent never reached the site. This trial is excluded
          from the success rate rather than scored as a 0%.
        </>
      );
    }
    return (
      <>
        <span className="font-medium text-ink">recorded: step {outcome.failureStep}.</span>{" "}
        The harness failed there. That is a technical failure, not a result about the site, and
        it stays in the denominator because the agent had already reached the site.
      </>
    );
  }

  if (outcome.mode === "blocked") {
    return (
      <>
        <span className="font-medium text-ink">recorded: step {outcome.failureStep}.</span>{" "}
        The agent itself reported <code className="font-mono">BLOCKED</code> there. That is the
        agent&apos;s own report of a wall, not an independent observation that the site blocked
        it.
      </>
    );
  }

  if (outcome.mode === "success") {
    return (
      <>
        <span className="font-medium text-ink">recorded: step {outcome.failureStep}.</span>{" "}
        {outcome.matched !== null ? (
          <>
            The reported answer contained the registered candidate{" "}
            <code className="rounded bg-surface-2 px-1 font-mono">{outcome.matched}</code>.
          </>
        ) : (
          <>
            The reported answer was scored a success. The transcript does not record which
            registered candidate matched.
          </>
        )}
      </>
    );
  }

  if (outcome.mode === "wrong_extraction") {
    return (
      <>
        <span className="font-medium text-ink">recorded: step {outcome.failureStep}.</span>{" "}
        The agent reported an answer there and no registered candidate matched it.
      </>
    );
  }

  return (
    <>
      <span className="font-medium text-ink">recorded: step {outcome.failureStep}.</span>{" "}
      That is the last entry the harness wrote for this trial.
    </>
  );
}

export default function TrialReplay({
  run,
  id,
  open,
}: {
  run: Run;
  /** Anchor target, so a single trial can be linked to. */
  id: string;
  /** Server-rendered open state, driven by `?trial=`. */
  open: boolean;
}) {
  const steps = normalizeTranscript(run.transcript);
  const outcome = describeOutcome(run);
  const annotations = annotateSteps(steps);
  const actions = steps.filter((s) => s.kind === "action");
  const lastActionStep = actions.length > 0 ? actions[actions.length - 1].displayStep : null;

  return (
    <details id={id} open={open} className="group">
      {/* -mx/-my keeps the visual position while giving the control a ~32px hit target. */}
      <summary className="-mx-1.5 -my-1 inline-flex cursor-pointer list-none items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        {steps.length === 0
          ? "Replay — no transcript recorded"
          : `Replay — ${steps.length} recorded ${steps.length === 1 ? "entry" : "entries"}`}
      </summary>

      <div className="mt-3 space-y-3">
        <Verdict run={run} outcome={outcome} lastActionStep={lastActionStep} />

        {steps.length === 0 ? (
          // Never an empty timeline: that would read as "the agent did nothing", which is a
          // different claim from "nothing was stored".
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-muted">
            <span className="font-medium text-ink">No transcript recorded.</span> This
            trial has no stored steps, so what the agent did cannot be shown. Its recorded
            outcome, step count and duration are in the row above.
          </p>
        ) : (
          <>
            <ol className="space-y-1 rounded-lg border border-line bg-surface px-4 py-3">
              {steps.map((step) => (
                <StepEntry
                  key={step.index}
                  step={step}
                  annotations={annotations.get(step.index)}
                  navigationFailure={outcome.neverReachedSite}
                />
              ))}
            </ol>

            <p className="text-[11px] leading-relaxed text-ink-muted">
              The URL is recorded at the start of each step, before the action runs, and a click
              that matched nothing on the page is not recorded at all. So &ldquo;URL
              unchanged&rdquo; is an observation about this record, not evidence that a click
              failed — an in-page update would look the same here. The effect of the final
              action is never captured.
            </p>
          </>
        )}

        <details>
          <summary className="-mx-1.5 -my-1 inline-block cursor-pointer rounded px-1.5 py-1 text-[11px] text-ink-muted transition-colors hover:text-ink">
            Raw stored transcript (JSON)
          </summary>
          <pre className="code-well mt-2 max-h-96 overflow-auto">
            {JSON.stringify(run.transcript ?? null, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
