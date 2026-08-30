// Which slice of the append-only result tables this deployment publishes.
//
// Both result tables are keyed by batch_label, so a smoke run and a published run coexist
// without polluting each other. Bump ACTIVE_BATCH deliberately: per docs/METHODOLOGY.md a
// changed agent loop forks the dataset (new agent_id or batch), it is never amended in place.

export const ACTIVE_BATCH = process.env.ACTIVE_BATCH ?? "dev";

export interface PublishedAgent {
  id: string;
  /** Short label for the toggle. */
  label: string;
  /** Why this agent is in the panel — shown next to the numbers it produced. */
  note: string;
}

// The v1 panel: two models behind one frozen loop, so the gap between them is a property of
// the agent rather than of the harness. Both datasets are imported; the toggle selects which
// one a page reads, and the first entry is the headline.
export const PUBLISHED_AGENTS: PublishedAgent[] = [
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    note: "the cheap tier most production agent traffic actually runs on",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    note: "the stronger model, identical loop and prompt",
  },
];

// The headline agent of the v1 panel: the lite tier is what production agent traffic
// actually runs, and its failures are the discriminative signal. gemini-3.6-flash runs
// the identical loop as a second agent_id; select it here (or via env) to publish it.
export const ACTIVE_AGENT_ID = process.env.ACTIVE_AGENT_ID ?? PUBLISHED_AGENTS[0].id;

// Fixtures are opt-in and nothing else — never a fallback for a misconfigured backend.
// Exported here because the UI has to know: the fixture set is single-agent, so the agent
// toggle must render disabled rather than offer a comparison that does not exist.
export const USING_FIXTURES = process.env.USE_FAKE_DATA === "true";

/**
 * Resolve an `?agent=` query parameter against the published panel.
 *
 * An unrecognised value falls back to the headline agent instead of 404ing: a bad link
 * should show the published result, never an empty page that reads as "0% measured".
 */
export function resolveAgentId(requested?: string | string[] | null): string {
  const value = Array.isArray(requested) ? requested[0] : requested;
  if (!value) return ACTIVE_AGENT_ID;
  const known = [ACTIVE_AGENT_ID, ...PUBLISHED_AGENTS.map((a) => a.id)];
  return known.includes(value) ? value : ACTIVE_AGENT_ID;
}

/** Display label for an agent id, falling back to the raw id for anything unlisted. */
export function agentLabel(agentId: string): string {
  return PUBLISHED_AGENTS.find((a) => a.id === agentId)?.label ?? agentId;
}

/** Preserve the selected agent across internal links; the headline agent stays a clean URL. */
export function withAgent(href: string, agentId: string): string {
  if (agentId === ACTIVE_AGENT_ID) return href;
  return `${href}${href.includes("?") ? "&" : "?"}agent=${encodeURIComponent(agentId)}`;
}
