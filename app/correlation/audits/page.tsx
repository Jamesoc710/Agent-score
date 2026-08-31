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
import IntervalBar, { PowerScale } from "@/components/IntervalBar";

// The shared gap scale, in percentage points. Every gap bar on this site uses it, so a
// width here is comparable to a width on /correlation.
const GAP_DOMAIN = { min: -80, max: 80 };

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
      <div className="mb-8">
        <Link href={withAgent("/correlation", agentId)} className="back-link">
          ← Correlation study
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="page-title max-w-3xl">Which sub-audit is doing the work?</h1>
        <p className="page-lead max-w-3xl">
          Google&apos;s Agentic Browsing score is built from individual pass/fail audits. Each one
          splits the cohort in two, so each one can be asked the same question the composite score
          was asked: do the sites that pass it complete more tasks?
        </p>
      </header>

      <ExploratoryBanner />

      {/* The spine of a long page. Plain anchors into sections that already exist, no sticky
          positioning and no JavaScript; it never precedes the banner. */}
      <nav
        aria-label="On this page"
        className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-y border-line py-3 text-[13px] text-ink-muted"
      >
        <a href="#headline" className="link-ink">Headline</a>
        <a href="#comparisons" className="link-ink">Every comparison</a>
        <a href="#power" className="link-ink">Power</a>
        <a href="#statistics" className="link-ink">Full statistics</a>
        <a href="#caveats" className="link-ink">Caveats</a>
        <a href="#method" className="link-ink">Method</a>
      </nav>

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
    <div className="card-notice">
      <p className="text-sm font-semibold text-notice-ink">
        This analysis was not pre-registered.
      </p>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-notice-body">
        <code className="rounded bg-notice-soft px-1 py-0.5 font-mono text-xs">
          docs/METHODOLOGY.md
        </code>{" "}
        pre-registers the task, the answer
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
    <section id="headline" className="mt-12">
      <p className="font-serif text-[1.375rem] font-medium leading-snug text-ink sm:text-[1.625rem]">
        {cleared.length === 0
          ? "No individual sub-audit is distinguishable from noise either."
          : `${cleared.length} of ${family.size} comparisons clears the family-wise level.`}
      </p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
        {cleared.length === 0 ? (
          <>
            All {family.size} comparisons ({AUDITS.length - 1} audits with a usable split, on{" "}
            {analysis.agents.length} agents, over the same {analysis.siteCount} sites) have a
            family-wise p above {family.level.toFixed(2)}. The largest gap measured is{" "}
            <span className="font-semibold text-ink">
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

      <div className="card-emphasis mt-5">
        <p className="text-sm leading-relaxed text-emphasis-body">
          At {analysis.siteCount} sites an audit had to buy a{" "}
          <span className="font-semibold text-emphasis-ink">
            {Math.round(family.criticalValue * 100)}-point
          </span>{" "}
          success-rate gap to clear the family-wise bar, and{" "}
          <span className="font-semibold text-emphasis-ink">
            {Math.round(reference.threshold80 * 100)} points
          </span>{" "}
          to have an 80% chance of clearing it. The largest gap this cohort can{" "}
          <em>physically produce</em> on a {reference.split.ones}-of-{analysis.siteCount} split is{" "}
          <span className="font-semibold text-emphasis-ink">
            {Math.round(reference.maxAttainableGap * 100)} points
          </span>
          , because the passing group cannot score above 100%.
        </p>

        {/* The same three numbers as the paragraph above, drawn to scale. The track stops at
            what this cohort can physically produce, so the 80%-power threshold stands past the
            end of it, which is the argument the sentence below makes in words. */}
        <PowerScale
          criticalValue={family.criticalValue * 100}
          maxAttainableGap={reference.maxAttainableGap * 100}
          threshold80={reference.threshold80 * 100}
        />

        <p className="mt-5 text-base font-semibold leading-snug text-emphasis-ink">
          {reference.detectableAt80
            ? "An audit of that shape was detectable here."
            : "An llms.txt-shaped audit could not have been detected here at 80% power, no matter how well it worked."}
        </p>
        <p className="mt-4 border-t border-emphasis-line pt-3 text-xs leading-relaxed text-emphasis-muted">
          Which is why nothing on this page says an audit &ldquo;does not work&rdquo;. A study that
          cannot reach the effect it is looking for has not measured an absence.
        </p>
      </div>
    </section>
  );
}

function ResultsTable({ analysis }: { analysis: SubAuditAnalysis }) {
  const critical = analysis.family!.criticalValue * 100;

  return (
    <section id="comparisons" className="mt-14 border-t border-line pt-8">
      <h2 className="section-title">Every comparison, including the flat ones</h2>
      <p className="card-note mb-6 max-w-3xl">
        Gap = mean site success rate among sites that pass the audit, minus the mean among sites
        that fail it, in percentage points. Ordered by Lighthouse audit id and never by effect
        size: sorting these rows by result would turn a ranking into a finding.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-line text-left align-bottom">
              <th className="eyebrow py-2 pr-3">Audit</th>
              <th className="eyebrow py-2 px-3">Split</th>
              <th className="eyebrow py-2 px-3 text-right">Gap (pts)</th>
              <th className="eyebrow py-2 px-3">95% CI</th>
              <th className="eyebrow min-w-[180px] py-2 px-3">
                Gap &amp; 95% CI
                {/* The scale, printed once. Every bar below shares it, so a width in one row
                    means the same thing as a width in another. */}
                <span className="mt-1.5 block font-mono text-[10px] font-normal normal-case tracking-normal">
                  <span className="flex justify-between tabular-nums">
                    <span>-80</span>
                    <span>-40</span>
                    <span>0</span>
                    <span>+40</span>
                    <span>+80</span>
                  </span>
                </span>
              </th>
              <th className="eyebrow py-2 px-3 text-right">
                Family-wise p<span className="normal-case"> (m = {analysis.family!.size})</span>
              </th>
              <th className="eyebrow py-2 pl-3">Verdict</th>
            </tr>
          </thead>
          {analysis.agents.map((agent) => (
            <tbody key={agent.agent_id}>
              <tr>
                <td colSpan={7} className="eyebrow pb-2 pt-6 text-ink-strong">
                  {agentLabel(agent.agent_id)} · {agent.siteCount} sites
                </td>
              </tr>
              {agent.rows.map((row) => (
                <ResultRow
                  key={row.key}
                  row={row}
                  siteCount={agent.siteCount}
                  critical={critical}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Dashed rules: ±{Math.round(critical)} pt family-wise critical value
      </p>
    </section>
  );
}

function ResultRow({
  row,
  siteCount,
  critical,
}: {
  row: AuditRow;
  siteCount: number;
  critical: number;
}) {
  const unfalsifiable = row.minimumAttainableP !== null && row.minimumAttainableP > ALPHA;

  return (
    <tr className="border-b border-line-soft align-top last:border-0">
      <td className="py-2.5 pr-3">
        <span className="font-medium text-ink">{row.label}</span>
        <span className="block font-mono text-xs text-ink-muted">{row.lighthouseId}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-ink-body">
        {row.groups.ones} pass / {row.groups.zeros} fail
      </td>
      {row.estimate === null ? (
        /* The plot column is inside this colSpan, so a row with no estimate renders no track
           at all. An empty track would read as a zero-width interval, which is a claim. */
        <td colSpan={5} className="px-3 py-2.5 leading-relaxed text-ink-body">
          <span className="font-semibold text-ink">
            {unfalsifiable ? "Unfalsifiable" : "Not reportable"}
          </span>
          : {row.groups.ones} of {siteCount} sites{" "}
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
          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
            {formatPoints(row.estimate.gap)}
          </td>
          <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-ink-muted">
            {formatPointsInterval(row.estimate.ci)}
          </td>
          <td className="px-3 py-2.5">
            <IntervalBar
              domain={GAP_DOMAIN}
              interval={{ lo: row.estimate.ci.lo * 100, hi: row.estimate.ci.hi * 100 }}
              point={row.estimate.gap * 100}
              zero
              refLines={[-critical, critical]}
            />
          </td>
          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
            {formatP(row.pFamilyWise!)}
          </td>
          <td className="py-2.5 pl-3">
            <span className="chip chip-neutral">not distinguishable from noise</span>
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
    <section id="power" className="mt-14 border-t border-line pt-8">
      <h2 className="section-title">What this cohort could have detected</h2>
      <p className="card-note mb-6 max-w-3xl">
        The family-wise critical value is a 50%-power threshold: the gap at which a study of this
        shape clears the bar half the time. It is not a minimum detectable effect, and reporting it
        as one understates a follow-up&apos;s sample size by a factor of 1.85.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="eyebrow py-2 pr-3">Agent</th>
              <th className="eyebrow py-2 px-3 text-right">Critical value</th>
              <th className="eyebrow py-2 px-3 text-right">Gap for 80% power</th>
              <th className="eyebrow py-2 px-3 text-right">Largest gap possible</th>
              <th className="eyebrow py-2 pl-3">Detectable?</th>
            </tr>
          </thead>
          <tbody>
            {power.map((report) => (
              <tr key={report.agent_id} className="border-b border-line-soft last:border-0">
                <td className="py-2.5 pr-3 font-medium text-ink">{agentLabel(report.agent_id)}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-body">
                  {formatPoints(report.criticalValue)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-body">
                  {formatPoints(report.threshold80)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink">
                  {formatPoints(report.maxAttainableGap)}
                </td>
                <td className="py-2.5 pl-3 text-ink-body">
                  {report.detectableAt80 ? "yes" : "no: the ceiling is below the threshold"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        The ceiling is arithmetic, not statistics: at{" "}
        {Math.round(power[0].overallRate * 100)}% overall success, pinning{" "}
        {power[0].split.ones} sites at 100% forces the other {power[0].split.zeros} down to{" "}
        {Math.round((power[0].overallRate * analysis.siteCount - power[0].split.ones) * 100 / power[0].split.zeros)}
        %. The cohort&apos;s own <span className="font-medium">tier = anchor</span> pseudo-audit hits
        that ceiling exactly.
      </p>

      <h3 className="mb-3 mt-10 font-serif text-lg font-medium text-ink">Sizing a study that could</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="eyebrow py-2 pr-3">True gap</th>
              <th className="eyebrow py-2 px-3">Audit prevalence</th>
              <th className="eyebrow py-2 px-3 text-right">Sites at 50% power</th>
              <th className="eyebrow py-2 pl-3 text-right">Sites at 80% power</th>
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
                  <tr key={`${gap}-${prevalence}`} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 pr-3 tabular-nums text-ink">
                      {Math.round(gap * 100)} points
                    </td>
                    <td className="px-3 py-2.5 text-ink-body">
                      {prevalence === 0.5
                        ? "balanced (50%)"
                        : `${Math.round(prevalence * 100)}% (v1's llms.txt rate)`}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                      {Math.ceil(at50.sites)}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono font-semibold tabular-nums text-ink">
                      {Math.ceil(at80.sites)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        And 80% power is still a floor. Simulating with this cohort&apos;s own outcome distribution
        (site rates drawn from the measured {analysis.siteCount}, the audit adding{" "}
        {Math.round(CALIBRATION.power.effect * 100)} points to a site&apos;s success probability
        capped at 100%, {CALIBRATION.power.trials} trials a site,{" "}
        {CALIBRATION.power.replicates.toLocaleString()} replicates) gives{" "}
        {CALIBRATION.power.designs
          .map((d) => `${Math.round(d.power * 100)}% power at n = ${d.sites}`)
          .join(" and ")}
        , not 50% and 80%. {analysis.power![0].sitesAtExtremes} of {analysis.siteCount} sites
        already sit at exactly 0% or 100%, where 30 extra points have nowhere to go: the realized
        gap averages {formatPoints(CALIBRATION.power.designs[0].meanGap)} points, not{" "}
        {Math.round(CALIBRATION.power.effect * 100)}.
      </p>
    </section>
  );
}

function FullStatistics({ analysis }: { analysis: SubAuditAnalysis }) {
  const family = analysis.family!;

  return (
    <details id="statistics" className="group mt-14 border-y border-line">
      <summary className="flex cursor-pointer select-none flex-wrap items-baseline gap-x-2 py-5 font-serif text-lg font-medium text-ink transition-colors hover:text-ink-strong">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Full statistics
        <span className="font-sans text-xs font-normal text-ink-muted group-open:hidden">
          simultaneous intervals, uncorrected p-values, calibration
        </span>
      </summary>

      <div className="space-y-10 pb-8">
        <div>
          <h3 className="mb-3 font-serif text-lg font-medium text-ink">Per comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow py-2 pr-3">Comparison</th>
                  <th className="eyebrow py-2 px-3 text-right">r</th>
                  <th className="eyebrow py-2 px-3">
                    Simultaneous CI ({((1 - ALPHA / family.size) * 100).toFixed(2)}%)
                  </th>
                  <th className="eyebrow py-2 px-3 text-right">p, uncorrected (exact)</th>
                  <th className="eyebrow py-2 px-3 text-right">p, uncorrected (10k perms)</th>
                  <th className="eyebrow py-2 px-3 text-right">p, Bonferroni</th>
                  <th className="eyebrow py-2 pl-3 text-right">p, family-wise</th>
                </tr>
              </thead>
              {analysis.agents.map((agent) => (
                <tbody key={agent.agent_id}>
                  <tr>
                    <td colSpan={7} className="eyebrow pb-1 pt-5 text-ink-strong">
                      {agentLabel(agent.agent_id)}
                    </td>
                  </tr>
                  {agent.rows.map((row) => (
                    <tr key={row.key} className="border-b border-line-soft last:border-0">
                      <td className="py-2 pr-3 text-ink">{row.label}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-body">
                        {row.estimate?.r != null ? formatR(row.estimate.r) : "–"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-ink-body">
                        {row.estimate ? formatPointsInterval(row.estimate.simultaneous) : "–"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-body">
                        {row.pExact === null ? "–" : formatP(row.pExact)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-body">
                        {row.pUnadjusted === null ? "–" : formatP(row.pUnadjusted)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-body">
                        {row.pBonferroni === null ? "–" : formatP(row.pBonferroni)}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-ink">
                        {row.pFamilyWise === null ? "–" : formatP(row.pFamilyWise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
            The two <span className="font-medium">uncorrected</span> columns are the same quantity
            computed two ways (by enumerating all C({analysis.siteCount}, k) splits, and by{" "}
            {family.iterations.toLocaleString()} random permutations), and neither accounts for the
            fact that {family.size} comparisons were looked at. They are shown so a reader who
            recomputes one of them can see it matched, not as results.
          </p>
        </div>

        <div>
          <h3 className="mb-3 font-serif text-lg font-medium text-ink">
            How often each procedure fires when nothing is there
          </h3>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
            Simulation against a true null, built by permuting this cohort&apos;s own outcome
            vector so the outcome distribution stays real and only the association is destroyed.{" "}
            {CALIBRATION.falsePositive.replicates.toLocaleString()} replicates per split, nominal
            level {CALIBRATION.falsePositive.level.toFixed(2)}. Anything either procedure reports
            here is a false positive by construction.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="eyebrow py-2 pr-3">Agent</th>
                  <th className="eyebrow py-2 px-3">Split</th>
                  <th className="eyebrow py-2 px-3 text-right">Bootstrap CI excludes zero</th>
                  <th className="eyebrow py-2 pl-3 text-right">Permutation p ≤ 0.05</th>
                </tr>
              </thead>
              <tbody>
                {analysis.agents.flatMap((agent) =>
                  (CALIBRATION.falsePositive.agents[agent.agent_id] ?? []).map((split) => (
                    <tr
                      key={`${agent.agent_id}-${split.ones}`}
                      className="border-b border-line-soft last:border-0"
                    >
                      <td className="py-2 pr-3 text-ink-body">{agentLabel(agent.agent_id)}</td>
                      <td className="px-3 py-2 tabular-nums text-ink-body">
                        {split.ones} / {split.zeros}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          split.bootstrap > 0.5 ? "font-semibold text-bad" : "text-ink-body"
                        }`}
                      >
                        {(split.bootstrap * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-ink-body">
                        {(split.permutation * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
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
          <h3 className="mb-3 font-serif text-lg font-medium text-ink">Reproducibility</h3>
          <ul className="space-y-1.5 text-xs leading-relaxed text-ink-muted">
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
    <section id="caveats" className="mt-14 border-t border-line pt-8">
      <h2 className="section-title mb-6">What would break this reading</h2>
      <div className="max-w-3xl space-y-7 text-sm leading-relaxed text-ink-body">
        <Caveat title="llms.txt is confounded with the cohort design, almost perfectly">
          <p>
            The {confound.passingSites.length} sites that ship llms.txt are{" "}
            {confound.passingSites.map((s) => s.name).join(", ")}.{" "}
            {confound.passingSites.filter((s) => s.tier === "anchor").length} of them are
            anchor-tier: the modern SaaS sites the cohort deliberately picked to score well on
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
              .join(" and ")}
            : a {confound.withinAnchor[0].groups.ones}-vs-{confound.withinAnchor[0].groups.zeros}{" "}
            split, so that is a description and not a test, by the same rule that refuses WebMCP.
            And for{" "}
            {confound.pseudoAudit
              .filter((p) => p.identicalToLlmsTxt)
              .map((p) => agentLabel(p.agent_id))
              .join(", ")}
            , the pseudo-audit <span className="font-mono text-xs">tier == anchor</span> and the
            real audit are <em>numerically identical</em> (same gap, same interval) because the
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
                <span className="font-semibold text-ink">
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
            <span className="font-mono">{formatP(unit.siteP)}</span>, a factor of{" "}
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
            permutation p <span className="font-mono">{formatP(pooledLlms.pExact)}</span>, the only
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
              behavioral measurement, and scoring that as 0% would be inventing one. Scoring it 0%
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
    </section>
  );
}

function Caveat({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line-soft pt-5">
      <h3 className="mb-2 text-base font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function NotEnoughData({ analysis }: { analysis: SubAuditAnalysis }) {
  return (
    <section className="mt-12">
      <p className="font-serif text-[1.375rem] font-medium leading-snug text-ink">
        No sub-audit has enough sites on both sides of its split.
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-body">
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
              <td className="py-1 pr-6 text-ink">{row.label}</td>
              <td className="py-1 tabular-nums text-ink-body">
                {row.groups.ones} pass / {row.groups.zeros} fail
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Method({ analysis, agentId }: { analysis: SubAuditAnalysis; agentId: string }) {
  const family = analysis.family;

  return (
    <section
      id="method"
      className="mt-14 space-y-3 rounded-lg border border-line bg-surface-2 p-5 text-xs leading-relaxed text-ink-body sm:p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">Method</h2>
      <p className="max-w-3xl">
        <span className="font-semibold text-ink">Estimand:</span> the difference in mean site
        success rate between the sites that pass an audit and the sites that fail it, in percentage
        points. The site is the unit of analysis, so the bootstrap resamples sites and the mean is
        a mean of site rates, not of trials.{" "}
        {analysis.trialsPerSite !== null
          ? "In this batch every measured site carries the same number of trials, so the two happen to be identical to every digit shown; that stops being true the first time a batch has a partially excluded site."
          : "Sites in this batch carry different numbers of trials, so the two differ: a mean of site rates weights every site equally, which is the intent."}
      </p>
      <p className="max-w-3xl">
        <span className="font-semibold text-ink">Inference:</span> a two-sided permutation test
        on |gap|, which is assumption-free and exact under exchangeability. Multiplicity is handled
        by a single-step max-statistic over the whole family: one permutation of the site index
        applied to every comparison at once, preserving the correlation between overlapping audits
        and between agents measured on the same sites. Bonferroni is reported alongside because a
        reader can check it by hand.{" "}
        {family && (
          <>
            The family is every audit with a usable split on every published agent: m ={" "}
            {family.size}. A verdict on this page follows the family-wise p and nothing else:
            never the point estimate, never the marginal interval.
          </>
        )}
      </p>
      <p className="max-w-3xl">
        <span className="font-semibold text-ink">Denominators:</span> n ={" "}
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
        <span className="font-semibold text-ink">WebMCP adoption:</span>{" "}
        {analysis.cohort.passing.lh_webmcp} of {analysis.cohort.siteCount} sites in this batch pass{" "}
        <span className="font-mono">webmcp-registered-tools</span>, counted over the whole cohort,
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
            No site passes it here, which is not by itself evidence either way about adoption: the
            methodology record flags an all-zero column in an earlier draft batch as possibly a
            broken audit id, and a batch this small cannot separate the two.
          </>
        )}
      </p>
      <p>
        <Link
          href={withAgent("/correlation", agentId)}
          className="link-ink -mx-1 inline-block px-1 py-1.5 font-medium text-ink"
        >
          ← Back to the composite result
        </Link>
      </p>
    </section>
  );
}
