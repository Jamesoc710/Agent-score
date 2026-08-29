import Link from "next/link";
import { getPublishedDataset, toCorrelationPoints } from "@/lib/queries";
import {
  MIN_GROUP,
  MIN_N,
  binaryGroupSizes,
  bootstrapCI,
  formatInterval,
  formatR,
  linearRegression,
  pearson,
  relationshipVerdict,
  spearmanRho,
  strengthLabel,
  type Pair,
} from "@/lib/stats";
import { agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatRunWindow } from "@/lib/format";
import CorrelationChart from "@/components/CorrelationChart";
import AgentToggle from "@/components/AgentToggle";

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

const SUB_AUDITS = [
  { key: "lh_accessibility_tree" as const, label: "Accessibility Tree" },
  { key: "lh_layout_stability" as const, label: "Layout Stability" },
  { key: "lh_llms_txt" as const, label: "llms.txt" },
  { key: "lh_webmcp" as const, label: "WebMCP" },
];

export default async function CorrelationPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agentId = resolveAgentId(searchParams.agent);
  const { entries, summary } = await getPublishedDataset(agentId);
  const points = toCorrelationPoints(entries);
  // Whatever agent produced the rows, not the one that was asked for — they differ in
  // fixture mode, and a chart labelled with the wrong model is a false attribution.
  const measuredAgentId = summary.agent_id;

  const pairs: Pair[] = points.map((p) => ({ x: p.lh_total, y: p.success_rate }));
  const n = pairs.length;

  // Rank correlation is the headline: the Lighthouse score is an ordinal rubric score, and
  // rho does not assume the relationship is linear. Pearson is kept alongside because it is
  // what the fitted line on the scatter actually is.
  const rhoCI = bootstrapCI(pairs, spearmanRho);
  const rho = rhoCI?.point ?? spearmanRho(pairs);
  const r = pearson(pairs);
  const fit = linearRegression(pairs);
  const runWindow = formatRunWindow(summary.run_window);

  // Each sub-audit is a 0/1 split of the same sites. A split with almost nothing on one side
  // cannot support a correlation: in v1 exactly one site passes WebMCP, so a number there
  // would be an artifact of that single site, not a finding.
  const subAudits = SUB_AUDITS.map(({ key, label }) => {
    const auditPairs: Pair[] = points.map((p) => ({ x: p[key], y: p.success_rate }));
    const groups = binaryGroupSizes(auditPairs);
    const reportable = Math.min(groups.ones, groups.zeros) >= MIN_GROUP && n >= MIN_N;
    return { key, label, groups, r: reportable ? pearson(auditPairs) : null };
    // Strongest first; the audits that cannot be computed sort to the bottom rather than the
    // top (Math.abs(null ?? -1) would have ranked them above every real correlation).
  }).sort((a, b) => (b.r === null ? -1 : Math.abs(b.r)) - (a.r === null ? -1 : Math.abs(a.r)));

  const reportableAudits = subAudits.filter((a) => a.r !== null);

  // The biggest disagreement between the two rankings — the exhibit for "the static rubric
  // gets this one wrong".
  const byLh = [...points].sort((a, b) => b.lh_total - a.lh_total);
  const bySuccess = [...points].sort((a, b) => b.success_rate - a.success_rate);
  const surprising = points.reduce(
    (best, p) => {
      const lhRank = byLh.findIndex((x) => x.site_id === p.site_id);
      const successRank = bySuccess.findIndex((x) => x.site_id === p.site_id);
      const gap = Math.abs(lhRank - successRank);
      return gap > best.gap ? { site: p, gap, lhRank, successRank } : best;
    },
    { site: points[0], gap: 0, lhRank: 0, successRank: 0 }
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href={withAgent("/", agentId)}
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← Leaderboard
        </Link>
        <AgentToggle selected={agentId} basePath="/correlation" />
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Does Google&apos;s rubric predict agent success?
        </h1>
        <p className="text-slate-500 max-w-2xl">
          Each point is one site. The x-axis is Google&apos;s Lighthouse Agentic Browsing score; the
          y-axis is the measured success rate of {agentLabel(measuredAgentId)} completing a real task,
          5 trials per site. The dashed line is a least-squares fit.
        </p>
      </div>

      {/* The headline statistic, stated with its uncertainty and its n */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        {rho === null || rhoCI === null ? (
          <div>
            <p className="text-lg font-medium text-slate-900">No correlation to report yet.</p>
            <p className="text-sm text-slate-500 mt-1">
              {n} {n === 1 ? "site has" : "sites have"} both a Lighthouse score and measured
              agent trials; {MIN_N} is the minimum this page will compute a correlation from.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[auto,1fr] md:items-center">
            <div>
              <p className="text-4xl font-bold tabular-nums text-slate-900">
                ρ = {formatR(rho)}
              </p>
              <p className="text-sm text-slate-500 mt-1 tabular-nums">
                95% CI {formatInterval(rhoCI)}
              </p>
              <p className="text-xs text-slate-400 mt-1">n = {n} sites</p>
            </div>
            <div className="text-sm text-slate-600 space-y-2">
              <p>
                <span className="font-medium text-slate-900">
                  {relationshipVerdict(rhoCI) === "none"
                    ? "No measurable relationship."
                    : `A ${strengthLabel(rho)} relationship.`}
                </span>{" "}
                {relationshipVerdict(rhoCI) === "none" ? (
                  <>
                    Spearman rank correlation between the static score and behavioral success is{" "}
                    {formatR(rho)}, and the 95% bootstrap interval {formatInterval(rhoCI)} spans
                    zero — at {n} sites this experiment cannot distinguish the rubric&apos;s
                    predictive power from none at all. That is the result, not a
                    placeholder for one.
                  </>
                ) : (
                  <>
                    The 95% bootstrap interval {formatInterval(rhoCI)} excludes zero at {n} sites.
                  </>
                )}
              </p>
              <p className="text-xs text-slate-400">
                Spearman ρ, 10,000-iteration percentile bootstrap resampling sites, fixed seed.
                Pearson r = {r === null ? "—" : formatR(r)} (the fitted line).{" "}
                {runWindow && <>Measured {runWindow} (UTC).</>} Sites whose every trial never
                reached the server are excluded from n, not counted as 0%
                {summary.unmeasured_site_ids.length > 0 && (
                  <> — {summary.unmeasured_site_ids.join(", ")} in this batch</>
                )}
                .
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The scatter chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
        <CorrelationChart points={points} fit={fit} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Sub-audit ranking */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Which sub-audit predicts success?</h2>
          <p className="text-xs text-slate-400 mb-4">
            Correlation between passing one audit and behavioral success rate, with the number of
            sites on each side of the split. Exploratory: four comparisons, no correction for
            multiple testing, same {n} sites.
          </p>

          {n < MIN_N ? (
            <p className="text-sm text-slate-400">
              Not enough data yet ({n} {n === 1 ? "site" : "sites"} with both lanes measured).
            </p>
          ) : (
            <div className="space-y-3">
              {subAudits.map((audit, i) => (
                <div key={audit.key}>
                  <div className="flex justify-between text-sm mb-1 gap-3">
                    <span className={audit.r === null ? "text-slate-400" : "text-slate-700 font-medium"}>
                      {audit.r !== null && i === 0 && "🥇 "}
                      {audit.label}
                      <span className="text-xs text-slate-400 font-normal">
                        {" "}
                        ({audit.groups.ones} pass / {audit.groups.zeros} fail)
                      </span>
                    </span>
                    {audit.r === null ? (
                      <span
                        className="text-xs text-slate-400 whitespace-nowrap"
                        title={`Fewer than ${MIN_GROUP} sites on one side of the split — a correlation here would describe those sites, not the audit.`}
                      >
                        not computable
                      </span>
                    ) : (
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          Math.abs(audit.r) >= 0.5 ? "text-sky-600" : "text-slate-400"
                        }`}
                      >
                        r = {formatR(audit.r)}
                      </span>
                    )}
                  </div>
                  <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        audit.r === null
                          ? "bg-slate-200"
                          : Math.abs(audit.r) >= 0.5
                          ? "bg-sky-500"
                          : "bg-slate-300"
                      }`}
                      style={{ width: audit.r === null ? "0%" : `${Math.abs(audit.r) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Surprising site callout */}
        {surprising.gap > 1 && surprising.site && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-900 mb-2">The most interesting data point</h2>
            <p className="text-sm text-slate-500 mb-4">
              This site has the biggest gap between its Lighthouse rank and its behavioral rank — the
              case where the static rubric gets it wrong.
            </p>
            <Link
              href={withAgent(`/site/${surprising.site.site_id}`, agentId)}
              className="block rounded-lg border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors p-4"
            >
              <p className="font-semibold text-slate-900 mb-1">{surprising.site.name}</p>
              <div className="text-sm text-slate-500 space-y-1">
                <p>
                  Lighthouse rank:{" "}
                  <span className="font-mono text-slate-700">#{surprising.lhRank + 1}</span> (score:{" "}
                  {surprising.site.lh_total})
                </p>
                <p>
                  Behavioral rank:{" "}
                  <span className="font-mono text-slate-700">#{surprising.successRank + 1}</span> (
                  {Math.round(surprising.site.success_rate * 100)}% success)
                </p>
                <p className="text-sky-600 font-medium mt-2">View site detail →</p>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* One-liner finding */}
      <div className="bg-slate-900 text-white rounded-xl p-6">
        <h2 className="font-semibold text-slate-200 mb-2 text-sm uppercase tracking-wide">
          The finding
        </h2>
        <p className="text-lg font-medium leading-relaxed">
          {rho === null || rhoCI === null ? (
            <>
              No finding yet. {n === 0 ? "No site" : `Only ${n} ${n === 1 ? "site" : "sites"}`} in
              this batch {n === 1 ? "has" : "have"} both a Lighthouse score and measured agent
              trials, so there is nothing to correlate — this page states the result once the lanes
              have run, and claims nothing before then.
            </>
          ) : relationshipVerdict(rhoCI) === "none" ? (
            <>
              On {n} sites, Google&apos;s Agentic Browsing score did not predict whether{" "}
              {agentLabel(measuredAgentId)} could complete a real task (ρ&nbsp;=&nbsp;{formatR(rho)}, 95%
              CI&nbsp;{formatInterval(rhoCI)}). The static rubric and the behavioral outcome are
              measuring different things.
            </>
          ) : (
            <>
              On {n} sites, the Agentic Browsing score tracks behavioral success
              (ρ&nbsp;=&nbsp;{formatR(rho)}, 95% CI&nbsp;{formatInterval(rhoCI)}).
            </>
          )}
        </p>
        {reportableAudits.length > 0 && rho !== null && (
          <p className="text-sm text-slate-300 mt-3">
            Strongest single audit: {reportableAudits[0].label} (r&nbsp;=&nbsp;
            {formatR(reportableAudits[0].r!)}), on the same {n} sites and with the same caveat —
            an interval this wide supports ranking the audits for a follow-up, not a claim about
            any of them.
          </p>
        )}
      </div>
    </div>
  );
}
