import Link from "next/link";
import { getLeaderboard } from "@/lib/queries";
import { SiteLeaderboardEntry } from "@/lib/types";

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

export default async function LeaderboardPage() {
  const entries = await getLeaderboard();

  return (
    <div>
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Is the web ready for agents?
        </h1>
        <p className="text-slate-500 max-w-2xl">
          Google shipped the Agentic Browsing checklist — we ran the experiment. Each site below was tested 5× with a
          fixed Gemini agent completing a real task. Static Lighthouse scores are on the right.{" "}
          <Link href="/correlation" className="text-sky-600 hover:underline font-medium">
            See the correlation →
          </Link>
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Sites tested", value: entries.length },
          {
            label: "Avg success rate",
            value:
              entries.length > 0
                ? Math.round(
                    (entries.reduce((s, e) => s + e.success_rate, 0) / entries.length) * 100
                  ) + "%"
                : "—",
          },
          {
            label: "Total agent runs",
            value: entries.reduce((s, e) => s + e.trial_count, 0),
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 font-semibold text-slate-500 w-10">#</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500">Site</th>
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
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                  No cohort data yet. Seed the sites and run the lanes, or set{" "}
                  <code className="font-mono text-slate-500">USE_FAKE_DATA=true</code> for fixtures.
                </td>
              </tr>
            )}
            {entries.map((entry, i) => (
              <tr key={entry.site_id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${i === entries.length - 1 ? "border-b-0" : ""}`}>
                <td className="px-4 py-3 text-slate-400 font-mono">{entry.rank}</td>
                <td className="px-4 py-3">
                  <Link href={`/site/${entry.site_id}`} className="font-medium text-slate-900 hover:text-sky-600 transition-colors">
                    {entry.name}
                  </Link>
                  <div className="text-xs text-slate-400 truncate max-w-xs">{entry.start_url}</div>
                </td>
                <td className="px-4 py-3">
                  <SuccessBar rate={entry.success_rate} />
                  <div className="text-xs text-slate-400 mt-0.5">{entry.trial_count} trials</div>
                </td>
                <td className="px-4 py-3">
                  <FailureBadge mode={entry.top_failure_mode} />
                </td>
                <td className="px-4 py-3 text-slate-600 tabular-nums">{entry.mean_steps}</td>
                <td className="px-4 py-3">
                  <LhScore score={entry.lh_total} />
                </td>
                <td className="px-4 py-3">
                  <SubAudits entry={entry} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-4 text-center">
        Scoring is pre-registered exact-match, decided before any agent runs. Behavioral results use Gemini (fixed model + prompt).
        Static scores use{" "}
        <a href="https://developer.chrome.com/docs/lighthouse" target="_blank" rel="noreferrer" className="underline">
          Lighthouse 13.3 Agentic Browsing category
        </a>
        , unmodified.
      </p>
    </div>
  );
}
