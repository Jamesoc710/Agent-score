import Link from "next/link";
import { getCorrelationPoints, pearsonR, linearRegression } from "@/lib/queries";
import CorrelationChart from "@/components/CorrelationChart";

// Rendered per request: results change when a batch is imported, not when the app is built,
// and a build should not need database credentials.
export const dynamic = "force-dynamic";

export default async function CorrelationPage() {
  const points = await getCorrelationPoints();

  const xyPairs = points.map((p) => ({ x: p.lh_total, y: p.success_rate }));
  const r = pearsonR(xyPairs);
  const { slope, intercept } = linearRegression(xyPairs);

  // Sub-audit correlation: which single audit best predicts success?
  const subAudits = [
    { key: "lh_accessibility_tree" as const, label: "Accessibility Tree" },
    { key: "lh_layout_stability" as const, label: "Layout Stability" },
    { key: "lh_llms_txt" as const, label: "llms.txt" },
    { key: "lh_webmcp" as const, label: "WebMCP" },
  ];

  const subAuditCorrelations = subAudits.map(({ key, label }) => {
    const pairs = points.map((p) => ({ x: p[key], y: p.success_rate }));
    return { label, r: pearsonR(pairs) };
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  // Find the "surprising" entry: biggest gap between LH rank and success rank
  const byLh = [...points].sort((a, b) => b.lh_total - a.lh_total);
  const bySuccess = [...points].sort((a, b) => b.success_rate - a.success_rate);
  const surprisingEntry = points.reduce((best, p) => {
    const lhRank = byLh.findIndex((x) => x.site_id === p.site_id);
    const successRank = bySuccess.findIndex((x) => x.site_id === p.site_id);
    const gap = Math.abs(lhRank - successRank);
    return gap > best.gap ? { site: p, gap, lhRank, successRank } : best;
  }, { site: points[0], gap: 0, lhRank: 0, successRank: 0 });

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
          ← Leaderboard
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Does Google&apos;s rubric predict agent success?
        </h1>
        <p className="text-slate-500 max-w-2xl">
          Each point is one site. The x-axis is Google&apos;s Lighthouse Agentic Browsing score; the y-axis is the measured
          success rate of a fixed Gemini agent completing a real task. The dashed line is a least-squares fit.
        </p>
      </div>

      {/* The scatter chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
        <CorrelationChart points={points} slope={slope} intercept={intercept} r={r} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Sub-audit ranking */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Which sub-audit predicts success?</h2>
          <p className="text-xs text-slate-400 mb-4">Pearson r between each single audit and behavioral success rate.</p>
          <div className="space-y-3">
            {subAuditCorrelations.map(({ label, r: subR }, i) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700 font-medium">
                    {i === 0 && "🥇 "}{label}
                  </span>
                  <span className={`font-mono font-semibold ${Math.abs(subR) >= 0.5 ? "text-sky-600" : "text-slate-400"}`}>
                    r = {subR.toFixed(2)}
                  </span>
                </div>
                <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full ${Math.abs(subR) >= 0.5 ? "bg-sky-500" : "bg-slate-300"}`}
                    style={{ width: `${Math.abs(subR) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Surprising site callout */}
        {surprisingEntry.gap > 1 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-900 mb-2">The most interesting data point</h2>
            <p className="text-sm text-slate-500 mb-4">
              This site has the biggest gap between its Lighthouse rank and its behavioral rank — the case where the
              static rubric gets it wrong.
            </p>
            <Link
              href={`/site/${surprisingEntry.site.site_id}`}
              className="block rounded-lg border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-colors p-4"
            >
              <p className="font-semibold text-slate-900 mb-1">{surprisingEntry.site.name}</p>
              <div className="text-sm text-slate-500 space-y-1">
                <p>
                  Lighthouse rank: <span className="font-mono text-slate-700">#{surprisingEntry.lhRank + 1}</span>
                  {" "}(score: {surprisingEntry.site.lh_total})
                </p>
                <p>
                  Behavioral rank: <span className="font-mono text-slate-700">#{surprisingEntry.successRank + 1}</span>
                  {" "}({Math.round(surprisingEntry.site.success_rate * 100)}% success)
                </p>
                <p className="text-sky-600 font-medium mt-2">View site detail →</p>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* One-liner finding */}
      <div className="bg-slate-900 text-white rounded-xl p-6">
        <h2 className="font-semibold text-slate-200 mb-2 text-sm uppercase tracking-wide">The finding</h2>
        <p className="text-lg font-medium leading-relaxed">
          {Math.abs(r) >= 0.7
            ? <>Google&apos;s Agentic Browsing rubric (r&nbsp;=&nbsp;{r.toFixed(2)}) is a strong predictor of real agent success. The best single indicator: <span className="text-sky-400">{subAuditCorrelations[0].label}</span> (r&nbsp;=&nbsp;{subAuditCorrelations[0].r.toFixed(2)}).</>
            : Math.abs(r) >= 0.4
            ? <>Google&apos;s Agentic Browsing rubric (r&nbsp;=&nbsp;{r.toFixed(2)}) has moderate predictive power. The most predictive sub-audit: <span className="text-sky-400">{subAuditCorrelations[0].label}</span> (r&nbsp;=&nbsp;{subAuditCorrelations[0].r.toFixed(2)}). <span className="text-slate-300">{subAuditCorrelations[subAuditCorrelations.length - 1].label} predicted nothing</span> (r&nbsp;=&nbsp;{subAuditCorrelations[subAuditCorrelations.length - 1].r.toFixed(2)}).</>
            : <>Google&apos;s Agentic Browsing rubric barely predicts real agent success (r&nbsp;=&nbsp;{r.toFixed(2)}). The most predictive sub-audit: <span className="text-sky-400">{subAuditCorrelations[0].label}</span> — but the rubric as a whole is not a reliable proxy for whether an agent can actually complete a task.</>
          }
        </p>
      </div>
    </div>
  );
}
