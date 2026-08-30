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

// The bar and the tone are both redundant encodings: the percentage sits beside them and is
// what the reader takes the value from. Neither colour nor length carries anything alone.
function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const fill = pct >= 70 ? "bg-good-bar" : pct >= 40 ? "bg-mid-bar" : "bg-bad-bar";
  const text = pct >= 70 ? "text-good" : pct >= 40 ? "text-mid" : "text-bad";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-sm font-semibold tabular-nums ${text}`}>{pct}%</span>
    </div>
  );
}

function LhScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-sm text-ink-muted">—</span>;
  const tone =
    score >= 70
      ? "bg-good-soft text-good-ink"
      : score >= 40
        ? "bg-mid-soft text-mid-ink"
        : "bg-bad-soft text-bad-ink";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${tone}`}>
      {score}
    </span>
  );
}

function FailureBadge({ mode }: { mode: string }) {
  if (mode === "success")
    return <span className="chip chip-emerald">✓ success</span>;
  const labels: Record<string, string> = {
    blocked: "⛔ blocked",
    timeout: "⏱ timeout",
    wrong_extraction: "⚠ wrong ans.",
    navigation_stuck: "🔀 nav stuck",
    error: "💥 error",
  };
  return <span className="chip chip-slate">{labels[mode] ?? mode}</span>;
}

// Two different absences, and conflating them would misreport both: a site the agent
// attempted but never reached has no measurement (and a trial log explaining why), while a
// site with no rows at all simply has not been run for this agent. Neither is 0% success.
function NotMeasured({ href }: { href: string | null }) {
  if (!href) {
    return (
      <span className="text-sm text-ink-muted" title="No trials recorded for this agent yet.">
        not run
      </span>
    );
  }
  return (
    <Link
      href={href}
      title="Not measured: every recorded trial failed before the agent reached the site (connection-level rejection at navigation, 0 steps), so there is no success rate to report — see the trial log."
      className="chip -my-1 inline-block py-1.5 transition-colors chip-slate hover:text-ink"
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
    <div className="flex flex-wrap gap-1">
      {audits.map(({ key, label }) => {
        const val = entry[key];
        if (val === null) return null;
        return (
          <span
            key={key}
            title={label}
            // Pass reads as filled and green, fail as outlined and neutral — but the ✓/✗
            // and the audit name carry it on their own.
            className={`chip ${
              val === 1 ? "chip-emerald" : "chip-slate ring-1 ring-inset ring-line"
            }`}
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
      <header className="mb-10">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <h1 className="page-title">Is the web ready for agents?</h1>
          <AgentToggle selected={agentId} basePath="/" />
        </div>

        {summary.trial_count === 0 ? (
          <p className="max-w-2xl text-ink-body">
            No measured trials in batch{" "}
            <code className="font-mono text-ink">{summary.batch_label}</code> for{" "}
            {agentLabel(measuredAgentId)} yet. Every site gets the same task shape: start at the site,
            find one pre-registered fact, report it. Nothing is claimed until the lanes have run.
          </p>
        ) : (
          <div className="max-w-3xl space-y-3 text-ink-body">
            <p className="leading-relaxed">
              <span className="font-semibold text-ink">
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
                  <Link
                    href={withAgent("/correlation", agentId)}
                    className="font-medium text-accent hover:underline"
                  >
                    See the correlation →
                  </Link>
                </>
              ) : (
                <Link
                  href={withAgent("/correlation", agentId)}
                  className="font-medium text-accent hover:underline"
                >
                  See the correlation →
                </Link>
              )}
            </p>
            {otherAgents.length > 0 && (
              <p className="text-sm leading-relaxed">
                {otherAgents.map((other) => (
                  <span key={other.agent_id}>
                    {agentLabel(other.agent_id)} ran the identical loop on the identical cohort and
                    scored {formatPercent(other.success_rate)} ({other.success_count}/
                    {other.trial_count}).{" "}
                    {switchable(other.agent_id) && (
                      <Link
                        href={withAgent("/", other.agent_id)}
                        className="text-accent hover:underline"
                      >
                        Switch to it →
                      </Link>
                    )}
                  </span>
                ))}
              </p>
            )}
            <p className="text-xs leading-relaxed text-ink-muted">
              Scope of the claim: {summary.site_count} sites, one task shape, 5 trials per site,
              {panel.length === 1 ? " one agent" : ` ${panel.length} agents`} behind one frozen
              harness, one run window. Success is
              pre-registered exact match; trials that never reached the server are excluded from
              the denominator rather than scored 0%.
            </p>
          </div>
        )}
      </header>

      {/* Stats strip — every value carries the denominator it was computed over */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
          <div key={label} className="card px-4 py-4 sm:px-5">
            <p className="text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</p>
            <p className="mt-1 text-sm font-medium text-ink-body">{label}</p>
            <p className="mt-1 text-xs leading-snug text-ink-muted">{sub}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {/* Scrolls rather than clips: overflow-hidden silently cut the sub-audit column off
          the right edge once real site names widened the table. */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th scope="col" className="w-10 whitespace-nowrap px-4 py-3 font-semibold text-ink-body">#</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Site</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Tier</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Agent Success</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Top Failure</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Avg Steps</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Lighthouse</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-ink-body">Sub-audits</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-muted">
                  No cohort data yet. Seed the sites and run the lanes, or set{" "}
                  <code className="font-mono text-ink-body">USE_FAKE_DATA=true</code> for fixtures.
                </td>
              </tr>
            )}
            {entries.map((entry, i) => {
              const siteHref = withAgent(`/site/${entry.site_id}`, agentId);
              const notMeasuredHref = unmeasured.has(entry.site_id) ? siteHref : null;
              return (
                <tr
                  key={entry.site_id}
                  className={`border-b border-line-soft transition-colors hover:bg-surface-2 ${
                    i === entries.length - 1 ? "border-b-0" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-mono tabular-nums text-ink-muted">{entry.rank}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={siteHref}
                      className="-my-1 inline-block py-1 font-medium text-ink transition-colors hover:text-accent"
                    >
                      {entry.name}
                    </Link>
                    <div className="max-w-xs truncate text-xs text-ink-muted">{entry.start_url}</div>
                    {/* The design flag explains expected outliers in place: without it,
                        "Amazon 0%" reads as a broken benchmark, not a designed blocker. */}
                    {entry.flag && (
                      <div className="mt-1.5 max-w-xs truncate" title={entry.flag}>
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
                        <div className="mt-1 text-xs text-ink-muted">{entry.trial_count} trials</div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {/* No trials yet is not a failure mode — computeEntry reports "error" for
                        "no data", which would read as 28 crashed sites before a batch runs. */}
                    {entry.trial_count === 0 ? (
                      <span className="text-sm text-ink-muted">—</span>
                    ) : (
                      <FailureBadge mode={entry.top_failure_mode} />
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-body">
                    {entry.trial_count === 0 ? (
                      <span className="text-sm text-ink-muted">—</span>
                    ) : (
                      entry.mean_steps
                    )}
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

      <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-relaxed text-ink-muted">
        Scoring is pre-registered exact-match, decided before any agent runs (batch{" "}
        <code className="font-mono">{summary.batch_label}</code>, agent{" "}
        <code className="font-mono">{measuredAgentId}</code>
        {runWindow && <>, {runWindow}</>}). Static scores use{" "}
        <a
          href="https://developer.chrome.com/docs/lighthouse"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-line underline-offset-2 transition-colors hover:text-ink"
        >
          Lighthouse 13.3 Agentic Browsing category
        </a>
        , unmodified.
      </p>
    </div>
  );
}
