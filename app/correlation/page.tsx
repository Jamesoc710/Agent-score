import Link from "next/link";
import { getPanelAuditPoints, getPublishedDataset, toCorrelationPoints } from "@/lib/queries";
import {
  MIN_GROUP,
  MIN_N,
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
import { analyzeSubAudits } from "@/lib/sub-audits";
import { agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatP, formatPoints, formatRunWindow } from "@/lib/format";
import CorrelationChart from "@/components/CorrelationChart";
import AgentToggle from "@/components/AgentToggle";
import IntervalBar, { IntervalTicks } from "@/components/IntervalBar";
import { EXHIBIT } from "@/lib/exhibit-data";

// Every gap bar on this site shares one scale, so widths are comparable between figures. The
// widest published interval is [-44.5, +50.3]; ±80 points contains everything with margin.
const GAP_DOMAIN = { min: -80, max: 80 };

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

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

  // The authored exhibit's own static score, read from its committed artifact rather than
  // written into the copy: this card must not assert a number the exhibit did not measure.
  const exhibitScores = [
    ...new Set(EXHIBIT.pages.map((p) => p.lighthouse?.lh_total).filter((v) => v != null)),
  ];
  const exhibitScore = exhibitScores.length === 1 ? exhibitScores[0] : null;

  // Each sub-audit is a 0/1 split of the same sites, and the full analysis of those splits —
  // six comparisons across both agents, corrected for multiplicity — lives on
  // /correlation/audits. This page carries the summary and links through, because the family is
  // what the correction covers and rendering half of it here would misstate it.
  const subAudits = analyzeSubAudits(await getPanelAuditPoints(), { detail: false });
  const auditRows =
    subAudits.agents.find((a) => a.agent_id === measuredAgentId)?.rows ??
    subAudits.agents[0]?.rows ??
    [];
  const distinguishable = subAudits.family
    ? subAudits.family.comparisons.filter((c) => c.pFamilyWise <= subAudits.family!.level).length
    : 0;

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
      <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Link href={withAgent("/", agentId)} className="back-link">
          ← Leaderboard
        </Link>
        <AgentToggle selected={agentId} basePath="/correlation" />
      </div>

      <header>
        <h1 className="page-title max-w-3xl">Does Google&apos;s rubric predict agent success?</h1>
        <p className="page-lead max-w-3xl">
          Each point is one site. The x-axis is Google&apos;s Lighthouse Agentic Browsing score; the
          y-axis is the measured success rate of {agentLabel(measuredAgentId)} completing a real task,
          5 trials per site. The dashed line is a least-squares fit.
        </p>
      </header>

      {/* The headline statistic, stated with its uncertainty and its n */}
      <div className="mt-10 border-y border-line py-7">
        {rho === null || rhoCI === null ? (
          <div>
            <p className="text-lg font-medium text-ink">No correlation to report yet.</p>
            <p className="mt-1 text-sm text-ink-body">
              {n} {n === 1 ? "site has" : "sites have"} both a Lighthouse score and measured
              agent trials; {MIN_N} is the minimum this page will compute a correlation from.
            </p>
          </div>
        ) : (
          <div className="grid gap-7 md:grid-cols-[minmax(0,20rem),1fr] md:gap-10">
            <div className="md:border-r md:border-line md:pr-10">
              <p className="font-mono text-[2.375rem] font-semibold leading-none tabular-nums text-ink">
                ρ = {formatR(rho)}
              </p>
              {/* The interval, drawn on a fixed [-1, +1] scale: it visibly straddles the zero
                  rule, which is the whole finding. */}
              <div className="mt-4 max-w-[18rem]">
                <IntervalBar
                  domain={{ min: -1, max: 1 }}
                  interval={{ lo: rhoCI.lo, hi: rhoCI.hi }}
                  point={rho}
                  zero
                  height="md"
                />
                <IntervalTicks labels={["-1", "0", "+1"]} />
              </div>
              <p className="mt-4 font-mono text-[13px] tabular-nums text-ink-body">
                95% CI {formatInterval(rhoCI)}
              </p>
              <p className="mt-1 font-mono text-xs tabular-nums text-ink-muted">n = {n} sites</p>
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-ink-body">
              <p>
                <span className="font-semibold text-ink">
                  {relationshipVerdict(rhoCI) === "none"
                    ? "No relationship distinguishable from noise."
                    : `A ${strengthLabel(rho)} relationship.`}
                </span>{" "}
                {relationshipVerdict(rhoCI) === "none" ? (
                  <>
                    Spearman rank correlation between the static score and behavioral success is{" "}
                    {formatR(rho)}, and the 95% bootstrap interval {formatInterval(rhoCI)} spans
                    zero: at {n} sites this experiment cannot distinguish the rubric&apos;s
                    predictive power from none at all. That is the result, not a
                    placeholder for one.
                  </>
                ) : (
                  <>
                    The 95% bootstrap interval {formatInterval(rhoCI)} excludes zero at {n} sites.
                  </>
                )}
              </p>
              <p className="text-xs leading-relaxed text-ink-muted">
                Spearman ρ, 10,000-iteration percentile bootstrap resampling sites, fixed seed.
                Pearson r = {r === null ? "–" : formatR(r)} (the fitted line).{" "}
                {runWindow && <>Measured {runWindow} (UTC).</>} Sites whose every trial never
                reached the server are excluded from n, not counted as 0%
                {summary.unmeasured_site_ids.length > 0 && (
                  <> ({summary.unmeasured_site_ids.join(", ")} in this batch)</>
                )}
                .
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The scatter chart, unframed: it sits on the page between hairlines rather than in a
          box, so the plot is the object rather than the card around it. */}
      <div className="border-b border-line py-4 sm:py-6">
        <CorrelationChart points={points} fit={fit} />
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-12">
        {/* Sub-audit summary — the full family lives on its own page */}
        <div className="md:border-r md:border-line md:pr-12">
          <h2 className="section-title">
            {subAudits.family === null
              ? "Which sub-audit is doing the work?"
              : distinguishable === 0
              ? "No single sub-audit is distinguishable from noise either"
              : `${distinguishable} of ${subAudits.family.size} sub-audit comparisons clears the bar`}
          </h2>
          <p className="card-note mb-6 mt-2">
            Each audit splits the cohort into the sites that pass it and the sites that do not. The
            gap below is the difference in mean success rate between those two groups, for{" "}
            {agentLabel(measuredAgentId)}
            {subAudits.family && (
              <>
                , with a p-value corrected across all {subAudits.family.size} comparisons the study
                looked at
              </>
            )}
            .
          </p>

          {n < MIN_N || auditRows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Not enough data yet ({n} {n === 1 ? "site" : "sites"} with both lanes measured).
            </p>
          ) : (
            <div className="space-y-4">
              {auditRows.map((audit) => (
                <div key={audit.key} className="border-t border-line-soft pt-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span
                      className={
                        audit.estimate === null ? "text-ink-muted" : "font-medium text-ink-strong"
                      }
                    >
                      {audit.label}
                      <span className="text-xs font-normal text-ink-muted">
                        {" "}
                        ({audit.groups.ones} pass / {audit.groups.zeros} fail)
                      </span>
                    </span>
                    {audit.estimate === null && (
                      <span
                        className="whitespace-nowrap text-xs text-ink-muted"
                        title={`Fewer than ${MIN_GROUP} sites on one side of the split; an estimate here would describe those sites, not the audit.`}
                      >
                        {audit.minimumAttainableP !== null && audit.minimumAttainableP > 0.05
                          ? "unfalsifiable at this split"
                          : "not reportable"}
                      </span>
                    )}
                  </div>
                  {/* No estimate renders no track: an empty bar would read as a zero-width
                      interval, which is a claim this split cannot make. */}
                  {audit.estimate !== null && (
                    <>
                      <IntervalBar
                        domain={GAP_DOMAIN}
                        interval={{
                          lo: audit.estimate.ci.lo * 100,
                          hi: audit.estimate.ci.hi * 100,
                        }}
                        point={audit.estimate.gap * 100}
                        zero
                        className="mt-2.5"
                      />
                      <p className="mt-2 whitespace-nowrap text-xs text-ink-muted">
                        <span className="font-mono font-semibold tabular-nums text-ink-strong">
                          {formatPoints(audit.estimate.gap)} pts
                        </span>
                        {"  ·  "}p = {formatP(audit.pFamilyWise!)}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <Link
            href={withAgent("/correlation/audits", agentId)}
            className="link-ink -mx-1 mt-6 inline-block px-1 py-1.5 text-sm font-medium text-ink"
          >
            Full breakdown, both agents, with the power analysis →
          </Link>
        </div>

        {/* Surprising site callout */}
        {surprising.gap > 1 && surprising.site && (
          <div>
            <h2 className="section-title">The most interesting data point</h2>
            <p className="mb-5 mt-2 text-sm leading-relaxed text-ink-body">
              This site has the biggest gap between its Lighthouse rank and its behavioral rank: the
              case where the static rubric gets it wrong.
            </p>
            <Link
              href={withAgent(`/site/${surprising.site.site_id}`, agentId)}
              className="block rounded-lg border border-line p-5 transition-colors hover:border-ink-muted hover:bg-surface-2"
            >
              <p className="mb-2 font-serif text-lg font-medium text-ink">{surprising.site.name}</p>
              <div className="space-y-1 text-sm text-ink-body">
                <p>
                  Lighthouse rank:{" "}
                  <span className="font-mono tabular-nums text-ink">#{surprising.lhRank + 1}</span>{" "}
                  (score: {surprising.site.lh_total})
                </p>
                <p>
                  Behavioral rank:{" "}
                  <span className="font-mono tabular-nums text-ink">
                    #{surprising.successRank + 1}
                  </span>{" "}
                  ({Math.round(surprising.site.success_rate * 100)}% success)
                </p>
                <p className="mt-3 font-medium text-ink underline decoration-line underline-offset-2">
                  View site detail →
                </p>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* One-liner finding */}
      <div className="card-emphasis mt-14">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-emphasis-muted">
          The finding
        </h2>
        <p className="text-[17px] font-medium leading-relaxed text-emphasis-ink">
          {rho === null || rhoCI === null ? (
            <>
              No finding yet. {n === 0 ? "No site" : `Only ${n} ${n === 1 ? "site" : "sites"}`} in
              this batch {n === 1 ? "has" : "have"} both a Lighthouse score and measured agent
              trials, so there is nothing to correlate; this page states the result once the lanes
              have run, and claims nothing before then.
            </>
          ) : relationshipVerdict(rhoCI) === "none" ? (
            <>
              On {n} sites, no relationship between Google&apos;s Agentic Browsing score and whether{" "}
              {agentLabel(measuredAgentId)} could complete a real task was distinguishable from noise
              (ρ&nbsp;=&nbsp;{formatR(rho)}, 95% CI&nbsp;{formatInterval(rhoCI)}). The interval spans
              zero: this cohort cannot separate the rubric&apos;s predictive power from none at all.
            </>
          ) : (
            <>
              On {n} sites, the Agentic Browsing score tracks behavioral success
              (ρ&nbsp;=&nbsp;{formatR(rho)}, 95% CI&nbsp;{formatInterval(rhoCI)}).
            </>
          )}
        </p>
        {subAudits.family !== null && rho !== null && (
          <p className="mt-4 text-sm leading-relaxed text-emphasis-body">
            Nor does any single audit rescue it: all {subAudits.family.size} sub-audit comparisons
            across both agents are{" "}
            {distinguishable === 0 ? "not distinguishable from noise" : "reported in full"}, and at{" "}
            {n} sites an audit needed a{" "}
            {Math.round(subAudits.family.criticalValue * 100)}-point success-rate gap to clear the
            bar, more than this cohort can physically produce on the narrowest split.{" "}
            <Link
              href={withAgent("/correlation/audits", agentId)}
              className="text-emphasis-link underline underline-offset-2"
            >
              The breakdown and its power analysis
            </Link>
            .
          </p>
        )}
      </div>

      {/* The constructive counterpart. A null says what could not be detected; a counterexample
          says what can be built. The two authored pages behind it are not cohort data and enter
          no number on this page — the link says so, and so does the page it leads to. */}
      <div className="mt-14 border-t border-line pt-8">
        <h2 className="section-title">And here is a page where they come apart by construction</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-body">
          Everything above is about what {n} sites could and could not detect. The other way to
          probe a rubric is to build a counterexample: two authored pages, identical down to the
          rendered pixels, both scoring {exhibitScore ?? "the same"} on the Agentic Browsing
          category, differing only in whether the rows outside a scroll box are placed in the
          document. The agent answers on every trial against one of them and on none against the
          other.
        </p>
        <p className="card-note max-w-3xl">
          Authored demonstration pages, not cohort sites. Their trials are their own batch, are
          never imported into the database this page reads, and are in no figure above.
        </p>
        <Link
          href={withAgent("/correlation/exhibit", agentId)}
          className="link-ink -mx-1 mt-4 inline-block px-1 py-1.5 text-sm font-medium text-ink"
        >
          The Goodhart exhibit →
        </Link>
      </div>
    </div>
  );
}
