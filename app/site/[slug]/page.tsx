import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteDetail, measuredRuns } from "@/lib/queries";
import { Run } from "@/lib/types";
import { TierBadge, FlagBadge } from "@/components/SiteBadges";
import AgentToggle from "@/components/AgentToggle";
import TrialReplay from "@/components/TrialReplay";
import { agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatRunWindow } from "@/lib/format";
import { resolveTrialParam } from "@/lib/transcript";

function SubAuditRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2.5 last:border-0">
      <span className="text-sm text-ink-body">{label}</span>
      {/* Glyph and word both say it; the tone is the third, redundant channel. */}
      <span
        className={`whitespace-nowrap text-sm font-medium ${
          value === 1 ? "text-good" : "text-ink-muted"
        }`}
      >
        {value === 1 ? "✓ Pass" : "✗ Fail"}
      </span>
    </div>
  );
}

function TrialRow({ run, excluded, href }: { run: Run; excluded: boolean; href: string }) {
  const failureLabels: Record<string, string> = {
    success: "✓ success",
    blocked: "⛔ blocked",
    timeout: "⏱ timeout",
    wrong_extraction: "⚠ wrong answer",
    navigation_stuck: "🔀 nav stuck",
    error: "💥 error",
  };
  return (
    <tr className="border-b border-line-soft text-xs sm:text-sm">
      <td className="px-2 py-2 text-ink-body sm:px-4">
        {/* Links to this trial's replay, open, so a single transcript can be shared. */}
        <Link
          href={href}
          className="whitespace-nowrap font-medium transition-colors hover:text-accent"
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
            — excluded
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
        {failureLabels[run.failure_mode]}
      </td>
      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-body sm:px-4">
        {run.step_count} steps
      </td>
      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-body sm:px-4">
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
      : "—";

  const runWindow = formatRunWindow(
    allRuns.length > 0
      ? {
          first: allRuns.reduce((a, r) => (r.run_at < a ? r.run_at : a), allRuns[0].run_at),
          last: allRuns.reduce((a, r) => (r.run_at > a ? r.run_at : a), allRuns[0].run_at),
        }
      : null
  );

  const measuredIds = new Set(runs.map((r) => r.trial_number));

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
  // the recurring bug class this project cannot afford (see buildout plan).
  const rateColor =
    runs.length === 0
      ? "text-ink-muted"
      : successRate >= 70
        ? "text-good"
        : successRate >= 40
          ? "text-mid"
          : "text-bad";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Link href={withAgent("/", agentId)} className="back-link">
          ← Leaderboard
        </Link>
        <AgentToggle selected={agentId} basePath={`/site/${site.site_id}`} />
      </div>

      {/* Stacks below `sm`: a 5xl percentage and a long site name in one unwrapped flex row
          collided at 375px. */}
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <h1 className="page-title">{site.name}</h1>
          <a
            href={site.start_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block break-all text-sm text-accent hover:underline"
          >
            {site.start_url} ↗
          </a>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <TierBadge tier={site.tier} />
            <FlagBadge flag={site.flag} />
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className={`text-4xl font-bold tabular-nums tracking-tight sm:text-5xl ${rateColor}`}>
            {runs.length > 0 ? `${successRate}%` : "—"}
          </div>
          <div className="mt-1 text-sm font-medium text-ink-body">
            {runs.length > 0 ? "Agent success rate" : "Not measured"}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {runs.length} measured trials · {agentLabel(measuredAgentId)}
            {runWindow && <> · {runWindow}</>}
          </div>
          {excluded > 0 && (
            <div className="mt-2 max-w-xs text-xs leading-relaxed text-ink-muted sm:ml-auto">
              {runs.length === 0 ? (
                <>
                  All {excluded} recorded trials failed before the agent reached the site
                  (connection-level rejection at navigation, 0 steps), so this site has no
                  behavioral measurement — not a 0% success rate. Every attempt is in the trial
                  log below.
                </>
              ) : (
                <>+{excluded} excluded: never reached the site</>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6">
        {/* Lighthouse scores */}
        <div className="card card-pad">
          <h2 className="card-title mb-4 flex items-center justify-between gap-3">
            Lighthouse Agentic Browsing
            {lighthouse ? (
              <span
                className={`text-lg font-bold tabular-nums ${
                  lighthouse.lh_total >= 70
                    ? "text-good"
                    : lighthouse.lh_total >= 40
                      ? "text-mid"
                      : "text-bad"
                }`}
              >
                {lighthouse.lh_total}
              </span>
            ) : (
              <span className="text-sm font-normal text-ink-muted">Not run yet</span>
            )}
          </h2>
          {lighthouse ? (
            <div>
              <SubAuditRow label="Accessibility Tree Quality" value={lighthouse.lh_accessibility_tree} />
              <SubAuditRow label="Layout Stability" value={lighthouse.lh_layout_stability} />
              <SubAuditRow label="llms.txt Present" value={lighthouse.lh_llms_txt} />
              <SubAuditRow label="WebMCP Present" value={lighthouse.lh_webmcp} />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Run Lane 1 to populate Lighthouse scores.</p>
          )}
        </div>

        {/* Behavioral summary */}
        <div className="card card-pad">
          <h2 className="card-title mb-4">Behavioral Summary</h2>
          {runs.length > 0 ? (
            <div className="space-y-3">
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-ink-body">Successes</span>
                <span className="font-medium tabular-nums text-ink">
                  {successes} / {runs.length}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-ink-body">Mean steps</span>
                <span className="font-medium tabular-nums text-ink">{meanSteps}</span>
              </div>
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Failure breakdown
                </p>
                {Object.entries(failureCounts).map(([mode, count]) => (
                  <div key={mode} className="flex justify-between gap-3 py-0.5 text-sm">
                    <span className="capitalize text-ink-body">{mode.replace(/_/g, " ")}</span>
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
      <div className="card card-pad mb-8">
        <h2 className="card-title mb-2">The task</h2>
        <p className="text-sm leading-relaxed text-ink-body">&ldquo;{site.question}&rdquo;</p>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Every site gets the same task shape: start at the URL above, navigate to the answer,
          report it. Only the question varies. The agent never sees the scoring key below.
        </p>
      </div>

      {/* Pre-registered answer */}
      <div className="card-notice mb-8">
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
        <p className="mt-2 text-xs leading-relaxed text-notice-body opacity-80">
          Registered before any agent runs. Success = the agent&apos;s final output contains this
          substring after the normalization rules in docs/METHODOLOGY.md.
        </p>
      </div>

      {/* Trial log — every recorded row, including excluded never-reached errors */}
      {allRuns.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-line-soft px-5 py-4 sm:px-6">
            <h2 className="card-title">Trial log</h2>
            <p className="card-note max-w-3xl">
              Every recorded trial for {agentLabel(measuredAgentId)}, including attempts excluded from the
              success rate because they never reached the site. Expand a trial to replay the
              steps the agent recorded, and to see whether the record marks a failure point at
              all.
            </p>
          </div>
          {/* Five columns of run metadata do not fit 375px; they shrink to text-xs with tighter
              cells first and only scroll if that is still not enough. */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line-soft bg-surface-2">
                  <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-ink-body sm:px-4">
                    Trial
                  </th>
                  <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-ink-body sm:px-4">
                    Result
                  </th>
                  <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-ink-body sm:px-4">
                    Failure Mode
                  </th>
                  <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-ink-body sm:px-4">
                    Steps
                  </th>
                  <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-ink-body sm:px-4">
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
