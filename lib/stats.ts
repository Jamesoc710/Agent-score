// Correlation statistics for the published result. Pure functions, no data access.
//
// Two rules run through this file, both from the project's one non-negotiable: never state a
// measurement that does not exist.
//
//  1. Anything that cannot be computed returns `null`, never `0`. A constant input vector
//     (every site scoring the same) has no correlation to report; rendering "r = 0.00" there
//     claims a measured absence of relationship that was never measured.
//  2. A correlation needs enough sites to mean anything. Below MIN_N the answer is "not
//     enough data", not a number.
//
// The bootstrap uses a seeded, portable PRNG so a published confidence interval is
// reproducible: scripts/stats_reference.py implements the identical generator and
// scripts/tests/stats-vectors.json pins the values both implementations must produce.

export interface Pair {
  x: number;
  y: number;
}

export interface Interval {
  lo: number;
  hi: number;
}

export interface BootstrapResult extends Interval {
  point: number;
  /** Resamples that yielded a computable statistic. Degenerate draws are discarded. */
  used: number;
  iterations: number;
}

/** Fewer sites than this and no correlation is reported at all. */
export const MIN_N = 3;

/** A binary split needs at least this many sites on each side to be worth reporting. */
export const MIN_GROUP = 3;

/** Fixed seed for the published intervals — the number on the page must not move between renders. */
export const DEFAULT_SEED = 20260819;

export const DEFAULT_ITERATIONS = 10000;

// ---------------------------------------------------------------------------
// Point estimates
// ---------------------------------------------------------------------------

/** Pearson r, or null when n < MIN_N or either vector is constant. */
export function pearson(pairs: Pair[]): number | null {
  const n = pairs.length;
  if (n < MIN_N) return null;

  let meanX = 0;
  let meanY = 0;
  for (const p of pairs) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let num = 0;
  let devX = 0;
  let devY = 0;
  for (const p of pairs) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    devX += dx * dx;
    devY += dy * dy;
  }

  const denom = Math.sqrt(devX * devY);
  // Zero variance on either axis: undefined, not zero.
  return denom === 0 ? null : num / denom;
}

/** Spearman rho: Pearson on average ranks (ties share the mean of their rank block). */
export function spearmanRho(pairs: Pair[]): number | null {
  if (pairs.length < MIN_N) return null;
  const xr = rankAverage(pairs.map((p) => p.x));
  const yr = rankAverage(pairs.map((p) => p.y));
  return pearson(xr.map((x, i) => ({ x, y: yr[i] })));
}

/** Ranks, 1-based, ties averaged. [10, 20, 20, 30] -> [1, 2.5, 2.5, 4] */
export function rankAverage(values: number[]): number[] {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(values.length);

  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const shared = (i + j) / 2 + 1; // 1-based mean rank of the tie block
    for (let k = i; k <= j; k++) ranks[order[k]] = shared;
    i = j + 1;
  }

  return ranks;
}

/** Least-squares fit for the trend line. Needs 2 points and non-constant x. */
export function linearRegression(pairs: Pair[]): { slope: number; intercept: number } | null {
  const n = pairs.length;
  if (n < 2) return null;

  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;

  let num = 0;
  let denom = 0;
  for (const p of pairs) {
    num += (p.x - meanX) * (p.y - meanY);
    denom += (p.x - meanX) ** 2;
  }
  if (denom === 0) return null;

  const slope = num / denom;
  return { slope, intercept: meanY - slope * meanX };
}

/** How many sites sit on each side of a 0/1 predictor — the honest denominator of a sub-audit split. */
export function binaryGroupSizes(pairs: Pair[]): { ones: number; zeros: number } {
  let ones = 0;
  let zeros = 0;
  for (const p of pairs) {
    if (p.x === 1) ones++;
    else if (p.x === 0) zeros++;
  }
  return { ones, zeros };
}

// ---------------------------------------------------------------------------
// Bootstrap confidence interval
// ---------------------------------------------------------------------------

/**
 * Percentile bootstrap over sites: resample the (site, x, y) pairs with replacement,
 * recompute the statistic, take the 2.5th/97.5th percentiles.
 *
 * Sites are the resampling unit because the site is the unit of analysis — resampling
 * trials would treat 5 trials on one site as 5 independent observations.
 *
 * Returns null when the point estimate itself is not computable.
 */
export function bootstrapCI(
  pairs: Pair[],
  statistic: (p: Pair[]) => number | null,
  options: { iterations?: number; seed?: number; level?: number } = {}
): BootstrapResult | null {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const seed = options.seed ?? DEFAULT_SEED;
  const level = options.level ?? 0.95;

  const point = statistic(pairs);
  if (point === null) return null;

  // Resample a canonically ordered copy. The draw sequence is seeded, so without this the
  // interval would depend on the order rows happened to arrive in — the leaderboard sorts by
  // success rate, the reference script by site id, and the same dataset would publish two
  // different intervals. Identical pairs are interchangeable, so this ordering is total.
  const ordered = [...pairs].sort((a, b) => a.x - b.x || a.y - b.y);

  const n = ordered.length;
  const random = mulberry32(seed);
  const draws: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    const sample = new Array<Pair>(n);
    for (let k = 0; k < n; k++) sample[k] = ordered[Math.floor(random() * n)];
    const value = statistic(sample);
    // A resample can draw the same site n times, leaving a constant vector with no
    // computable statistic. Discard it rather than substituting a zero.
    if (value !== null) draws.push(value);
  }

  if (draws.length === 0) return null;
  draws.sort((a, b) => a - b);

  const tail = (1 - level) / 2;
  return {
    point,
    lo: percentile(draws, tail),
    hi: percentile(draws, 1 - tail),
    used: draws.length,
    iterations,
  };
}

/** Linear-interpolated percentile of an ascending array (numpy's default method). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];

  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * mulberry32. Small, fast, and — the reason it is here rather than Math.random —
 * reproducible across implementations: scripts/stats_reference.py mirrors these exact
 * 32-bit operations, so a Python cross-check reproduces the published interval bit for bit.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers — one place decides how a number is worded
// ---------------------------------------------------------------------------

/**
 * What the interval actually licenses saying. A page must not describe a null result when the
 * data shows a relationship, or vice versa — so the wording is chosen from the interval, never
 * hardcoded next to the number.
 */
export function relationshipVerdict(ci: Interval): "none" | "positive" | "negative" {
  if (ci.lo <= 0 && ci.hi >= 0) return "none"; // the interval spans zero
  return ci.lo > 0 ? "positive" : "negative";
}

/** Plain-language reading of a correlation's strength. Deliberately conservative. */
export function strengthLabel(r: number): "none" | "weak" | "moderate" | "strong" {
  const a = Math.abs(r);
  if (a < 0.2) return "none";
  if (a < 0.4) return "weak";
  if (a < 0.7) return "moderate";
  return "strong";
}

/** "0.11" / "-0.03", with a real minus sign and a stable width. */
export function formatR(r: number): string {
  return r.toFixed(2);
}

/** "[-0.29, 0.48]" */
export function formatInterval(ci: Interval): string {
  return `[${formatR(ci.lo)}, ${formatR(ci.hi)}]`;
}
