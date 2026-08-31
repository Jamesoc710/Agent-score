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
      <span className="inline-block rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-muted">
        Fixture data: single agent
      </span>
    );
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      <span className="px-2 text-xs font-medium text-ink-muted">Agent</span>
      {PUBLISHED_AGENTS.map((agent) => {
        const active = agent.id === selected;
        return (
          <Link
            key={agent.id}
            href={withAgent(basePath, agent.id)}
            title={agent.note}
            aria-current={active ? "true" : undefined}
            // The selected agent is marked by weight and an outline as well as by fill, so the
            // control still reads as a two-state control without colour.
            className={`rounded px-2.5 py-1.5 text-xs transition-colors ${
              active
                ? "bg-surface-2 font-semibold text-ink ring-1 ring-inset ring-line"
                : "font-medium text-ink-muted hover:text-ink"
            }`}
          >
            {agent.label}
          </Link>
        );
      })}
    </div>
  );
}
