import { successAcrossPages } from "./exhibit";
import { EXHIBIT } from "./exhibit-data";
import { measuredRuns } from "./runs";

// The finding cards (design S2-4 section 3). P5 ships one, `goodhart`; the other three wait for
// P10. A card's figures are read from a committed, test-re-derived artifact, never typed: the
// goodhart card reads lib/exhibit-data.ts, the fold lib/exhibit.test.ts re-derives from the
// exhibit's lane artifacts.

export const FINDING_IDS = ["goodhart"] as const;
export type FindingId = (typeof FINDING_IDS)[number];

/** The control and the gated half, by the ids registered in data/exhibit-cohort.csv. */
const CONTROL_ID = "exhibit_a";
const GATED_ID = "exhibit_b";

export interface GoodhartSide {
  site_id: string;
  name: string;
  route: string;
  successes: number;
  measured: number;
  /** Every recorded trial across both agents, agent order then trial order. */
  outcomes: ("success" | "failure" | "excluded")[];
  /** True when every successful trial reported the answer on its first step. */
  firstStep: boolean;
}

export interface GoodhartFigures {
  title: string;
  control: GoodhartSide;
  gated: GoodhartSide;
  /** The category mean both pages were measured at; null if they somehow differ. */
  sharedMean: number | null;
  agentIds: string[];
  trialsPerPage: number;
  batch: string;
  runWindow: { first: string; last: string } | null;
}

function side(siteId: string): GoodhartSide | null {
  const page = EXHIBIT.pages.find((p) => p.site.site_id === siteId);
  if (!page) return null;
  const runs = page.agents.flatMap((a) => {
    const measured = new Set(measuredRuns(a.runs));
    return a.runs.map((run) => ({ run, measured: measured.has(run) }));
  });
  const totals = successAcrossPages(EXHIBIT, siteId);
  const successes = runs.filter((r) => r.measured && r.run.success);
  return {
    site_id: siteId,
    name: page.site.name,
    route: page.route,
    successes: totals.successes,
    measured: totals.measured,
    outcomes: runs.map((r) => (!r.measured ? "excluded" : r.run.success ? "success" : "failure")),
    firstStep: successes.length > 0 && successes.every((r) => r.run.step_count === 1),
  };
}

/** Null when the committed exhibit does not hold both halves of the registered pair. */
export function goodhartFigures(): GoodhartFigures | null {
  const control = side(CONTROL_ID);
  const gated = side(GATED_ID);
  if (!control || !gated) return null;
  const means = [...new Set(EXHIBIT.pages.map((p) => p.lighthouse?.lh_total ?? null))];
  return {
    title: "Two pages with the same category mean, one the agent can use",
    control,
    gated,
    sharedMean: means.length === 1 ? means[0] : null,
    agentIds: EXHIBIT.agent_ids,
    trialsPerPage: Math.max(control.outcomes.length, gated.outcomes.length),
    batch: EXHIBIT.batch_label,
    runWindow: EXHIBIT.run_window,
  };
}

/** The glyph for one trial: filled, hollow, or a dash for a trial outside the denominator. */
export function outcomeGlyph(outcome: GoodhartSide["outcomes"][number]): string {
  return outcome === "success" ? "●" : outcome === "failure" ? "○" : "–";
}
