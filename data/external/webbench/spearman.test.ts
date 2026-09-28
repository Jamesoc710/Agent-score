import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ITERATIONS, DEFAULT_SEED, bootstrapCI, spearmanRho, type Pair } from "../../../lib/stats";

// The WebBench exhibit: Spearman of a site's pooled rate against its READ share, over sites with
// 30 or more trials of every task type. analyze.py computes it with scripts/stats_reference.py;
// this recomputes it from trials.csv with lib/stats.ts, so the committed rho and interval hold in
// both languages. Nothing here is rendered on a page.

const HERE = __dirname;
const PRECISION = 12;

interface NaivePair {
  site: string;
  trials: number;
  successes: number;
  read_trials: number;
  read_share: number;
  rate: number;
}

interface Exhibit {
  threshold: number;
  sites: number;
  spearman: {
    x: string;
    y: string;
    rho: number;
    lo: number;
    hi: number;
    used: number;
    iterations: number;
    seed: number;
    level: number;
  };
  pairs: NaivePair[];
}

const exhibit = (JSON.parse(readFileSync(join(HERE, "output.json"), "utf8")) as { naive_exhibit: Exhibit })
  .naive_exhibit;

function pairsFromTrials(threshold: number): NaivePair[] {
  const [header, ...lines] = readFileSync(join(HERE, "trials.csv"), "utf8").trimEnd().split("\n");
  expect(header).toBe("agent,task_id,site,category,difficulty,outcome");

  const bySite = new Map<string, { trials: number; successes: number; reads: number }>();
  for (const line of lines) {
    const [, , site, category, , outcome] = line.split(",");
    const tally = bySite.get(site) ?? { trials: 0, successes: 0, reads: 0 };
    tally.trials += 1;
    if (outcome === "Success") tally.successes += 1;
    if (category === "READ") tally.reads += 1;
    bySite.set(site, tally);
  }

  return [...bySite.entries()]
    .filter(([, t]) => t.trials >= threshold)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([site, t]) => ({
      site,
      trials: t.trials,
      successes: t.successes,
      read_trials: t.reads,
      read_share: t.reads / t.trials,
      rate: t.successes / t.trials,
    }));
}

const pairs: Pair[] = exhibit.pairs.map((p) => ({ x: p.read_share, y: p.rate }));

describe("WebBench exhibit: site rate against READ share", () => {
  it("re-derives the committed per-site pairs from trials.csv", () => {
    expect(exhibit.spearman.x).toBe("read_share");
    expect(exhibit.spearman.y).toBe("rate");
    expect(pairsFromTrials(exhibit.threshold)).toEqual(exhibit.pairs);
    expect(exhibit.pairs).toHaveLength(exhibit.sites);
  });

  it("reproduces the committed rho through lib/stats spearmanRho", () => {
    expect(spearmanRho(pairs)).toBeCloseTo(exhibit.spearman.rho, PRECISION);
  });

  it("reproduces the committed interval through lib/stats bootstrapCI", () => {
    expect(exhibit.spearman.seed).toBe(DEFAULT_SEED);
    expect(exhibit.spearman.iterations).toBe(DEFAULT_ITERATIONS);
    const ci = bootstrapCI(pairs, spearmanRho, {
      iterations: exhibit.spearman.iterations,
      seed: exhibit.spearman.seed,
      level: exhibit.spearman.level,
    })!;
    expect(ci.point).toBeCloseTo(exhibit.spearman.rho, PRECISION);
    expect(ci.lo).toBeCloseTo(exhibit.spearman.lo, PRECISION);
    expect(ci.hi).toBeCloseTo(exhibit.spearman.hi, PRECISION);
    expect(ci.used).toBe(exhibit.spearman.used);
    expect(ci.iterations).toBe(exhibit.spearman.iterations);
  });
});
