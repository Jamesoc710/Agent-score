import Link from "next/link";
import { getPublishedDataset, toCorrelationPoints } from "@/lib/queries";
import { FailureMode, SiteLeaderboardEntry } from "@/lib/types";
import { TierBadge, FlagBadge } from "@/components/SiteBadges";
import AgentToggle from "@/components/AgentToggle";
import IntervalBar from "@/components/IntervalBar";
import GoodhartCard from "@/components/GoodhartCard";
import EditionMismatch from "@/components/EditionMismatch";
import SensitivityLine from "@/components/SensitivityLine";
import DatasetJsonLd from "@/components/DatasetJsonLd";
import { PUBLISHED_AGENTS, agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { EDITION, editionMatches } from "@/lib/edition-data";
import { formatDate, formatPercent, formatPoints, formatPointsInterval, formatRunWindow } from "@/lib/format";
import { FAILURE_MODE_BADGES, auditStatesOf, v1AuditLines } from "@/lib/labels";
import packageJson from "@/package.json";
import {
  bootstrapCI,
  formatInterval,
  formatR,
  relationshipVerdict,
  spearmanRho,
  type Pair,
} from "@/lib/stats";

// One fill at every value. The bar and the percentage are the same measurement twice, and the
// old three-tone version graded a site pass/warn/fail against thresholds this study never
// registered: an editorial verdict wearing the clothes of a measurement.
function SuccessBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line-soft">
        <div className="h-full rounded-full bg-good-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">{pct}%</span>
    </div>
  );
}

// A bare number. Tinting it green or red would endorse a grade this site's own headline result
// says the cohort cannot support.
function LhScore({ score }: { score: number | null }) {
  if (score === null) return <span className="font-mono text-[13px] text-ink-muted">–</span>;
  return <span className="font-mono text-[13px] tabular-nums text-ink">{score}</span>;
}

function FailureBadge({ mode }: { mode: FailureMode }) {
  if (mode === "success") return <span className="chip chip-good">{FAILURE_MODE_BADGES.success}</span>;
  return <span className="chip chip-neutral">{FAILURE_MODE_BADGES[mode] ?? mode}</span>;
}

// Two different absences, and conflating them would misreport both: a site the agent
// attempted but never reached has no measurement (and a trial log explaining why), while a
// site with no rows at all simply has not been run for this agent. Neither is 0% success.
function NotMeasured({ href }: { href: string | null }) {
  if (!href) {
    return (
      <span className="text-[13px] text-ink-muted" title="No trials recorded for this agent yet.">
        not run
      </span>
    );
  }
  return (
    <Link
      href={href}
      title="Not measured: every recorded trial failed before the agent reached the site (connection-level rejection at navigation, 0 steps), so there is no success rate to report; see the trial log."
      className="chip -my-1 inline-block py-1.5 transition-colors chip-neutral hover:text-ink"
    >
      not measured ⓘ
    </Link>
  );
}

// v1's flags, named for the audit and never for the fact they are mistaken for. The WebMCP
// flag is not shown: it records whether the browser exposed the API, which is not a property
// of the site (design S2-7 section 9).
function SubAudits({ entry }: { entry: SiteLeaderboardEntry }) {
  const states = auditStatesOf(entry);
  if (!states) return null;
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
      {v1AuditLines(states)
        .filter((line) => line.chip !== null)
        .map((line) => (
          <span
            key={line.key}
            title={`${line.label}: ${line.value.replace(/^[✓✗] /, "")}`}
            // A pass sits in body ink and anything else in muted ink: a weight difference, not
            // a verdict colour.
            className={`whitespace-nowrap ${line.tone === "pass" ? "text-ink-body" : "text-ink-muted"}`}
          >
            {line.chip}
          </span>
        ))}
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

  // The snapshot's figures (the sensitivity, the model gap, the protocol, the JSON-LD) print only
  // beside the batch they describe. A re-import that moves the table without regenerating the
  // snapshot shows a banner instead of two editions at once.
  const matches = editionMatches(summary.batch_label);
  const gap = matches ? EDITION.stats.model_gap : null;
  const protocol = matches ? EDITION.protocol : null;

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

  const tiles = [
    {
      label: "Task success (per trial)",
      value: formatPercent(summary.success_rate),
      sub:
        summary.trial_count > 0
          ? `${summary.success_count} of ${summary.trial_count} measured trials`
          : "no measured trials",
      bar: false,
    },
    {
      label: "Mean site success rate",
      value: formatPercent(meanSiteRate),
      sub:
        measuredEntries.length > 0
          ? `unweighted mean over ${measuredEntries.length} measured sites`
          : "no measured sites",
      bar: false,
    },
    {
      label: "Sites measured",
      value: `${summary.measured_site_count} / ${summary.site_count}`,
      sub:
        summary.excluded_trial_count > 0
          ? `${summary.excluded_trial_count} trials never reached the site`
          : "cohort sites with at least one measured trial",
      bar: false,
    },
    {
      label: "Category mean vs success",
      value: rhoCI ? `ρ = ${formatR(rhoCI.point)}` : "–",
      sub: rhoCI
        ? `95% CI ${formatInterval(rhoCI)}, n = ${pairs.length}`
        : "not enough measured sites",
      bar: true,
    },
  ];

  const lighthousePin = packageJson.devDependencies.lighthouse;
  const remeasured = matches ? EDITION.remeasurement : null;
  const companionVersions = remeasured
    ? [
        ...new Set(
          remeasured.batches
            .map((b) => b.lighthouse_version)
            .filter((v): v is string => v !== null && v !== lighthousePin)
        ),
      ]
    : [];

  return (
    <div>
      {matches ? <DatasetJsonLd /> : <EditionMismatch pageBatch={summary.batch_label} />}

      {/* Hero — the measured result, with its denominators */}
      <header>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <h1 className="page-title max-w-2xl">{EDITION.edition.title}</h1>
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
            <p className="text-[17px] leading-relaxed">
              <span className="font-semibold text-ink">
                {agentLabel(measuredAgentId)} found the registered fact within the budget on{" "}
                {formatPercent(summary.success_rate)} of trials
              </span>{" "}
              ({summary.success_count} of {summary.trial_count} measured trials across{" "}
              {summary.measured_site_count} of {summary.site_count} sites
              {runWindow && <>, measured {runWindow}</>}).{" "}
              {rhoCI ? (
                <>
                  {relationshipVerdict(rhoCI) === "none"
                    ? "No relationship between the Lighthouse category mean and where it succeeded was distinguishable from noise"
                    : `The Lighthouse category mean tracked where it succeeded (${
                        relationshipVerdict(rhoCI) === "positive" ? "higher" : "lower"
                      } means, more successes)`}
                  : ρ&nbsp;=&nbsp;{formatR(rhoCI.point)}, 95%&nbsp;CI&nbsp;
                  {formatInterval(rhoCI)}, n&nbsp;=&nbsp;{pairs.length} sites.{" "}
                  <Link
                    href={withAgent("/correlation", agentId)}
                    className="link-ink font-medium text-ink"
                  >
                    See the correlation →
                  </Link>
                </>
              ) : (
                <Link
                  href={withAgent("/correlation", agentId)}
                  className="link-ink font-medium text-ink"
                >
                  See the correlation →
                </Link>
              )}
            </p>
            {rhoCI && matches && <SensitivityLine className="text-sm leading-relaxed" />}
            {otherAgents.length > 0 && (
              <p className="text-sm leading-relaxed">
                {otherAgents.map((other) => (
                  <span key={other.agent_id}>
                    {agentLabel(other.agent_id)} ran the identical loop on the identical cohort (
                    {other.success_count} of {other.trial_count} measured trials).{" "}
                    {gap && gap.arms.includes(other.agent_id) && gap.arms.includes(measuredAgentId) && (
                      <>
                        {relationshipVerdict(gap) === "none"
                          ? "The two models are not distinguishable on this cohort"
                          : "The two models differ on this cohort"}
                        : paired mean gap {formatPoints(gap.point)} points ({agentLabel(gap.arms[1])}{" "}
                        minus {agentLabel(gap.arms[0])}), 95%&nbsp;CI {formatPointsInterval(gap)}, over{" "}
                        {gap.n} sites.{" "}
                      </>
                    )}
                    {switchable(other.agent_id) && (
                      <Link href={withAgent("/", other.agent_id)} className="link-ink">
                        Switch to it →
                      </Link>
                    )}
                  </span>
                ))}
              </p>
            )}
            <p className="text-xs leading-relaxed text-ink-muted">
              Scope of the claim: {summary.site_count} sites, one task shape
              {protocol && (
                <>
                  , {protocol.trials_per_site} trials per site, {protocol.max_steps} steps and a{" "}
                  {protocol.clock_seconds}-second clock per trial
                </>
              )}
              ,{panel.length === 1 ? " one agent" : ` ${panel.length} agents`} behind one frozen
              harness, one run window. Success is
              pre-registered exact match; trials that never reached the server are excluded from
              the denominator rather than scored 0%.{" "}
              <Link href="/methodology" className="link-ink">
                Methodology
              </Link>
              .
            </p>
          </div>
        )}
      </header>

      {/* Stats strip — every value carries the denominator it was computed over */}
      <div className="mt-12 grid grid-cols-2 border-y border-line lg:grid-cols-4">
        {tiles.map(({ label, value, sub, bar }, i) => (
          <div
            key={label}
            className={`px-4 py-5 sm:px-5 ${
              i % 2 === 1
                ? "border-l border-line-soft"
                : i === 2
                  ? "lg:border-l lg:border-line-soft"
                  : ""
            } ${i >= 2 ? "border-t border-line-soft lg:border-t-0" : ""}`}
          >
            <p className="stat-value">{value}</p>
            {/* The interval, drawn: at a glance it straddles zero, which is the result. */}
            {bar && rhoCI && (
              <IntervalBar
                domain={{ min: -1, max: 1 }}
                interval={{ lo: rhoCI.lo, hi: rhoCI.hi }}
                point={rhoCI.point}
                zero
                className="mt-2.5 max-w-[10rem]"
              />
            )}
            <p className="mt-2 text-[13px] font-medium text-ink-body">{label}</p>
            <p className="mt-1 text-xs leading-snug text-ink-muted">{sub}</p>
          </div>
        ))}
      </div>

      {/* Not batch-scoped: the exhibit is its own batch, so the mismatch guard never hides it. */}
      <GoodhartCard />

      {/* Table. No rank column: at five trials most rows are tied, and a number down the side
          reads as an ordering this study cannot resolve. Ties are in name order. */}
      {/* Scrolls rather than clips: overflow-hidden silently cut the sub-audit column off
          the right edge once real site names widened the table. */}
      <div id="leaderboard" className="mt-12 scroll-mt-6 overflow-x-auto border-y border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5">Site</th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5">Tier</th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5">Agent Success</th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5">Top Failure</th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5 text-right">Avg Steps</th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5 text-right">
                <a href="#fraction-not-score" className="link-ink" title="Lighthouse category mean">
                  LH mean
                </a>
              </th>
              <th scope="col" className="col-head whitespace-nowrap px-4 py-2.5" title="v1's recorded flags; key below the table">
                Sub-audits
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">
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
                  <td className="px-4 py-3.5">
                    <Link
                      href={siteHref}
                      className="-my-1 inline-block rounded py-1 font-medium text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-ink-muted"
                    >
                      {entry.name}
                    </Link>
                    <div className="max-w-xs truncate font-mono text-[11px] text-ink-muted">
                      {entry.start_url}
                    </div>
                    {/* The design flag explains expected outliers in place: without it,
                        "Amazon 0%" reads as a broken benchmark, not a designed blocker. */}
                    {entry.flag && (
                      <div className="mt-1.5 max-w-xs truncate" title={entry.flag}>
                        <FlagBadge flag={entry.flag} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <TierBadge tier={entry.tier} />
                  </td>
                  <td className="px-4 py-3.5">
                    {/* 0 trials is "not measured", not "0% success": a bar on an unrun site
                        asserts a result that does not exist. */}
                    {entry.trial_count === 0 ? (
                      <NotMeasured href={notMeasuredHref} />
                    ) : (
                      <>
                        <SuccessBar rate={entry.success_rate} />
                        <div className="mt-1 text-[11px] text-ink-muted">
                          {entry.trial_count} trials
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {/* No trials yet is not a failure mode — computeEntry reports "error" for
                        "no data", which would read as 28 crashed sites before a batch runs. */}
                    {entry.trial_count === 0 ? (
                      <span className="text-[13px] text-ink-muted">–</span>
                    ) : (
                      <FailureBadge mode={entry.top_failure_mode} />
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-[13px] tabular-nums text-ink-body">
                    {entry.trial_count === 0 ? (
                      <span className="text-ink-muted">–</span>
                    ) : (
                      entry.mean_steps
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <LhScore score={entry.lh_total} />
                  </td>
                  <td className="px-4 py-3.5">
                    <SubAudits entry={entry} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mx-auto mt-6 max-w-3xl space-y-2 text-center text-xs leading-relaxed text-ink-muted">
        <p>
          Scoring is pre-registered exact-match, decided before any agent runs (batch{" "}
          <code className="font-mono">{summary.batch_label}</code>, agent{" "}
          <code className="font-mono">{measuredAgentId}</code>
          {runWindow && <>, {runWindow}</>}). Rows with the same success rate are in name order.
          Sub-audits: ✓ passed, ✗ did not pass, – did not pass or did not apply (v1 did not record
          which); the CLS chip is v1&apos;s flag for a layout-shift audit result of exactly 1.00.
        </p>
        {/* Stated once, here; every other surface links to this anchor (design S2-7 section 9, rule 2). */}
        <p id="fraction-not-score" className="scroll-mt-6">
          The static axis is the{" "}
          <a
            href="https://developer.chrome.com/docs/lighthouse"
            target="_blank"
            rel="noreferrer"
            className="link-ink"
          >
            Lighthouse Agentic Browsing category
          </a>
          , unmodified
          {matches && EDITION.lane1.lighthouse_version && (
            <>
              , at Lighthouse {EDITION.lane1.lighthouse_version} for batch{" "}
              <code className="font-mono">{EDITION.batch_label}</code>; the current pin is{" "}
              {lighthousePin}
              {remeasured && companionVersions.length > 0 && (
                <>
                  , and the re-measurement of {formatDate(remeasured.date)} also ran{" "}
                  {companionVersions.join(" and ")}
                </>
              )}
            </>
          )}
          . Chrome shows this category as a fraction of checks passed and publishes no score; the
          mean is Lighthouse&apos;s own arithmetic, which we read from the JSON.{" "}
          <Link href="/methodology#static-axis" className="link-ink">
            About half of it is layout shift
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
