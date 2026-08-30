import Link from "next/link";
import { PUBLISHED_AGENTS, USING_FIXTURES, withAgent } from "@/lib/dataset";

// Which agent's dataset the page is reading. Both agents ran the identical frozen loop on the
// identical cohort, so switching here compares models, not harnesses — the point of the v1
// panel. Plain links, no client JS: every page is already rendered per request.

export default function AgentToggle({
  selected,
  basePath,
}: {
  selected: string;
  basePath: string;
}) {
  // The fixture set is single-agent. Offering a toggle there would imply a second dataset
  // that does not exist.
  if (USING_FIXTURES) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-slate-400">
        <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-500">
          Fixture data — single agent
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
      <span className="px-2 text-xs font-medium text-slate-400">Agent</span>
      {PUBLISHED_AGENTS.map((agent) => {
        const active = agent.id === selected;
        return (
          <Link
            key={agent.id}
            href={withAgent(basePath, agent.id)}
            title={agent.note}
            aria-current={active ? "true" : undefined}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-sky-50 text-sky-700"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            {agent.label}
          </Link>
        );
      })}
    </div>
  );
}
