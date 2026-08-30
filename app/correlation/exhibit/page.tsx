import Link from "next/link";
import { getPublishedDataset, toCorrelationPoints } from "@/lib/queries";
import { EXHIBIT } from "@/lib/exhibit-data";
import type { ExhibitAgentResult, ExhibitDataset, ExhibitPageResult } from "@/lib/exhibit";
import { successAcrossPages } from "@/lib/exhibit";
import { agentLabel, resolveAgentId, withAgent } from "@/lib/dataset";
import { formatPercent, formatRunWindow } from "@/lib/format";
import CorrelationChart from "@/components/CorrelationChart";
import TrialReplay from "@/components/TrialReplay";
import type { CorrelationPoint } from "@/lib/types";

// Rendered per request like every other data page: the cohort backdrop comes from the
// published batch, which changes when a batch is imported rather than when the app is built.
export const dynamic = "force-dynamic";

/** The control and the gated half, by the ids registered in data/exhibit-cohort.csv. */
const CONTROL_ID = "exhibit_a";
const GATED_ID = "exhibit_b";

/**
 * The static score both halves were measured at, or null if they somehow differ.
 *
 * Read off the committed Lane 1 artifact rather than written into the copy. The whole page
 * turns on "both pages score the same", so that number is never a literal in a sentence.
 */
const SHARED_LH_TOTAL: number | null = (() => {
  const scores = [
    ...new Set(EXHIBIT.pages.map((p) => p.lighthouse?.lh_total).filter((v) => v != null)),
  ];
  return scores.length === 1 ? (scores[0] as number) : null;
})();

export const metadata = {
  title: "The Goodhart exhibit — AgentRank",
  description:
    SHARED_LH_TOTAL === null
      ? "Two authored pages, identical except for one property the Lighthouse Agentic Browsing audit cannot see. The agent solves one on every trial and never solves the other."
      : `Two authored pages that both score ${SHARED_LH_TOTAL} on Google's Lighthouse Agentic Browsing category. The agent solves one on every trial and never solves the other.`,
};

export default async function ExhibitPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agentId = resolveAgentId(searchParams.agent);

  // The cohort is the backdrop of the scatter and nothing else. Its points are read the way
  // every other page reads them, and the exhibit's own numbers never touch this call.
  const { entries, summary } = await getPublishedDataset(agentId);
  const cohortPoints = toCorrelationPoints(entries);

  const control = EXHIBIT.pages.find((p) => p.site.site_id === CONTROL_ID);
  const gated = EXHIBIT.pages.find((p) => p.site.site_id === GATED_ID);
  const runWindow = formatRunWindow(EXHIBIT.run_window);

  return (
    <div>
      <div className="mb-6">
        <Link href={withAgent("/correlation", agentId)} className="back-link">
          ← Correlation study
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="page-title">
          {SHARED_LH_TOTAL === null
            ? "A page that passes the audit and defeats the agent"
            : `A page that scores ${SHARED_LH_TOTAL} and defeats the agent`}
        </h1>
        <p className="page-lead">
          The correlation study could not distinguish the Lighthouse Agentic Browsing score&apos;s
          predictive power from noise, and neither could any single sub-audit. Both are statements
          about what {cohortPoints.length} sites could detect. This page is the other kind of
          evidence: two authored pages, built to be identical except for one thing the audit
          cannot see.
        </p>
      </header>

      <AuthoredBanner cohortSiteCount={summary.site_count} />

      {control && gated ? (
        <>
          <Headline control={control} gated={gated} runWindow={runWindow} />
          <Scatter
            cohortPoints={cohortPoints}
            cohortBatch={summary.batch_label}
            cohortAgent={summary.agent_id}
            control={control}
            gated={gated}
          />
          <Mechanism control={control} gated={gated} />
          <Results dataset={EXHIBIT} runWindow={runWindow} />
          <Registration dataset={EXHIBIT} control={control} gated={gated} />
          <Claims control={control} gated={gated} />
          <TrialLog dataset={EXHIBIT} />
        </>
      ) : (
        <div className="card card-pad">
          <p className="text-sm text-ink-body">
            The exhibit artifacts do not contain both halves of the registered pair, so there is
            nothing here to compare. Nothing is inferred from half a pair.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuthoredBanner({ cohortSiteCount }: { cohortSiteCount: number }) {
  const trials = EXHIBIT.pages.reduce(
    (n, p) => n + p.agents.reduce((m, a) => m + a.runs.length, 0),
    0
  );
  return (
    <div className="card-notice mb-8">
      <p className="text-sm font-semibold text-notice-ink">
        These two pages are authored, and they are not in any cohort number.
      </p>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-notice-body">
        They were written for this demonstration. They are not real products, not real companies,
        and not among the {cohortSiteCount} measured websites. Their {trials} trials are their own
        batch (
        <code className="rounded bg-notice-soft px-1 py-0.5 font-mono text-xs">
          {EXHIBIT.batch_label}
        </code>
        ), they are never imported into the database the leaderboard reads, and they enter no
        correlation, no success rate and no n on this site. Every published figure about the
        cohort is exactly what it was before this page existed.
      </p>
    </div>
  );
}

function Headline({
  control,
  gated,
  runWindow,
}: {
  control: ExhibitPageResult;
  gated: ExhibitPageResult;
  runWindow: string | null;
}) {
  const c = successAcrossPages(EXHIBIT, control.site.site_id);
  const g = successAcrossPages(EXHIBIT, gated.site.site_id);
  const agentCount = EXHIBIT.agent_ids.length;

  return (
    <div className="card card-pad mb-6">
      <p className="text-lg font-semibold leading-snug text-ink sm:text-xl">
        Both pages score {control.lighthouse?.lh_total ?? "—"} out of 100. The agent reported the
        registered answer on {c.successes} of {c.measured} trials against one of them, and{" "}
        {g.successes} of {g.measured} against the other.
      </p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-body">
        Same question, same registered answer, same 40 rows of data, same styling, same copy. At
        1280 by 800 on load the two pages render the identical screenshot, byte for byte. Lighthouse
        gives them the identical score with the identical audit outcomes. A person finds the answer
        on either one in a few seconds. The frozen agent finds it on one of them and never on the
        other, across {agentCount} models and {c.measured + g.measured} trials
        {runWindow && <> measured {runWindow} (UTC)</>}.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SideCard page={control} tone="good" />
        <SideCard page={gated} tone="bad" />
      </div>
    </div>
  );
}

function SideCard({ page, tone }: { page: ExhibitPageResult; tone: "good" | "bad" }) {
  const total = successAcrossPages(EXHIBIT, page.site.site_id);
  const rate = total.measured > 0 ? total.successes / total.measured : null;
  const accent = tone === "good" ? "border-good/30 bg-good-soft" : "border-bad/30 bg-bad-soft";
  const ink = tone === "good" ? "text-good-ink" : "text-bad-ink";

  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-sm font-semibold text-ink">{page.site.name}</p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{page.route}</p>
      <div className="mt-3 flex items-baseline gap-6">
        <div>
          <p className={`text-3xl font-bold tabular-nums ${ink}`}>{formatPercent(rate)}</p>
          <p className="text-[11px] text-ink-muted">
            {total.successes} of {total.measured} trials
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums text-ink">
            {page.lighthouse?.lh_total ?? "—"}
          </p>
          <p className="text-[11px] text-ink-muted">Lighthouse score</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-body">{page.site.flag}</p>
    </div>
  );
}

function Scatter({
  cohortPoints,
  cohortBatch,
  cohortAgent,
  control,
  gated,
}: {
  cohortPoints: CorrelationPoint[];
  cohortBatch: string;
  cohortAgent: string;
  control: ExhibitPageResult;
  gated: ExhibitPageResult;
}) {
  const authored = [control, gated]
    .filter((p) => p.lighthouse !== null)
    .map((p) => {
      const total = successAcrossPages(EXHIBIT, p.site.site_id);
      return {
        site_id: p.site.site_id,
        name: p.site.name.replace(/\s*\(.*\)$/, ""),
        lh_total: p.lighthouse!.lh_total,
        success_rate: total.measured > 0 ? total.successes / total.measured : 0,
        lh_accessibility_tree: p.lighthouse!.lh_accessibility_tree,
        lh_layout_stability: p.lighthouse!.lh_layout_stability,
        lh_llms_txt: p.lighthouse!.lh_llms_txt,
        lh_webmcp: p.lighthouse!.lh_webmcp,
      };
    });

  return (
    <div className="card mb-8 p-3 sm:p-6">
      <CorrelationChart points={cohortPoints} fit={null} authored={authored} />
      <p className="mt-3 px-2 text-xs leading-relaxed text-ink-muted sm:px-0">
        Grey circles are the {cohortPoints.length} measured cohort sites from batch{" "}
        <code className="font-mono">{cohortBatch}</code> under {agentLabel(cohortAgent)}, shown as
        context only. The two outlined diamonds are the authored pages, plotted at the success rate
        pooled over both agents. They are a separate series: no correlation, interval, fitted line
        or n on this site includes them, and no fitted line is drawn here at all. The pair sits at
        the same x and at opposite ends of y, which is the whole exhibit.
      </p>
    </div>
  );
}

function Mechanism({ control, gated }: { control: ExhibitPageResult; gated: ExhibitPageResult }) {
  return (
    <div className="card card-pad mb-8">
      <h2 className="card-title">What the two pages differ in</h2>
      <p className="card-note mb-4 max-w-3xl">
        One thing. The table lives in a fixed-height scroll box showing its first 12 rows. On{" "}
        {control.site.name.replace(/\s*\(.*\)$/, "")} all 40 rows are placed in the document and the
        ones past the twelfth are simply clipped by the box. On{" "}
        {gated.site.name.replace(/\s*\(.*\)$/, "")} only the rows inside the visible window are
        placed in the document at all, with two zero-content spacer rows holding the height of the
        rest. That is ordinary list virtualization, the technique behind essentially every large
        data grid on the web.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Measured at load
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Exhibit A
              </th>
              <th scope="col" className="py-2 font-medium">
                Exhibit B
              </th>
            </tr>
          </thead>
          <tbody className="text-ink-body">
            <MechanismRow label="Rendered screenshot, 1280 x 800" a="identical PNG" b="identical PNG" />
            <MechanismRow
              label="Lighthouse Agentic Browsing"
              a={String(control.lighthouse?.lh_total ?? "—")}
              b={String(gated.lighthouse?.lh_total ?? "—")}
            />
            <MechanismRow label="Accessibility-tree audit" a="pass" b="pass" />
            <MechanismRow label="Layout-stability audit" a="pass" b="pass" />
            <MechanismRow label="Data rows in the document" a="40" b="16" />
            <MechanismRow label="Target row in document.body.innerText" a="yes" b="no" />
            <MechanismRow label="Target row in the screenshot" a="no, it is below the fold" b="no" />
            <MechanismRow label="Reachable by window.scrollBy" a="not needed" b="no" />
            <MechanismRow label="Reachable by a person" a="yes" b="yes, scroll the box" />
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        The distinction that decides the outcome is not that the row is off screen. It is that on
        Exhibit B the row is not in the document: not in the DOM, not in the accessibility tree, not
        in the text, not in the pixels. The harness reads a screenshot and{" "}
        <code className="font-mono">document.body.innerText</code>, and its only scroll action is{" "}
        <code className="font-mono">window.scrollBy</code>, which moves the window rather than an
        inner scroll container. Both pages do carry the full 40-row dataset inline in their
        response, which is stated rather than hidden: it keeps the two pages byte-comparable and
        the render synchronous, and{" "}
        <code className="font-mono">docs/EXHIBIT.md</code> explains the trade.
      </p>
    </div>
  );
}

function MechanismRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <th scope="row" className="py-2 pr-4 text-left font-normal text-ink">
        {label}
      </th>
      <td className="py-2 pr-4 tabular-nums">{a}</td>
      <td className="py-2 tabular-nums">{b}</td>
    </tr>
  );
}

function Results({ dataset, runWindow }: { dataset: ExhibitDataset; runWindow: string | null }) {
  return (
    <div className="card card-pad mb-8">
      <h2 className="card-title">Every trial</h2>
      <p className="card-note mb-4">
        The frozen v1 loop, unchanged: the same prompt, the same 15-step and 90-second caps, the
        same scorer, both agents of the published panel, 5 trials each.
        {runWindow && <> Measured {runWindow} (UTC).</>}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Page
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Agent
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Success
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Recorded outcome
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Mean steps
              </th>
              <th scope="col" className="py-2 font-medium">
                Mean seconds
              </th>
            </tr>
          </thead>
          <tbody>
            {dataset.pages.flatMap((page) =>
              page.agents.map((agent) => (
                <tr
                  key={`${page.site.site_id}-${agent.agent_id}`}
                  className="border-b border-line-soft last:border-0"
                >
                  <td className="py-2 pr-4 text-ink">{page.site.name}</td>
                  <td className="py-2 pr-4 text-ink-body">{agentLabel(agent.agent_id)}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-ink">
                    {agent.success_count} / {agent.measured_trial_count}
                  </td>
                  <td className="py-2 pr-4 text-xs text-ink-body">
                    {agent.failure_modes.map((m) => `${m.count} ${m.mode}`).join(", ")}
                    {agent.excluded_trial_count > 0 && (
                      <> ({agent.excluded_trial_count} excluded, never reached the page)</>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-ink-body">
                    {agent.mean_steps ?? "—"}
                  </td>
                  <td className="py-2 font-mono tabular-nums text-ink-body">
                    {agent.mean_seconds ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Registration({
  dataset,
  control,
  gated,
}: {
  dataset: ExhibitDataset;
  control: ExhibitPageResult;
  gated: ExhibitPageResult;
}) {
  return (
    <div className="card card-pad mb-8">
      <h2 className="card-title">What was registered, and when</h2>
      <p className="card-note mb-4 max-w-3xl">
        An exhibit that chose its answer after watching the agent fail would be worth nothing. The
        question, the answer and the match rule below were committed to this repository, and tagged,
        before a single published trial ran. The pages were committed in the same commit and were
        not touched afterwards.
      </p>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem,1fr]">
        <dt className="font-medium text-ink-muted">Question</dt>
        <dd className="text-ink-body">{dataset.question}</dd>
        <dt className="font-medium text-ink-muted">Registered answer</dt>
        <dd>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">
            {dataset.answer_substring}
          </code>
        </dd>
        <dt className="font-medium text-ink-muted">Match rule</dt>
        <dd className="font-mono text-xs text-ink-body">{dataset.match_rule}</dd>
        <dt className="font-medium text-ink-muted">Answer key</dt>
        <dd className="text-ink-body">
          <code className="font-mono text-xs">data/exhibit-cohort.csv</code>, receipt tagged{" "}
          <code className="font-mono text-xs">exhibit-key-v1</code>
        </dd>
        <dt className="font-medium text-ink-muted">Batch</dt>
        <dd className="text-ink-body">
          <code className="font-mono text-xs">{dataset.batch_label}</code>, never{" "}
          <code className="font-mono text-xs">v1</code>
        </dd>
        <dt className="font-medium text-ink-muted">The pages</dt>
        <dd className="text-ink-body">
          <a href={control.route} className="text-accent hover:underline">
            {control.route}
          </a>
          {" and "}
          <a href={gated.route} className="text-accent hover:underline">
            {gated.route}
          </a>
        </dd>
      </dl>
      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-muted">
        The registered answer is a code with no pattern, unique on the page and absent from its
        prose, so it cannot be inferred from what Exhibit B renders. Everything above the marked
        mechanism line in the two files is byte-identical, and a test asserts it, so &ldquo;they
        differ only in the mechanism&rdquo; is checkable rather than asserted. The trials were
        served from this repository&apos;s own build on localhost, because this deployment protects
        every URL except production and reaching production means deploying;{" "}
        <code className="font-mono">docs/EXHIBIT.md</code> records the exact commands.
      </p>
    </div>
  );
}

function Claims({ control, gated }: { control: ExhibitPageResult; gated: ExhibitPageResult }) {
  const g = successAcrossPages(EXHIBIT, gated.site.site_id);
  const c = successAcrossPages(EXHIBIT, control.site.site_id);

  return (
    <div className="card-emphasis mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emphasis-muted">
        What this does and does not show
      </h2>
      <p className="text-lg font-medium leading-relaxed text-emphasis-ink">
        A page can score {gated.lighthouse?.lh_total ?? "—"} out of 100 on Google&apos;s Agentic
        Browsing category, pass every audit in it, be fully usable by a person, and still defeat
        this agent on every one of {g.measured} trials across both models, while its twin is solved
        on {c.successes} of {c.measured}. The property that decides which happens is not one the
        audit looks at.
      </p>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-emphasis-body">
        <li>
          <span className="font-semibold">It does not show the audit is gameable in general.</span>{" "}
          This is one authored page. It shows the two measures can be made to come apart by
          construction; it says nothing about how often they come apart in the wild.
        </li>
        <li>
          <span className="font-semibold">It does not show the audit is wrong.</span> Both audits in
          the category passed on both pages, correctly. The claim is that passing them is not
          sufficient for the behavioral outcome, not that passing them is worthless.
        </li>
        <li>
          <span className="font-semibold">It does not generalise to other agents.</span> The result
          is scoped to the agent that produced this study&apos;s y-axis, which is why it was run
          through the identical frozen loop rather than something new. A harness that can drive an
          inner scroll container would be measuring a different thing.
        </li>
        <li>
          <span className="font-semibold">It is not evidence about any real website.</span> Nothing
          on these pages describes, imitates or is a claim about a real site or company.
        </li>
      </ul>
    </div>
  );
}

function TrialLog({ dataset }: { dataset: ExhibitDataset }) {
  return (
    <div className="card card-pad">
      <h2 className="card-title">Transcripts</h2>
      <p className="card-note mb-5">
        Every trial expands into the steps it recorded. The failure labels above are only worth what
        these make auditable.
      </p>
      <div className="space-y-6">
        {dataset.pages.map((page) => (
          <div key={page.site.site_id}>
            <h3 className="text-sm font-semibold text-ink">{page.site.name}</h3>
            <div className="mt-3 space-y-5">
              {page.agents.map((agent) => (
                <AgentTrials key={agent.agent_id} page={page} agent={agent} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentTrials({ page, agent }: { page: ExhibitPageResult; agent: ExhibitAgentResult }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">
        {agentLabel(agent.agent_id)} — {agent.success_count} of {agent.measured_trial_count} trials
        succeeded
      </p>
      <ul className="mt-2 space-y-2">
        {agent.runs.map((run) => (
          <li
            key={run.trial_number}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <span className="font-medium text-ink">Trial {run.trial_number}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  run.success ? "bg-good-soft text-good-ink" : "bg-bad-soft text-bad-ink"
                }`}
              >
                {run.failure_mode}
              </span>
              <span className="tabular-nums text-ink-muted">
                {run.step_count} {run.step_count === 1 ? "step" : "steps"}, {run.duration_seconds}s
              </span>
            </div>
            <div className="mt-2">
              <TrialReplay
                run={run}
                id={`trial-${page.site.site_id}-${agent.agent_id}-${run.trial_number}`}
                open={false}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
