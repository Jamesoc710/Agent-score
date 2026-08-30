import Link from "next/link";
import { getPanelAuditPoints } from "@/lib/queries";
import {
  ALPHA,
  AUDITS,
  CALIBRATION,
  analyzeSubAudits,
  type AuditRow,
  type SubAuditAnalysis,
} from "@/lib/sub-audits";
import { MIN_GROUP, formatInterval, formatR } from "@/lib/stats";
import { agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatP, formatPoints, formatPointsInterval, formatSmallP } from "@/lib/format";

// Rendered per request, like every other page: results change when a batch is imported.
export const dynamic = "force-dynamic";

export default async function SubAuditPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  // The analysis spans the whole published panel, so there is no agent toggle here — rendering
  // three of six comparisons at a time would misrepresent the family the correction covers.
  // The parameter is still honoured so a back-link returns you where you came from.
  const agentId = resolveAgentId(searchParams.agent);
  const panel = await getPanelAuditPoints();
  const analysis = analyzeSubAudits(panel);

  return (
    <div>
      <div className="mb-6">
        <Link
          href={withAgent("/correlation", agentId)}
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          ← Correlation study
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Which sub-audit is doing the work?
        </h1>
        <p className="text-slate-500 max-w-2xl">
          Google&apos;s Agentic Browsing score is built from individual pass/fail audits. Each one
          splits the cohort in two, so each one can be asked the same question the composite score
          was asked: do the sites that pass it complete more tasks?
        </p>
      </div>

      <ExploratoryBanner />

      {analysis.family === null ? (
        <NotEnoughData analysis={analysis} />
      ) : (
        <>
          <Headline analysis={analysis} />
          <ResultsTable analysis={analysis} />
          <PowerCard analysis={analysis} />
          <FullStatistics analysis={analysis} />
          <Caveats analysis={analysis} />
        </>
      )}

      <Method analysis={analysis} agentId={agentId} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExploratoryBanner() {
  return (
    <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <p className="text-sm font-semibold text-amber-900">This analysis was not pre-registered.</p>
      <p className="text-sm text-amber-800 mt-1 max-w-3xl">
        <code className="text-xs">docs/METHODOLOGY.md</code> pre-registers the task, the answer
        keys, the match rules and the trial protocol. It does not pre-register this comparison.
        Everything below is exploratory: a set of comparisons with intervals, not a finding. The
        honest use for it is to design the study that would test it.
      </p>
    </div>
  );
}

function Headline({ analysis }: { analysis: SubAuditAnalysis }) {
  const family = analysis.family!;
  const cleared = family.comparisons.filter((c) => c.pFamilyWise <= family.level);
  const power = analysis.power!;
  const reference = power[0];
  const largest = analysis.agents
    .flatMap((a) => a.rows.map((row) => ({ agent_id: a.agent_id, row })))
    .filter((entry) => entry.row.estimate !== null)
    .sort((a, b) => Math.abs(b.row.estimate!.gap) - Math.abs(a.row.estimate!.gap))[0];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <p className="text-xl font-semibold text-slate-900">
        {cleared.length === 0
          ? "No individual sub-audit is distinguishable from noise either."
          : `${cleared.length} of ${family.size} comparisons clears the family-wise level.`}
      </p>
      <p className="text-sm text-slate-600 mt-3 max-w-3xl">
        {cleared.length === 0 ? (
          <>
            All {family.size} comparisons — {AUDITS.length - 1} audits with a usable split, on{" "}
            {analysis.agents.length} agents, over the same {analysis.siteCount} sites — have a
            family-wise p above {family.level.toFixed(2)}. The largest gap measured is{" "}
            <span className="font-medium text-slate-900">
              {formatPoints(largest.row.estimate!.gap)} points
            </span>{" "}
            ({largest.row.label}, {agentLabel(largest.agent_id)}), at a family-wise p of{" "}
            {formatP(largest.row.pFamilyWise!)}.
          </>
        ) : (
          <>
            {cleared.map((c) => c.key).join(", ")} clears a family-wise level of{" "}
            {family.level.toFixed(2)} across {family.size} comparisons.
          </>
        )}
      </p>

      <div className="mt-4 rounded-lg bg-slate-900 p-5 text-slate-100">
        <p className="text-sm leading-relaxed">
          At {analysis.siteCount} sites an audit had to buy a{" "}
          <span className="font-semibold text-white">
            {Math.round(family.criticalValue * 100)}-point
          </span>{" "}
          success-rate gap to clear the family-wise bar, and{" "}
          <span className="font-semibold text-white">
            {Math.round(reference.threshold80 * 100)} points
          </span>{" "}
          to have an 80% chance of clearing it. The largest gap this cohort can{" "}
          <em>physically produce</em> on a {reference.split.ones}-of-{analysis.siteCount} split is{" "}
          <span className="font-semibold text-white">
            {Math.round(reference.maxAttainableGap * 100)} points
          </span>
          , because the passing group cannot score above 100%.
        </p>
        <p className="text-base font-semibold text-white mt-3">
          {reference.detectableAt80
            ? "An audit of that shape was detectable here."
            : "An llms.txt-shaped audit could not have been detected here at 80% power, no matter how well it worked."}
        </p>
        <p className="text-xs text-slate-400 mt-3">
          Which is why nothing on this page says an audit &ldquo;does not work&rdquo;. A study that
          cannot reach the effect it is looking for has not measured an absence.
        </p>
      </div>
    </div>
  );
}

function ResultsTable({ analysis }: { analysis: SubAuditAnalysis }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 className="font-semibold text-slate-900 mb-1">Every comparison, including the flat ones</h2>
      <p className="text-xs text-slate-400 mb-4 max-w-3xl">
        Gap = mean site success rate among sites that pass the audit, minus the mean among sites
        that fail it, in percentage points. Ordered by Lighthouse audit id and never by effect
        size: sorting these rows by result would turn a ranking into a finding.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">Audit</th>
              <th className="py-2 px-3 font-medium">Split</th>
              <th className="py-2 px-3 font-medium text-right">Gap (pts)</th>
              <th className="py-2 px-3 font-medium">95% CI</th>
              <th className="py-2 px-3 font-medium text-right">
                Family-wise p<span className="normal-case"> (m = {analysis.family!.size})</span>
              </th>
              <th className="py-2 pl-3 font-medium">Verdict</th>
            </tr>
          </thead>
          {analysis.agents.map((agent) => (
            <tbody key={agent.agent_id}>
              <tr>
                <td
                  colSpan={6}
                  className="pt-5 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {agentLabel(agent.agent_id)} · {agent.siteCount} sites
                </td>
              </tr>
              {agent.rows.map((row) => (
                <ResultRow key={row.key} row={row} siteCount={agent.siteCount} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function ResultRow({ row, siteCount }: { row: AuditRow; siteCount: number }) {
  const unfalsifiable = row.minimumAttainableP !== null && row.minimumAttainableP > ALPHA;

  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <td className="py-2 pr-3">
        <span className="font-medium text-slate-800">{row.label}</span>
        <span className="block text-xs text-slate-400 font-mono">{row.lighthouseId}</span>
      </td>
      <td className="py-2 px-3 text-slate-600 tabular-nums whitespace-nowrap">
        {row.groups.ones} pass / {row.groups.zeros} fail
      </td>
      {row.estimate === null ? (
        <td colSpan={4} className="py-2 px-3 text-slate-500">
          <span className="font-medium text-slate-600">
            {unfalsifiable ? "Unfalsifiable" : "Not reportable"}
          </span>{" "}
          — {row.groups.ones} of {siteCount} sites{" "}
          {row.groups.ones === 1 ? "passes" : "pass"}
          {unfalsifiable && (
            <>
              , and the smallest p <em>any</em> arrangement of that split could have produced is{" "}
              <span className="tabular-nums">{formatP(row.minimumAttainableP!)}</span>. No outcome
              could have cleared the bar, so nothing is reported: not an interval, not a p
            </>
          )}
          {!unfalsifiable && (
            <>
              , fewer than the {MIN_GROUP} this analysis will estimate a difference from
            </>
          )}
          .
        </td>
      ) : (
        <>
          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
            {formatPoints(row.estimate.gap)}
          </td>
          <td className="py-2 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
            {formatPointsInterval(row.estimate.ci)}
          </td>
          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
            {formatP(row.pFamilyWise!)}
          </td>
          <td className="py-2 pl-3">
            <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 whitespace-nowrap">
              not distinguishable from noise
            </span>
          </td>
        </>
      )}
    </tr>
  );
}

function PowerCard({ analysis }: { analysis: SubAuditAnalysis }) {
  const power = analysis.power!;
  const sizing = analysis.sizing!;
  const naturalPrevalence = sizing.find((r) => r.prevalence !== 0.5)!.prevalence;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 className="font-semibold text-slate-900 mb-1">What this cohort could have detected</h2>
      <p className="text-xs text-slate-400 mb-4 max-w-3xl">
        The family-wise critical value is a 50%-power threshold — the gap at which a study of this
        shape clears the bar half the time. It is not a minimum detectable effect, and reporting it
        as one understates a follow-up&apos;s sample size by a factor of 1.85.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">Agent</th>
              <th className="py-2 px-3 font-medium text-right">Critical value</th>
              <th className="py-2 px-3 font-medium text-right">Gap for 80% power</th>
              <th className="py-2 px-3 font-medium text-right">Largest gap possible</th>
              <th className="py-2 pl-3 font-medium">Detectable?</th>
            </tr>
          </thead>
          <tbody>
            {power.map((report) => (
              <tr key={report.agent_id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 text-slate-700">{agentLabel(report.agent_id)}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                  {formatPoints(report.criticalValue)}
                </td>
                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                  {formatPoints(report.threshold80)}
                </td>
                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
                  {formatPoints(report.maxAttainableGap)}
                </td>
                <td className="py-2 pl-3 text-slate-600">
                  {report.detectableAt80 ? "yes" : "no — the ceiling is below the threshold"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 mt-4 max-w-3xl">
        The ceiling is arithmetic, not statistics: at{" "}
        {Math.round(power[0].overallRate * 100)}% overall success, pinning{" "}
        {power[0].split.ones} sites at 100% forces the other {power[0].split.zeros} down to{" "}
        {Math.round((power[0].overallRate * analysis.siteCount - power[0].split.ones) * 100 / power[0].split.zeros)}
        %. The cohort&apos;s own <span className="font-medium">tier = anchor</span> pseudo-audit hits
        that ceiling exactly.
      </p>

      <h3 className="font-medium text-slate-800 mt-6 mb-1 text-sm">Sizing a study that could</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">True gap</th>
              <th className="py-2 px-3 font-medium">Audit prevalence</th>
              <th className="py-2 px-3 font-medium text-right">Sites at 50% power</th>
              <th className="py-2 pl-3 font-medium text-right">Sites at 80% power</th>
            </tr>
          </thead>
          <tbody>
            {[0.3, 0.2].flatMap((gap) =>
              [0.5, naturalPrevalence].map((prevalence) => {
                const at50 = sizing.find(
                  (r) => r.gap === gap && r.prevalence === prevalence && r.power === 0.5
                )!;
                const at80 = sizing.find(
                  (r) => r.gap === gap && r.prevalence === prevalence && r.power === 0.8
                )!;
                return (
                  <tr key={`${gap}-${prevalence}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 text-slate-700 tabular-nums">
                      {Math.round(gap * 100)} points
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {prevalence === 0.5
                        ? "balanced (50%)"
                        : `${Math.round(prevalence * 100)}% — v1's llms.txt rate`}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                      {Math.ceil(at50.sites)}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono tabular-nums text-slate-900 font-semibold">
                      {Math.ceil(at80.sites)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-3 max-w-3xl">
        And 80% power is still a floor. Simulating with this cohort&apos;s own outcome distribution
        — site rates drawn from the measured {analysis.siteCount}, the audit adding{" "}
        {Math.round(CALIBRATION.power.effect * 100)} points to a site&apos;s success probability
        capped at 100%, {CALIBRATION.power.trials} trials a site,{" "}
        {CALIBRATION.power.replicates.toLocaleString()} replicates — gives{" "}
        {CALIBRATION.power.designs
          .map((d) => `${Math.round(d.power * 100)}% power at n = ${d.sites}`)
          .join(" and ")}
        , not 50% and 80%. {analysis.power![0].sitesAtExtremes} of {analysis.siteCount} sites
        already sit at exactly 0% or 100%, where 30 extra points have nowhere to go: the realized
        gap averages {formatPoints(CALIBRATION.power.designs[0].meanGap)} points, not{" "}
        {Math.round(CALIBRATION.power.effect * 100)}.
      </p>
    </div>
  );
}

function FullStatistics({ analysis }: { analysis: SubAuditAnalysis }) {
  const family = analysis.family!;

  return (
    <details className="bg-white rounded-xl border border-slate-200 mb-6 group">
      <summary className="cursor-pointer select-none p-5 font-semibold text-slate-900">
        Full statistics
        <span className="ml-2 text-xs font-normal text-slate-400 group-open:hidden">
          simultaneous intervals, uncorrected p-values, calibration
        </span>
      </summary>

      <div className="px-5 pb-5 space-y-6">
        <div>
          <h3 className="text-sm font-medium text-slate-800 mb-2">Per comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="text-left uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Comparison</th>
                  <th className="py-2 px-3 font-medium text-right">r</th>
                  <th className="py-2 px-3 font-medium">
                    Simultaneous CI ({((1 - ALPHA / family.size) * 100).toFixed(2)}%)
                  </th>
                  <th className="py-2 px-3 font-medium text-right">p, uncorrected (exact)</th>
                  <th className="py-2 px-3 font-medium text-right">p, uncorrected (10k perms)</th>
                  <th className="py-2 px-3 font-medium text-right">p, Bonferroni</th>
                  <th className="py-2 pl-3 font-medium text-right">p, family-wise</th>
                </tr>
              </thead>
              {analysis.agents.map((agent) => (
                <tbody key={agent.agent_id}>
                  <tr>
                    <td colSpan={7} className="pt-4 pb-1 font-semibold text-slate-500">
                      {agentLabel(agent.agent_id)}
                    </td>
                  </tr>
                  {agent.rows.map((row) => (
                    <tr key={row.key} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 text-slate-700">{row.label}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.estimate?.r != null ? formatR(row.estimate.r) : "—"}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {row.estimate ? formatPointsInterval(row.estimate.simultaneous) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.pExact === null ? "—" : formatP(row.pExact)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.pUnadjusted === null ? "—" : formatP(row.pUnadjusted)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.pBonferroni === null ? "—" : formatP(row.pBonferroni)}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-slate-800">
                        {row.pFamilyWise === null ? "—" : formatP(row.pFamilyWise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-2 max-w-3xl">
            The two <span className="font-medium">uncorrected</span> columns are the same quantity
            computed two ways — by enumerating all C({analysis.siteCount}, k) splits, and by{" "}
            {family.iterations.toLocaleString()} random permutations — and neither accounts for the
            fact that {family.size} comparisons were looked at. They are shown so a reader who
            recomputes one of them can see it matched, not as results.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-slate-800 mb-2">
            How often each procedure fires when nothing is there
          </h3>
          <p className="text-xs text-slate-500 mb-3 max-w-3xl">
            Simulation against a true null, built by permuting this cohort&apos;s own outcome
            vector so the outcome distribution stays real and only the association is destroyed.{" "}
            {CALIBRATION.falsePositive.replicates.toLocaleString()} replicates per split, nominal
            level {CALIBRATION.falsePositive.level.toFixed(2)}. Anything either procedure reports
            here is a false positive by construction.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-left uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 px-3 font-medium">Split</th>
                  <th className="py-2 px-3 font-medium text-right">Bootstrap CI excludes zero</th>
                  <th className="py-2 pl-3 font-medium text-right">Permutation p ≤ 0.05</th>
                </tr>
              </thead>
              <tbody>
                {analysis.agents.flatMap((agent) =>
                  (CALIBRATION.falsePositive.agents[agent.agent_id] ?? []).map((split) => (
                    <tr
                      key={`${agent.agent_id}-${split.ones}`}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-2 pr-3 text-slate-600">{agentLabel(agent.agent_id)}</td>
                      <td className="py-2 px-3 text-slate-600 tabular-nums">
                        {split.ones} / {split.zeros}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          split.bootstrap > 0.5 ? "text-rose-600 font-semibold" : "text-slate-700"
                        }`}
                      >
                        {(split.bootstrap * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-slate-700">
                        {(split.permutation * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2 max-w-3xl">
            The bottom rows are why the estimator itself refuses a split with fewer than{" "}
            {MIN_GROUP} sites on one side, rather than merely hiding it: a procedure that reports a
            finding nine times out of ten under a true null is not something to leave switched on.
            The {CALIBRATION.falsePositive.iterations.toLocaleString()}-iteration bootstrap used
            inside this simulation is smaller than the{" "}
            {analysis.family!.iterations.toLocaleString()} used for the published intervals; the
            rate does not depend on it.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-slate-800 mb-2">Reproducibility</h3>
          <ul className="text-xs text-slate-500 space-y-1">
            <li>
              Seed <span className="font-mono">{family.seed}</span>, mulberry32, shared by every
              bootstrap and permutation on this page.
            </li>
            <li>
              Bootstrap: {family.iterations.toLocaleString()} resamples of sites; resamples with no
              computable statistic are discarded, not replaced with zero.
            </li>
            <li>
              Permutation: {family.used.toLocaleString()} of{" "}
              {family.iterations.toLocaleString()} iterations usable; p ={" "}
              <span className="font-mono">(count + 1) / (used + 1)</span>, so a p is never reported
              as exactly zero.
            </li>
            <li>
              Family-wise correction: Westfall–Young maxT, one shuffle applied to all{" "}
              {family.size} comparisons at once, so the correlation between audits and between
              agents is preserved rather than assumed away.
            </li>
            <li>
              Cross-checked against an independent Python implementation
              (<span className="font-mono">scripts/stats_reference.py</span>); the values both must
              produce are pinned in <span className="font-mono">scripts/tests/stats-vectors.json</span>.
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
}

function Caveats({ analysis }: { analysis: SubAuditAnalysis }) {
  const confound = analysis.confound!;
  const stratified = confound.stratified.comparisons;
  const pooled = analysis.pooled!;
  const pooledLlms = pooled.rows.find((r) => r.key === "lh_llms_txt")!;
  const unit = analysis.unitOfAnalysis!.find((r) => r.key === "lh_llms_txt")!;
  const marginal = analysis.agents
    .flatMap((a) => a.rows.map((row) => ({ agent_id: a.agent_id, row })))
    .find(
      (entry) =>
        entry.row.estimate !== null &&
        (entry.row.estimate.ci.lo > 0 || entry.row.estimate.ci.hi < 0)
    );
  const calibrationForMarginal = marginal
    ? CALIBRATION.falsePositive.agents[marginal.agent_id]?.find(
        (s) => s.ones === marginal.row.groups.ones
      )
    : undefined;
  const sensitivity = analysis.exclusionSensitivity?.find((r) => r.key === "lh_llms_txt");

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 className="font-semibold text-slate-900 mb-4">What would break this reading</h2>
      <div className="space-y-5 text-sm text-slate-600 max-w-3xl">
        <Caveat title="llms.txt is confounded with the cohort design, almost perfectly">
          <p>
            The {confound.passingSites.length} sites that ship llms.txt are{" "}
            {confound.passingSites.map((s) => s.name).join(", ")}.{" "}
            {confound.passingSites.filter((s) => s.tier === "anchor").length} of them are
            anchor-tier — the modern SaaS sites the cohort deliberately picked to score well on
            both axes. There is exactly one anchor without the file (
            {confound.anchorsWithout.join(", ")}) and one non-anchor with it.
          </p>
          <p className="mt-2">
            So the design is tested directly: permuting the audit label{" "}
            <em>within tier</em> holds the tier composition fixed and asks what the file buys on
            top of it. Nothing.{" "}
            {stratified
              .filter((c) => c.key.endsWith("lh_llms_txt"))
              .map(
                (c) =>
                  `${agentLabel(c.key.split("|")[0])} ${formatP(c.pUnadjusted)}`
              )
              .join(", ")}{" "}
            stratified, against{" "}
            {analysis.agents
              .map((a) => {
                const row = a.rows.find((r) => r.key === "lh_llms_txt")!;
                return `${formatP(row.pUnadjusted!)}`;
              })
              .join(" and ")}{" "}
            unstratified (both uncorrected).
          </p>
          <p className="mt-2">
            Inside the anchor tier itself the gap is{" "}
            {confound.withinAnchor
              .map((w) => `${formatPoints(w.gap ?? 0)} (${agentLabel(w.agent_id)})`)
              .join(" and ")}{" "}
            — a {confound.withinAnchor[0].groups.ones}-vs-{confound.withinAnchor[0].groups.zeros}{" "}
            split, so that is a description and not a test, by the same rule that refuses WebMCP.
            And for{" "}
            {confound.pseudoAudit
              .filter((p) => p.identicalToLlmsTxt)
              .map((p) => agentLabel(p.agent_id))
              .join(", ")}
            , the pseudo-audit <span className="font-mono text-xs">tier == anchor</span> and the
            real audit are <em>numerically identical</em> — same gap, same interval — because the
            two site sets differ only by a swap of two sites that both scored 100%. For that agent
            the cohort cannot tell the file from the tier, because they are the same variable.
          </p>
        </Caveat>

        {marginal && (
          <Caveat title="One marginal interval excludes zero. The wording does not follow it">
            <p>
              {agentLabel(marginal.agent_id)} · {marginal.row.label} has a 95% interval of{" "}
              <span className="font-mono">{formatPointsInterval(marginal.row.estimate!.ci)}</span>{" "}
              points, which excludes zero, while its family-wise p is{" "}
              {formatP(marginal.row.pFamilyWise!)} and its simultaneous interval{" "}
              <span className="font-mono">
                {formatPointsInterval(marginal.row.estimate!.simultaneous)}
              </span>{" "}
              spans it. Hiding the interval would be the dishonest option, so here it is with the
              reason the page follows the test instead.
            </p>
            {calibrationForMarginal && (
              <p className="mt-2">
                The percentile bootstrap is anti-conservative on this exact split, and by a
                measured amount: on a {marginal.row.groups.ones}-vs-{marginal.row.groups.zeros}{" "}
                split of this agent&apos;s outcomes it excludes zero{" "}
                <span className="font-medium text-slate-900">
                  {(calibrationForMarginal.bootstrap * 100).toFixed(1)}% of the time when nothing
                  is there
                </span>
                , against a nominal 5%. The permutation test is exact under the null.
              </p>
            )}
          </Caveat>
        )}

        <Caveat title="Counting trials instead of sites would produce an eight-sigma result">
          <p>
            {unit.successesPass}/{unit.trialsPass} trials succeeded on the llms.txt sites against{" "}
            {unit.successesFail}/{unit.trialsFail} without it. Treat the trial as the unit of
            analysis and a two-proportion z test returns{" "}
            <span className="font-mono">z = {unit.trialZ.toFixed(2)}</span>,{" "}
            <span className="font-mono">p = {formatSmallP(unit.trialP)}</span>. The site-level exact
            permutation p on the same rows is{" "}
            <span className="font-mono">{formatP(unit.siteP)}</span> — a factor of{" "}
            {Math.round(unit.ratio).toLocaleString()}.
          </p>
          <p className="mt-2">
            Five trials on one website are not five independent websites. The site is the unit of
            analysis here, everywhere, including inside the bootstrap.
          </p>
        </Caveat>

        <Caveat title="Pooling the two agents manufactures the one significant number">
          <p>
            Averaging each site&apos;s two agent rates gives an llms.txt gap of{" "}
            <span className="font-mono">{formatPoints(pooledLlms.gap)}</span> points, 95% CI{" "}
            <span className="font-mono">{formatPointsInterval(pooledLlms.ci!)}</span>, exact
            permutation p <span className="font-mono">{formatP(pooledLlms.pExact)}</span> — the only
            sub-0.05 number anywhere in this analysis. It is stated here rather than published,
            because anyone who pools the frozen artifacts will find it.
          </p>
          <p className="mt-2">
            The reason it is not the headline: it is produced by averaging away a real
            disagreement. Rank correlation between the two agents across the same{" "}
            {analysis.siteCount} sites is only{" "}
            <span className="font-mono">{formatR(pooled.betweenAgentSpearman!)}</span>, and{" "}
            {pooled.flipped.length} sites move by 60 points or more{" "}
            <em>in both directions</em> ({pooled.flipped.map((f) => f.name).join(", ")}). A pooled
            mean is a third number that describes neither agent.
          </p>
        </Caveat>

        {sensitivity && (
          <Caveat title="The excluded site does not carry the result">
            <p>
              {analysis.excludedSiteIds.join(", ")} is excluded from every estimate: every one of
              its trials was rejected at the connection and never reached the site, so it has no
              behavioral measurement — and scoring that as 0% would be inventing one. Scoring it 0%
              anyway, at n = {analysis.siteCount + analysis.excludedSiteIds.length}, moves the
              pooled llms.txt gap from{" "}
              <span className="font-mono">{formatPoints(sensitivity.excludedGap)}</span> to{" "}
              <span className="font-mono">{formatPoints(sensitivity.includedGap)}</span> points and
              its exact p from <span className="font-mono">{formatP(sensitivity.excludedP)}</span>{" "}
              to <span className="font-mono">{formatP(sensitivity.includedP)}</span>. Nothing
              changes qualitatively, and the change runs against the exclusion being self-serving:
              including it makes the result look slightly stronger.
            </p>
          </Caveat>
        )}

        <Caveat title="A site's own success rate is noisy, and the bootstrap does not model it">
          <p>
            Each site rate comes from 5 trials, so a site sitting at a true 50% has a standard
            error of about 22 points on its own. The bootstrap resamples sites, which is the right
            unit, but it treats each site&apos;s measured rate as fixed. More trials per site would
            tighten every interval on this page without adding a single site.
          </p>
        </Caveat>
      </div>
    </div>
  );
}

function Caveat({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-slate-200 pl-4">
      <h3 className="font-medium text-slate-900 mb-1">{title}</h3>
      {children}
    </div>
  );
}

function NotEnoughData({ analysis }: { analysis: SubAuditAnalysis }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <p className="text-lg font-medium text-slate-900">
        No sub-audit has enough sites on both sides of its split.
      </p>
      <p className="text-sm text-slate-500 mt-2 max-w-2xl">
        This analysis compares the sites that pass an audit with the sites that fail it, and needs
        at least {MIN_GROUP} on each side before it will estimate a difference. Across the{" "}
        {analysis.siteCount} measured {analysis.siteCount === 1 ? "site" : "sites"} in this batch,
        none of the {AUDITS.length} audits clears that. There is nothing to correct for multiple
        testing, and no critical value to report, because there are no comparisons.
      </p>
      <table className="mt-5 text-sm">
        <tbody>
          {(analysis.agents[0]?.rows ?? []).map((row) => (
            <tr key={row.key}>
              <td className="pr-6 py-1 text-slate-700">{row.label}</td>
              <td className="py-1 text-slate-500 tabular-nums">
                {row.groups.ones} pass / {row.groups.zeros} fail
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Method({ analysis, agentId }: { analysis: SubAuditAnalysis; agentId: string }) {
  const family = analysis.family;

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 text-xs text-slate-500 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Method</h2>
      <p className="max-w-3xl">
        <span className="font-medium text-slate-700">Estimand:</span> the difference in mean site
        success rate between the sites that pass an audit and the sites that fail it, in percentage
        points. The site is the unit of analysis, so the bootstrap resamples sites and the mean is
        a mean of site rates, not of trials.{" "}
        {analysis.trialsPerSite !== null
          ? "In this batch every measured site carries the same number of trials, so the two happen to be identical to every digit shown — that stops being true the first time a batch has a partially excluded site."
          : "Sites in this batch carry different numbers of trials, so the two differ: a mean of site rates weights every site equally, which is the intent."}
      </p>
      <p className="max-w-3xl">
        <span className="font-medium text-slate-700">Inference:</span> a two-sided permutation test
        on |gap|, which is assumption-free and exact under exchangeability. Multiplicity is handled
        by a single-step max-statistic over the whole family: one permutation of the site index
        applied to every comparison at once, preserving the correlation between overlapping audits
        and between agents measured on the same sites. Bonferroni is reported alongside because a
        reader can check it by hand.{" "}
        {family && (
          <>
            The family is every audit with a usable split on every published agent: m ={" "}
            {family.size}. A verdict on this page follows the family-wise p and nothing else —
            never the point estimate, never the marginal interval.
          </>
        )}
      </p>
      <p className="max-w-3xl">
        <span className="font-medium text-slate-700">Denominators:</span> n ={" "}
        {analysis.siteCount} sites with both a Lighthouse score and at least one measured trial.
        {analysis.excludedSiteIds.length > 0 && (
          <>
            {" "}
            {analysis.excludedSiteIds.join(", ")}{" "}
            {analysis.excludedSiteIds.length === 1 ? "is" : "are"} excluded: every trial was
            rejected at the connection and never reached the site, which is an absence of
            measurement rather than a 0% success rate.
          </>
        )}{" "}
        Trials per site: {analysis.trialsPerSite ?? "mixed"}.
      </p>
      <p className="max-w-3xl">
        <span className="font-medium text-slate-700">WebMCP adoption:</span>{" "}
        {analysis.cohort.passing.lh_webmcp} of {analysis.cohort.siteCount} sites in this batch pass{" "}
        <span className="font-mono">webmcp-registered-tools</span> — counted over the whole cohort,
        including sites with no behavioral measurement, because adoption is a property of the site
        rather than of the trial.{" "}
        {analysis.cohort.passing.lh_webmcp > 0 ? (
          <>
            That resolves an open question in the methodology record, which flagged an all-zero
            column in an earlier draft batch as possibly a broken audit id: the id is live, and a
            single-digit pass count across major sites is an adoption finding rather than a harness
            fault. It is still not enough sites to test anything.
          </>
        ) : (
          <>
            No site passes it here, which is not by itself evidence either way about adoption — the
            methodology record flags an all-zero column in an earlier draft batch as possibly a
            broken audit id, and a batch this small cannot separate the two.
          </>
        )}
      </p>
      <p>
        <Link
          href={withAgent("/correlation", agentId)}
          className="text-sky-600 hover:underline font-medium"
        >
          ← Back to the composite result
        </Link>
      </p>
    </div>
  );
}
