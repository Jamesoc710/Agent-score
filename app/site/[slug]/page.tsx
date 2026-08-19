import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteDetail, measuredRuns } from "@/lib/queries";
import { Run } from "@/lib/types";
import { TierBadge, FlagBadge } from "@/components/SiteBadges";

function SubAuditRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-medium ${value === 1 ? "text-emerald-600" : "text-slate-400"}`}>
        {value === 1 ? "✓ Pass" : "✗ Fail"}
      </span>
    </div>
  );
}

function TrialRow({ run }: { run: Run }) {
  const failureLabels: Record<string, string> = {
    success: "✓ success",
    blocked: "⛔ blocked",
    timeout: "⏱ timeout",
    wrong_extraction: "⚠ wrong answer",
    navigation_stuck: "🔀 nav stuck",
    error: "💥 error",
  };
  return (
    <tr className="border-b border-slate-100 last:border-0 text-sm">
      <td className="px-4 py-2 text-slate-500">Trial {run.trial_number}</td>
      <td className="px-4 py-2">
        <span className={`font-medium ${run.success ? "text-emerald-600" : "text-red-500"}`}>
          {run.success ? "✓ Success" : "✗ Failed"}
        </span>
      </td>
      <td className="px-4 py-2 text-slate-500">{failureLabels[run.failure_mode]}</td>
      <td className="px-4 py-2 text-slate-500 tabular-nums">{run.step_count} steps</td>
      <td className="px-4 py-2 text-slate-500 tabular-nums">{run.duration_seconds}s</td>
    </tr>
  );
}

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

export default async function SiteDetailPage({ params }: { params: { slug: string } }) {
  const data = await getSiteDetail(params.slug);
  if (!data) notFound();

  const { site, lighthouse, runs: allRuns } = data;
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

  const failureCounts: Record<string, number> = {};
  runs.forEach((r) => {
    failureCounts[r.failure_mode] = (failureCounts[r.failure_mode] ?? 0) + 1;
  });

  // No trials = no measurement. "0%" here would assert a result nobody produced —
  // the recurring bug class this project cannot afford (see buildout plan).
  const rateColor =
    runs.length === 0
      ? "text-slate-300"
      : successRate >= 70 ? "text-emerald-600" : successRate >= 40 ? "text-amber-600" : "text-red-500";

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
          ← Leaderboard
        </Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{site.name}</h1>
          <a
            href={site.start_url}
            target="_blank"
            rel="noreferrer"
            className="text-sky-600 text-sm hover:underline mt-1 inline-block"
          >
            {site.start_url} ↗
          </a>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <TierBadge tier={site.tier} />
            <FlagBadge flag={site.flag} />
          </div>
        </div>
        <div className="text-right">
          <div className={`text-5xl font-bold tabular-nums ${rateColor}`}>
            {runs.length > 0 ? `${successRate}%` : "—"}
          </div>
          <div className="text-sm text-slate-400 mt-1">Agent success rate</div>
          <div className="text-xs text-slate-400">{runs.length} measured trials</div>
          {excluded > 0 && (
            <div className="text-xs text-slate-400">
              +{excluded} excluded: never reached the site
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Lighthouse scores */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4 flex items-center justify-between">
            Lighthouse Agentic Browsing
            {lighthouse ? (
              <span
                className={`text-lg font-bold tabular-nums ${
                  lighthouse.lh_total >= 70 ? "text-emerald-600" : lighthouse.lh_total >= 40 ? "text-amber-600" : "text-red-500"
                }`}
              >
                {lighthouse.lh_total}
              </span>
            ) : (
              <span className="text-slate-400 text-sm">Not run yet</span>
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
            <p className="text-sm text-slate-400">Run Lane 1 to populate Lighthouse scores.</p>
          )}
        </div>

        {/* Behavioral summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Behavioral Summary</h2>
          {runs.length > 0 ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Successes</span>
                <span className="font-medium text-slate-900">
                  {successes} / {runs.length}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Mean steps</span>
                <span className="font-medium text-slate-900 tabular-nums">{meanSteps}</span>
              </div>
              <div className="border-t border-slate-100 pt-3 mt-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Failure breakdown</p>
                {Object.entries(failureCounts).map(([mode, count]) => (
                  <div key={mode} className="flex justify-between text-sm py-0.5">
                    <span className="text-slate-500 capitalize">{mode.replace(/_/g, " ")}</span>
                    <span className="text-slate-700 font-mono">{count}×</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No runs yet. Execute Lane 2 to populate.</p>
          )}
        </div>
      </div>

      {/* The task the agent was given — previously invisible on the site page */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-8">
        <h2 className="font-semibold text-slate-900 mb-1">The task</h2>
        <p className="text-sm text-slate-600">&ldquo;{site.question}&rdquo;</p>
        <p className="text-xs text-slate-400 mt-2">
          Every site gets the same task shape: start at the URL above, navigate to the answer,
          report it. Only the question varies. The agent never sees the scoring key below.
        </p>
      </div>

      {/* Pre-registered answer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-8">
        <h2 className="font-semibold text-amber-900 mb-1">Pre-registered scoring key</h2>
        <p className="text-sm text-amber-700">
          <span className="font-medium">Expected answer substring:</span>{" "}
          <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-800">{site.answer_substring}</code>
        </p>
        {site.match_rule && (
          <p className="text-sm text-amber-700 mt-1">
            <span className="font-medium">Match rule:</span>{" "}
            <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-amber-800">{site.match_rule}</code>
          </p>
        )}
        <p className="text-xs text-amber-600 mt-1">{site.answer_note}</p>
        <p className="text-xs text-amber-500 mt-2">
          Registered before any agent runs. Success = the agent&apos;s final output contains this
          substring after the normalization rules in docs/METHODOLOGY.md.
        </p>
      </div>

      {/* Trial log — every recorded row, including excluded never-reached errors */}
      {allRuns.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Trial log</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Trial</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Result</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Failure Mode</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Steps</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500">Duration</th>
              </tr>
            </thead>
            <tbody>
              {allRuns.sort((a, b) => a.trial_number - b.trial_number).map((run) => (
                <TrialRow key={run.trial_number} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
