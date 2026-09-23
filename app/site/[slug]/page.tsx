import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteDetail, measuredRuns } from "@/lib/queries";
import { Run } from "@/lib/types";
import { TierBadge, FlagBadge } from "@/components/SiteBadges";
import AgentToggle from "@/components/AgentToggle";
import TrialReplay from "@/components/TrialReplay";
import EditionMismatch from "@/components/EditionMismatch";
import { ACTIVE_BATCH, agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { EDITION, editionMatches } from "@/lib/edition-data";
import { formatDate, formatRunWindow } from "@/lib/format";
import { FAILURE_MODE_BADGES, FAILURE_MODE_WORDS, auditStatesOf, v1AuditLines, type AuditLine } from "@/lib/labels";
import { formatR } from "@/lib/stats";
import { resolveTrialParam } from "@/lib/transcript";

// One v1 flag, in the words it can support (design S2-7 section 9). The row takes a state, not
// a 0/1: "did not pass or did not apply" is not a fail, and a browser flag is not a verdict.
function SubAuditRow({ line }: { line: AuditLine }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className="text-[13px] text-ink-body">{line.label}</span>
      {/* Glyph and word both say it; the tone is the third, redundant channel. */}
      <span
        className={`text-right text-[13px] font-medium ${
          line.tone === "pass" ? "text-good" : line.tone === "muted" ? "text-ink-muted" : "text-ink-body"
        }`}
      >
        {line.value}
      </span>
    </div>
  );
}

/**
 * Registered rule (b), from the batch's own trial record (design S2-4 section 5). It never
 * changes the rate; it says what the rate measured, and prints the registered sensitivity.
 */
function InstrumentCaveat({ siteId, agentId }: { siteId: string; agentId: string }) {
  const exclusion = EDITION.exclusions.find((e) => e.site_id === siteId);
  if (!exclusion) return null;
  const split = EDITION.stats.group_split[agentId];
  const sens = EDITION.stats.sensitivity.by_agent;
  const others = Object.entries(sens).filter(([id]) => id !== agentId);
  const registered = EDITION.pending.find((p) => p.registered_on)?.registered_on ?? null;
  const recordDate = formatRunWindow(EDITION.run_window);

  return (
    <div className="card-notice mt-8">
      <h2 className="text-base font-semibold text-notice-ink">The instrument, not the site.</h2>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-notice-body">
        {exclusion.errors === exclusion.recorded ? "All" : `${exclusion.errors} of`}{" "}
        {exclusion.recorded} recorded trials, across both agents, ended in the harness&apos;s own
        error after the site was reached
        {exclusion.error_signature && (
          <>
            {" "}
            (<code className="rounded bg-notice-soft px-1 py-0.5 font-mono text-xs">{exclusion.error_signature}</code>)
          </>
        )}
        , so registered rule (b) (every recorded trial the harness&apos;s own error, read from the
        batch record{recordDate && <> of {recordDate}</>}) names this site. The pre-registered rule
        counts an error that reached the site as a failure, so the rate above stands as published
        and is not retro-excluded; what it measures here is our instrument.
        {split && sens[agentId] && (
          <>
            {" "}
            Sensitivity under the registered rule: excluding it moves the all-failed group&apos;s
            Lighthouse category mean from {split.published.all_failed.mean?.toFixed(1)} to{" "}
            {split.rule_b.all_failed.mean?.toFixed(1)} over {split.rule_b.all_failed.count} sites,
            and the correlation to ρ&nbsp;=&nbsp;{formatR(sens[agentId].point)} at n&nbsp;=&nbsp;
            {sens[agentId].n} ({agentLabel(agentId)}
            {others.map(([id, s]) => (
              <span key={id}>
                ; {formatR(s.point)} on {agentLabel(id)}
              </span>
            ))}
            ).
          </>
        )}{" "}
        Rule (d), the instrument control
        {registered && <> registered on {formatDate(registered)}</>}, has not run.{" "}
        <Link href="/methodology#sensitivity" className="underline underline-offset-2">
          The rule
        </Link>
        .
      </p>
    </div>
  );
}

/** A prediction, not a finding: no provenance mark, no exclusion, no sensitivity (S2-4 section 5). */
function PendingNote({ siteId }: { siteId: string }) {
  const pending = EDITION.pending.find((p) => p.site_id === siteId);
  if (!pending) return null;
  return (
    <div className="card-notice mt-8">
      <h2 className="text-base font-semibold text-notice-ink">Pending the instrument control.</h2>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-notice-body">
        {pending.timeouts === pending.recorded ? "Every" : `${pending.timeouts} of ${pending.recorded}`}{" "}
        recorded trial{pending.timeouts === pending.recorded ? "" : "s"} on this site
        {pending.timeouts === pending.recorded && <> ({pending.recorded} of {pending.recorded}, across both agents)</>}{" "}
        ended at the {EDITION.protocol.clock_seconds}-second clock. A click on a matched, visible
        link that never lands is a suspected harness cause, which the instrument control
        {pending.registered_on ? <> registered on {formatDate(pending.registered_on)}</> : null} tests;
        it has not run. Until it does, the rate above stands as measured and no sensitivity
        excludes this site.{" "}
        <Link href="/methodology#instrument-v1" className="underline underline-offset-2">
          The control
        </Link>
        .
      </p>
    </div>
  );
}

function TrialRow({ run, excluded, href }: { run: Run; excluded: boolean; href: string }) {
  return (
    <tr className="border-b border-line-soft text-xs sm:text-sm">
      <td className="px-2 py-2 text-ink-body sm:px-4">
        {/* Links to this trial's replay, open, so a single transcript can be shared. */}
        <Link
          href={href}
          className="-my-1 inline-block whitespace-nowrap rounded py-1 font-medium text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-muted"
        >
          Trial {run.trial_number}
        </Link>
      </td>
      <td className="px-2 py-2 sm:px-4">
        {/* An attempt that never reached the site is not the site failing the task, so it is
            not scored as a failure — it is excluded from the denominator entirely. */}
        {excluded ? (
          <span
            className="whitespace-nowrap font-medium text-ink-muted"
            title="Excluded from the success rate: the agent never reached the site (0 steps), so this trial measures nothing about it."
          >
            excluded
          </span>
        ) : (
          <span
            className={`whitespace-nowrap font-medium ${run.success ? "text-good" : "text-bad"}`}
          >
            {run.success ? "✓ Success" : "✗ Failed"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-ink-body sm:px-4">
        {FAILURE_MODE_BADGES[run.failure_mode]}
      </td>
      <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums text-ink-body sm:px-4">
        {run.step_count} steps
      </td>
      <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums text-ink-body sm:px-4">
        {run.duration_seconds}s
      </td>
    </tr>
  );
}

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { agent?: string; trial?: string };
}) {
  const agentId = resolveAgentId(searchParams.agent);
  const data = await getSiteDetail(params.slug, agentId);
  if (!data) notFound();

  const { site, lighthouse, runs: allRuns } = data;
  // Label the numbers with the agent that actually produced these rows. In fixture mode the
  // requested agent and the fixture agent differ, and attributing invented trials to a real
  // model is exactly the kind of false statement this project cannot make.
  const measuredAgentId = allRuns[0]?.agent_id ?? agentId;
  // Summary stats follow the METHODOLOGY denominator rule (see measuredRuns); the
  // trial log below still shows every recorded row, excluded ones included.
  const runs = measuredRuns(allRuns);
  const excluded = allRuns.length - runs.length;
  const successes = runs.filter((r) => r.success).length;
  const successRate = runs.length > 0 ? Math.round((successes / runs.length) * 100) : 0;
  const meanSteps =
    runs.length > 0
      ? (runs.reduce((s, r) => s + r.step_count, 0) / runs.length).toFixed(1)
      : "–";

  const runWindow = formatRunWindow(
    allRuns.length > 0
      ? {
          first: allRuns.reduce((a, r) => (r.run_at < a ? r.run_at : a), allRuns[0].run_at),
          last: allRuns.reduce((a, r) => (r.run_at > a ? r.run_at : a), allRuns[0].run_at),
        }
      : null
  );

  const measuredIds = new Set(runs.map((r) => r.trial_number));

  // The batch this page read, and whether the edition snapshot describes the same one. The
  // exclusion notes are the snapshot's, so they print only beside their own batch.
  const pageBatch = allRuns[0]?.batch_label ?? lighthouse?.batch_label ?? ACTIVE_BATCH;
  const matches = editionMatches(pageBatch);
  const audits = lighthouse ? auditStatesOf(lighthouse) : null;

  // Which trial's replay renders open. An unrecognised, non-numeric or out-of-range value
  // opens nothing: a bad link shows the page, never a 404 and never an invented trial.
  const openTrial = resolveTrialParam(searchParams.trial, allRuns);
  const trialHref = (trialNumber: number) =>
    `${withAgent(`/site/${site.site_id}?trial=${trialNumber}`, agentId)}#trial-${trialNumber}`;

  const failureCounts: Record<string, number> = {};
  runs.forEach((r) => {
    failureCounts[r.failure_mode] = (failureCounts[r.failure_mode] ?? 0) + 1;
  });

  // No trials = no measurement. "0%" here would assert a result nobody produced —
  // the recurring bug class this project cannot afford (see buildout plan). A measured rate
  // prints in ink at every value: the label and the trial log carry the judgment, and a
  // threshold hue would be an editorial grade this study never registered.
  const rateColor = runs.length === 0 ? "text-ink-muted" : "text-ink";

  return (
    <div>
      {!matches && <EditionMismatch pageBatch={pageBatch} />}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Link href={withAgent("/", agentId)} className="back-link">
          ← Leaderboard
        </Link>
        <AgentToggle selected={agentId} basePath={`/site/${site.site_id}`} />
      </div>

      {/* Stacks below `sm`: a 5xl percentage and a long site name in one unwrapped flex row
          collided at 375px. */}
      <header className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h1 className="page-title">{site.name}</h1>
          <a
            href={site.start_url}
            target="_blank"
            rel="noreferrer"
            className="link-ink -mx-1 mt-1.5 inline-block break-all px-1 py-1 font-mono text-[13px] text-ink-body"
          >
            {site.start_url} ↗
          </a>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TierBadge tier={site.tier} />
            <FlagBadge flag={site.flag} />
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className={`font-mono text-[2.75rem] font-semibold leading-none tabular-nums ${rateColor}`}>
            {runs.length > 0 ? `${successRate}%` : "–"}
          </div>
          <div className="mt-2 text-sm font-medium text-ink-body">
            {runs.length > 0 ? "Agent success rate" : "Not measured"}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {runs.length} measured trials · {agentLabel(measuredAgentId)} · batch{" "}
            <code className="font-mono">{pageBatch}</code>
            {runWindow && <> · {runWindow}</>}
          </div>
          {excluded > 0 && (
            <div className="mt-2 max-w-xs text-xs leading-relaxed text-ink-muted sm:ml-auto">
              {runs.length === 0 ? (
                <>
                  All {excluded} recorded trials failed before the agent reached the site
                  (connection-level rejection at navigation, 0 steps), so this site has no
                  behavioral measurement, not a 0% success rate. Every attempt is in the trial
                  log below.
                </>
              ) : (
                <>+{excluded} excluded: never reached the site</>
              )}
            </div>
          )}
        </div>
      </header>

      {matches && <InstrumentCaveat siteId={site.site_id} agentId={measuredAgentId} />}
      {matches && <PendingNote siteId={site.site_id} />}

      <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
        {/* The category mean. A bare number: the same reason the leaderboard column is bare. */}
        <div className="md:border-r md:border-line md:pr-12">
          <h2 className="card-title flex items-baseline justify-between gap-3">
            Lighthouse category mean
            {lighthouse ? (
              <span className="font-mono text-xl font-semibold tabular-nums text-ink">
                {lighthouse.lh_total}
              </span>
            ) : (
              <span className="text-sm font-normal text-ink-muted">Not run yet</span>
            )}
          </h2>
          {lighthouse && (
            <p className="card-note mb-4">
              Batch <code className="font-mono">{lighthouse.batch_label}</code>
              {matches && EDITION.lane1.lighthouse_version && <> · Lighthouse {EDITION.lane1.lighthouse_version}</>} ·{" "}
              {formatDate(lighthouse.run_at)}. Chrome shows a fraction, not this mean;{" "}
              <Link href="/#fraction-not-score" className="link-ink">
                what the number is
              </Link>
              .
            </p>
          )}
          {lighthouse && audits ? (
            <div>
              {v1AuditLines(audits).map((line) => (
                <SubAuditRow key={line.key} line={line} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Run Lane 1 to populate the category mean.</p>
          )}
        </div>

        {/* Behavioral summary */}
        <div>
          <h2 className="card-title mb-4">Behavioral Summary</h2>
          {runs.length > 0 ? (
            <div>
              <div className="flex justify-between gap-3 border-b border-line-soft py-2.5 text-[13px]">
                <span className="text-ink-body">Successes</span>
                <span className="font-mono font-medium tabular-nums text-ink">
                  {successes} / {runs.length}
                </span>
              </div>
              <div className="flex justify-between gap-3 border-b border-line-soft py-2.5 text-[13px]">
                <span className="text-ink-body">Mean steps</span>
                <span className="font-mono font-medium tabular-nums text-ink">{meanSteps}</span>
              </div>
              <div className="mt-5">
                <p className="eyebrow mb-2">Failure breakdown</p>
                {Object.entries(failureCounts).map(([mode, count]) => (
                  <div key={mode} className="flex justify-between gap-3 py-1 text-[13px]">
                    <span className="capitalize text-ink-body">
                      {FAILURE_MODE_WORDS[mode as Run["failure_mode"]] ?? mode.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono tabular-nums text-ink">{count}×</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-ink-muted">
              {allRuns.length === 0
                ? "No runs yet. Execute Lane 2 to populate."
                : `No measured trials: all ${allRuns.length} recorded attempts ended before the agent reached the site, so there is nothing to summarise. The trial log below shows every attempt.`}
            </p>
          )}
        </div>
      </div>

      {/* The task the agent was given — previously invisible on the site page */}
      <div className="mt-12 border-t border-line pt-8">
        <h2 className="card-title mb-3">The task</h2>
        <p className="max-w-3xl font-serif text-[1.1875rem] italic leading-relaxed text-ink">
          &ldquo;{site.question}&rdquo;
        </p>
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Every site gets the same task shape: start at the URL above, navigate to the answer,
          report it. Only the question varies. The agent never sees the scoring key below.
        </p>
      </div>

      {/* Pre-registered answer */}
      <div className="card-notice mt-8">
        <h2 className="mb-2 text-base font-semibold text-notice-ink">Pre-registered scoring key</h2>
        <p className="text-sm text-notice-body">
          <span className="font-medium">Expected answer substring:</span>{" "}
          <code className="rounded bg-notice-soft px-1.5 py-0.5 font-mono text-notice-ink">
            {site.answer_substring}
          </code>
        </p>
        {site.match_rule && (
          <p className="mt-1.5 text-sm text-notice-body">
            <span className="font-medium">Match rule:</span>{" "}
            <code className="rounded bg-notice-soft px-1.5 py-0.5 font-mono text-notice-ink">
              {site.match_rule}
            </code>
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-notice-body">{site.answer_note}</p>
        <p className="mt-2 text-xs leading-relaxed text-notice-body">
          Registered before any agent runs. Success = the agent&apos;s final output contains this
          substring after the normalization rules in docs/METHODOLOGY.md.
        </p>
      </div>

      {/* Trial log — every recorded row, including excluded never-reached errors */}
      {allRuns.length > 0 && (
        <div className="mt-12 border-t border-line pt-8">
          <div className="pb-5">
            <h2 className="section-title">Trial log</h2>
            <p className="card-note max-w-3xl">
              Every recorded trial for {agentLabel(measuredAgentId)}, including attempts excluded from the
              success rate because they never reached the site. Expand a trial to replay the
              steps the agent recorded, and to see whether the record marks a failure point at
              all.
            </p>
          </div>
          {/* Five columns of run metadata do not fit 375px; they shrink to text-xs with tighter
              cells first and only scroll if that is still not enough. */}
          <div className="overflow-x-auto border-y border-line">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th scope="col" className="col-head px-2 py-2.5 text-left sm:px-4">
                    Trial
                  </th>
                  <th scope="col" className="col-head px-2 py-2.5 text-left sm:px-4">
                    Result
                  </th>
                  <th scope="col" className="col-head px-2 py-2.5 text-left sm:px-4">
                    Failure Mode
                  </th>
                  <th scope="col" className="col-head px-2 py-2.5 text-left sm:px-4">
                    Steps
                  </th>
                  <th scope="col" className="col-head px-2 py-2.5 text-left sm:px-4">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {allRuns
                  .sort((a, b) => a.trial_number - b.trial_number)
                  .map((run) => (
                    <Fragment key={run.trial_number}>
                      <TrialRow
                        run={run}
                        excluded={!measuredIds.has(run.trial_number)}
                        href={trialHref(run.trial_number)}
                      />
                      <tr className="border-b border-line-soft bg-surface-2/60 last:border-0">
                        <td colSpan={5} className="px-3 py-2.5 sm:px-4">
                          <TrialReplay
                            run={run}
                            id={`trial-${run.trial_number}`}
                            open={openTrial === run.trial_number}
                          />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
