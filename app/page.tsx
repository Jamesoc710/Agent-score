import Link from "next/link";
import { getPublishedDataset, toCorrelationPoints } from "@/lib/queries";
import { SiteLeaderboardEntry } from "@/lib/types";
import { TierBadge, FlagBadge } from "@/components/SiteBadges";
import AgentToggle from "@/components/AgentToggle";
import { PUBLISHED_AGENTS, agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatPercent, formatRunWindow } from "@/lib/format";
import {
  bootstrapCI,
  formatInterval,
  formatR,
  relationshipVerdict,
  spearmanRho,
  type Pair,
} from "@/lib/stats";

function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-semibold tabular-nums ${pct >= 70 ? "text-emerald-700" : pct >= 40 ? "text-amber-700" : "text-red-600"}`}>
        {pct}%
      </span>
    </div>
  );
}

function LhScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-400 text-sm">—</span>;
  const color =
    score >= 70 ? "text-emerald-700 bg-emerald-50" : score >= 40 ? "text-amber-700 bg-amber-50" : "text-red-600 bg-red-50";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-sm font-semibold tabular-nums ${color}`}>
      {score}
    </span>
  );
}

function FailureBadge({ mode }: { mode: string }) {
  if (mode === "success")
    return <span className="text-xs text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">✓ success</span>;
  const labels: Record<string, string> = {
    blocked: "⛔ blocked",
    timeout: "⏱ timeout",
    wrong_extraction: "⚠ wrong ans.",
    navigation_stuck: "🔀 nav stuck",
    error: "💥 error",
  };
  return (
    <span className="text-xs text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
      {labels[mode] ?? mode}
    </span>
  );
}

// Two different absences, and conflating them would misreport both: a site the agent
// attempted but never reached has no measurement (and a trial log explaining why), while a
// site with no rows at all simply has not been run for this agent. Neither is 0% success.
function NotMeasured({ href }: { href: string | null }) {
  if (!href) {
    return (
      <span className="text-slate-400 text-sm" title="No trials recorded for this agent yet.">
        not run
      </span>
    );
  }
  return (
    <Link
      href={href}
      title="Not measured: every recorded trial failed before the agent reached the site (connection-level rejection at navigation, 0 steps), so there is no success rate to report — see the trial log."
      className="text-xs rounded px-1.5 py-0.5 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors whitespace-nowrap"
    >
      not measured ⓘ
    </Link>
  );
}

function SubAudits({ entry }: { entry: SiteLeaderboardEntry }) {
  const audits = [
    { key: "lh_accessibility_tree", label: "A11y Tree" },
    { key: "lh_layout_stability", label: "Stability" },
    { key: "lh_llms_txt", label: "llms.txt" },
    { key: "lh_webmcp", label: "WebMCP" },
  ] as const;

  return (
    <div className="flex gap-1">
      {audits.map(({ key, label }) => {
        const val = entry[key];
        if (val === null) return null;
        return (
          <span
            key={key}
            title={label}
            className={`text-xs rounded px-1 py-0.5 ${val === 1 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}
          >
            {val === 1 ? "✓" : "✗"} {label}
          </span>
        );
      })}
    </div>
  );
}

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agentId = resolveAgentId(searchParams.agent);
  const { entries, summary, panel } = await getPublishedDataset(agentId);

  // The headline correlation, computed from exactly the sites the scatter plots.
  const points = toCorrelationPoints(entries);
  const pairs: Pair[] = points.map((p) => ({ x: p.lh_total, y: p.success_rate }));
  const rhoCI = bootstrapCI(pairs, spearmanRho);

  const runWindow = formatRunWindow(summary.run_window);
  const unmeasured = new Set(summary.unmeasured_site_ids);

  // Unweighted mean of per-site rates: a different number from the trial-level rate above,
  // and labelled as such so the two can never be read as the same measurement.
  const measuredEntries = entries.filter((e) => e.trial_count > 0);
  const meanSiteRate =
    measuredEntries.length > 0
      ? measuredEntries.reduce((s, e) => s + e.success_rate, 0) / measuredEntries.length
      : null;

  // Label everything with the agent the data actually came from, not the requested one: in
  // fixture mode those differ, and printing the requested agent over fixture numbers would
  // attribute invented results to a real model.
  const measuredAgentId = summary.agent_id;
  const otherAgents = panel.filter((p) => p.agent_id !== measuredAgentId && p.trial_count > 0);
  const switchable = (id: string) => PUBLISHED_AGENTS.some((a) => a.id === id);

  return (
    <div>
      {/* Hero — the measured result, with its denominators */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
          <h1 className="text-3xl font-bold text-slate-900">Is the web ready for agents?</h1>
          <AgentToggle selected={agentId} basePath="/" />
        </div>

        {summary.trial_count === 0 ? (
          <p className="text-slate-500 max-w-2xl">
            No measured trials in batch{" "}
            <code className="font-mono text-slate-600">{summary.batch_label}</code> for{" "}
            {agentLabel(measuredAgentId)} yet. Every site gets the same task shape: start at the site,
            find one pre-registered fact, report it. Nothing is claimed until the lanes have run.
          </p>
        ) : (
          <div className="text-slate-500 max-w-3xl space-y-2">
            <p>
              <span className="font-medium text-slate-900">
                {agentLabel(measuredAgentId)} completed the task on{" "}
                {formatPercent(summary.success_rate)} of trials
              </span>{" "}
              ({summary.success_count} of {summary.trial_count} measured trials across{" "}
              {summary.measured_site_count} of {summary.site_count} sites
              {runWindow && <>, measured {runWindow}</>}).{" "}
              {rhoCI ? (
                <>
                  {relationshipVerdict(rhoCI) === "none"
                    ? "No relationship between Google's Lighthouse Agentic Browsing score and where it succeeded was distinguishable from noise"
                    : `Google's Lighthouse Agentic Browsing score tracked where it succeeded (${
                        relationshipVerdict(rhoCI) === "positive" ? "higher" : "lower"
                      } scores, more successes)`}
                  : ρ&nbsp;=&nbsp;{formatR(rhoCI.point)}, 95%&nbsp;CI&nbsp;
                  {formatInterval(rhoCI)}, n&nbsp;=&nbsp;{pairs.length} sites.{" "}
                  <Link href={withAgent("/correlation", agentId)} className="text-sky-600 hover:underline font-medium">
                    See the correlation →
                  </Link>
                </>
              ) : (
                <Link href={withAgent("/correlation", agentId)} className="text-sky-600 hover:underline font-medium">
                  See the correlation →
                </Link>
              )}
            </p>
            {otherAgents.length > 0 && (
              <p className="text-sm">
                {otherAgents.map((other) => (
                  <span key={other.agent_id}>
                    {agentLabel(other.agent_id)} ran the identical loop on the identical cohort and
                    scored {formatPercent(other.success_rate)} ({other.success_count}/
                    {other.trial_count}).{" "}
                    {switchable(other.agent_id) && (
                      <Link
                        href={withAgent("/", other.agent_id)}
                        className="text-sky-600 hover:underline"
                      >
                        Switch to it →
                      </Link>
                    )}
                  </span>
                ))}
              </p>
            )}
            <p className="text-xs text-slate-400">
              Scope of the claim: {summary.site_count} sites, one task shape, 5 trials per site,
              {panel.length === 1 ? " one agent" : ` ${panel.length} agents`} behind one frozen
              harness, one run window. Success is
              pre-registered exact match; trials that never reached the server are excluded from
              the denominator rather than scored 0%.
            </p>
          </div>
        )}
      </div>

      {/* Stats strip — every value carries the denominator it was computed over */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: "Task success (per trial)",
            value: formatPercent(summary.success_rate),
            sub:
              summary.trial_count > 0
                ? `${summary.success_count} of ${summary.trial_count} measured trials`
                : "no measured trials",
          },
          {
            label: "Mean site success rate",
            value: formatPercent(meanSiteRate),
            sub:
              measuredEntries.length > 0
                ? `unweighted mean over ${measuredEntries.length} measured sites`
                : "no measured sites",
          },
          {
            label: "Sites measured",
            value: `${summary.measured_site_count} / ${summary.site_count}`,
            sub:
              summary.excluded_trial_count > 0
                ? `${summary.excluded_trial_count} trials never reached the site`
                : "cohort sites with at least one measured trial",
          },
          {
            label: "Static score vs success",
            value: rhoCI ? `ρ = ${formatR(rhoCI.point)}` : "—",
            sub: rhoCI
              ? `95% CI ${formatInterval(rhoCI)}, n = ${pairs.length}`
              : "not enough measured sites",
          },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{label}</p>
            <p className="text-xs text-slate-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {/* Scrolls rather than clips: overflow-hidden silently cut the sub-audit column off
          the right edge once real site names widened the table. */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[56rem]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 font-semibold text-slate-500 w-10">#</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Site</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Tier</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Agent Success</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Top Failure</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Avg Steps</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Lighthouse</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Sub-audits</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  No cohort data yet. Seed the sites and run the lanes, or set{" "}
                  <code className="font-mono text-slate-500">USE_FAKE_DATA=true</code> for fixtures.
                </td>
              </tr>
            )}
            {entries.map((entry, i) => {
              const siteHref = withAgent(`/site/${entry.site_id}`, agentId);
              const notMeasuredHref = unmeasured.has(entry.site_id) ? siteHref : null;
              return (
                <tr key={entry.site_id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i === entries.length - 1 ? "border-b-0" : ""}`}>
                  <td className="px-4 py-3 text-slate-400 font-mono">{entry.rank}</td>
                  <td className="px-4 py-3">
                    <Link href={siteHref} className="font-medium text-slate-900 hover:text-sky-600 transition-colors">
                      {entry.name}
                    </Link>
                    <div className="text-xs text-slate-400 truncate max-w-xs">{entry.start_url}</div>
                    {/* The design flag explains expected outliers in place: without it,
                        "Amazon 0%" reads as a broken benchmark, not a designed blocker. */}
                    {entry.flag && (
                      <div className="mt-1 truncate max-w-xs" title={entry.flag}>
                        <FlagBadge flag={entry.flag} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={entry.tier} />
                  </td>
                  <td className="px-4 py-3">
                    {/* 0 trials is "not measured", not "0% success" — a red bar on an
                        unrun site asserts a result that does not exist. */}
                    {entry.trial_count === 0 ? (
                      <NotMeasured href={notMeasuredHref} />
                    ) : (
                      <>
                        <SuccessBar rate={entry.success_rate} />
                        <div className="text-xs text-slate-400 mt-0.5">{entry.trial_count} trials</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* No trials yet is not a failure mode — computeEntry reports "error" for
                        "no data", which would read as 28 crashed sites before a batch runs. */}
                    {entry.trial_count === 0 ? (
                      <span className="text-slate-400 text-sm">—</span>
                    ) : (
                      <FailureBadge mode={entry.top_failure_mode} />
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">
                    {entry.trial_count === 0 ? <span className="text-slate-400 text-sm">—</span> : entry.mean_steps}
                  </td>
                  <td className="px-4 py-3">
                    <LhScore score={entry.lh_total} />
                  </td>
                  <td className="px-4 py-3">
                    <SubAudits entry={entry} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-4 text-center">
        Scoring is pre-registered exact-match, decided before any agent runs (batch{" "}
        <code className="font-mono">{summary.batch_label}</code>, agent{" "}
        <code className="font-mono">{measuredAgentId}</code>
        {runWindow && <>, {runWindow}</>}). Static scores use{" "}
        <a href="https://developer.chrome.com/docs/lighthouse" target="_blank" rel="noreferrer" className="underline">
          Lighthouse 13.3 Agentic Browsing category
        </a>
        , unmodified.
      </p>
    </div>
  );
}
