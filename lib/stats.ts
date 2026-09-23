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

/**
 * Ties count as "at least as extreme" in a permutation test. Both implementations compare with
 * the same slack so a value that is equal up to floating-point noise is counted the same way in
 * TypeScript and in Python — otherwise the two languages publish different p-values.
 */
export const TIE_EPSILON = 1e-12;

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
 * Percentile bootstrap over arbitrary records, resampled with replacement and ordered by a
 * caller-supplied key before any draw is made.
 *
 * A new function rather than a generalisation of bootstrapCI: bootstrapCI is typed Pair[],
 * orders by (x, y), and its output is pinned in the vector file, so it cannot change shape. This
 * one exists for statistics over site rows that carry more than two numbers (a paired delta
 * needs both arms' counts), and its canonical order is the site id, compared bytewise, because
 * that is the only key such rows share. The key must be unique: two rows under one key would
 * make the draw sequence depend on their arrival order, which is the thing the sort prevents.
 *
 * Same PRNG, same seed, same percentile method as bootstrapCI, so the interval it prints is the
 * same kind of interval the page already prints. Null when the statistic is not computable on
 * the full set or on any resample.
 */
export function bootstrapRows<T>(
  rows: T[],
  key: (row: T) => string,
  statistic: (rows: T[]) => number | null,
  options: { iterations?: number; seed?: number; level?: number } = {}
): BootstrapResult | null {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const seed = options.seed ?? DEFAULT_SEED;
  const level = options.level ?? 0.95;

  const point = statistic(rows);
  if (point === null) return null;

  const keyed = rows.map((row) => ({ key: key(row), row }));
  const seen = new Set<string>();
  for (const { key: k } of keyed) {
    if (seen.has(k)) throw new Error(`bootstrapRows: duplicate key "${k}"`);
    seen.add(k);
  }
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const ordered = keyed.map((entry) => entry.row);

  const n = ordered.length;
  const random = mulberry32(seed);
  const draws: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    const sample = new Array<T>(n);
    for (let k = 0; k < n; k++) sample[k] = ordered[Math.floor(random() * n)];
    const value = statistic(sample);
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

// ===========================================================================
// Sub-audit attribution
//
// A Lighthouse sub-audit is a 0/1 split of the same sites, so the question "what does passing
// this audit buy?" has a direct estimand: the difference in mean site success rate between the
// two groups. Everything below exists to keep that number from being read as more than it is —
// the interval, the permutation test that sets the wording, the correction for looking at six
// of them, and the arithmetic that says what this cohort could have detected at all.
// ===========================================================================

// ---------------------------------------------------------------------------
// The estimand
// ---------------------------------------------------------------------------

/**
 * Difference in mean y between the x=1 and x=0 groups, in the same units as y.
 *
 * Null when either group is empty — and *only* then. A bootstrap resample that happens to draw
 * one or two passing sites is a legitimate draw and must be kept; screening resamples by group
 * size would bias the interval. The reporting gate lives in subAuditGap, one level up.
 */
export function meanGap(pairs: Pair[]): number | null {
  let sumOnes = 0;
  let sumZeros = 0;
  let ones = 0;
  let zeros = 0;
  for (const p of pairs) {
    if (p.x === 1) {
      sumOnes += p.y;
      ones++;
    } else if (p.x === 0) {
      sumZeros += p.y;
      zeros++;
    }
  }
  if (ones === 0 || zeros === 0) return null;
  return sumOnes / ones - sumZeros / zeros;
}

export interface SubAuditGap {
  groups: { ones: number; zeros: number };
  /** Percentage points, as a fraction: +0.41 is "41 points more successful". */
  gap: number;
  /** Point-biserial r, for continuity with the composite correlation. */
  r: number | null;
  /** Marginal interval at 1 - alpha. */
  ci: BootstrapResult;
  /** Simultaneous interval at 1 - alpha/familySize (Bonferroni on the interval level). */
  simultaneous: BootstrapResult;
}

/**
 * The reporting-level wrapper. Null when min(ones, zeros) < MIN_GROUP.
 *
 * The gate is on the OBSERVED split and is decided from group sizes alone, never from the
 * outcome. In v1 exactly one site passes WebMCP, and the bootstrap on that split returns an
 * interval that excludes zero in *opposite directions* for the two agents; see
 * simulateFalsePositiveRate, which measures how often that procedure fires under a true null.
 */
export function subAuditGap(
  pairs: Pair[],
  options: { familySize?: number; alpha?: number; seed?: number; iterations?: number } = {}
): SubAuditGap | null {
  const familySize = options.familySize ?? 1;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? DEFAULT_SEED;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  const groups = binaryGroupSizes(pairs);
  if (Math.min(groups.ones, groups.zeros) < MIN_GROUP) return null;

  const ci = bootstrapCI(pairs, meanGap, { iterations, seed, level: 1 - alpha });
  const simultaneous = bootstrapCI(pairs, meanGap, {
    iterations,
    seed,
    level: 1 - alpha / familySize,
  });
  if (ci === null || simultaneous === null) return null;

  return { groups, gap: ci.point, r: pearson(pairs), ci, simultaneous };
}

// ---------------------------------------------------------------------------
// Permutation inference over a family of comparisons
// ---------------------------------------------------------------------------

/**
 * Fisher-Yates over 0..n-1, drawing from the supplied generator.
 *
 * Descending i, index `floor(random() * (i + 1))`. The exact draw order is part of the
 * cross-language contract — scripts/tests/stats-vectors.json pins the first shuffles as integer
 * arrays, because a subtly different swap order would leave every downstream p-value looking
 * plausible and silently disagreeing between the page and the reference implementation.
 */
export function shuffleIndices(n: number, random: () => number): number[] {
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = indices[i];
    indices[i] = indices[j];
    indices[j] = swap;
  }
  return indices;
}

export interface ComparisonInput {
  /** Stable id, e.g. "gemini-3.6-flash|lh_llms_txt". */
  key: string;
  /** Shared site order; identical across members. The permutation key. */
  siteIds: string[];
  /** 0/1 per site. */
  predictor: number[];
  /** Outcome per site — a success rate. */
  outcome: number[];
  /**
   * Optional block labels. When present the shuffle is restricted to within-block, which tests
   * "does this audit buy anything on top of the block?" rather than "is this audit associated
   * with success at all?". In v1 the block is the cohort design tier.
   */
  strata?: string[];
}

export interface ComparisonResult {
  key: string;
  /** |statistic| as measured. */
  observed: number;
  /** One comparison in isolation. Uncorrected: it ignores that five others were looked at. */
  pUnadjusted: number;
  /** Westfall-Young maxT: corrected for the whole family in one step. */
  pFamilyWise: number;
}

export interface FamilyPermutation {
  comparisons: ComparisonResult[];
  /** m — the number of comparisons the correction covers. Printed on the page in words. */
  size: number;
  iterations: number;
  /** Iterations that produced a computable statistic for every member. */
  used: number;
  level: number;
  /** |statistic| a member needed to clear the family-wise level. */
  criticalValue: number;
  seed: number;
  /** Whether the shuffle was restricted to within-block. */
  stratified: boolean;
}

/**
 * Westfall-Young maxT permutation test over a family of comparisons.
 *
 * ONE shuffle per iteration, applied to every member's outcome vector. Shuffling members
 * independently would destroy the correlation between them — the same 27 sites appear in all
 * six comparisons, and two of the audits overlap heavily — and that correlation is exactly what
 * a max-statistic correction exploits to be less conservative than Bonferroni.
 *
 * Members are put in a canonical order first: the shared site index is sorted by site id. A
 * permutation moves outcomes *between* sites, so every member has to agree on which site is
 * index 0, and the site id is the only stable key they share. (bootstrapCI sorts by (x, y)
 * instead — it can't sort by site id, since Pair carries none, and for a bootstrap it doesn't
 * need to: resampled pairs are interchangeable. Same principle, different mechanism.)
 *
 * Returns null for an empty family. Throws on a structural precondition violation: mismatched
 * lengths, mismatched site ids, or a member whose observed statistic is not computable. Those
 * are programming errors, and rendering "not enough data" over a programming error would itself
 * be an invented measurement.
 */
export function permutationFamily(
  inputs: ComparisonInput[],
  statistic: (predictor: number[], outcome: number[]) => number | null,
  options: { iterations?: number; seed?: number; level?: number } = {}
): FamilyPermutation | null {
  if (inputs.length === 0) return null;

  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const seed = options.seed ?? DEFAULT_SEED;
  const level = options.level ?? 0.05;

  const siteIds = inputs[0].siteIds;
  const n = siteIds.length;
  const stratified = inputs[0].strata !== undefined;

  for (const input of inputs) {
    if (input.predictor.length !== n || input.outcome.length !== n || input.siteIds.length !== n) {
      throw new Error(
        `permutationFamily: member "${input.key}" has ${input.siteIds.length} sites / ` +
          `${input.predictor.length} predictors / ${input.outcome.length} outcomes, expected ${n}`
      );
    }
    for (let i = 0; i < n; i++) {
      if (input.siteIds[i] !== siteIds[i]) {
        throw new Error(
          `permutationFamily: member "${input.key}" site ${i} is "${input.siteIds[i]}", ` +
            `expected "${siteIds[i]}" — the family must describe the same sites`
        );
      }
    }
    if ((input.strata !== undefined) !== stratified) {
      throw new Error(
        `permutationFamily: member "${input.key}" ${input.strata ? "has" : "is missing"} strata ` +
          `while the family ${stratified ? "is" : "is not"} stratified`
      );
    }
  }

  // Canonical order, by site id.
  const order = siteIds.map((_, i) => i).sort((a, b) => (siteIds[a] < siteIds[b] ? -1 : 1));
  const members = inputs.map((input) => ({
    key: input.key,
    predictor: order.map((i) => input.predictor[i]),
    outcome: order.map((i) => input.outcome[i]),
  }));
  const strata = stratified ? order.map((i) => inputs[0].strata![i]) : null;

  const observed = members.map((m) => {
    const value = statistic(m.predictor, m.outcome);
    if (value === null) {
      throw new Error(
        `permutationFamily: member "${m.key}" has no computable statistic — a family must not ` +
          `contain a comparison the estimator refuses`
      );
    }
    return Math.abs(value);
  });

  // Blocks for a stratified shuffle, keyed in label order so the layout is deterministic.
  let blocks: number[][] | null = null;
  if (strata !== null) {
    const byLabel = new Map<string, number[]>();
    strata.forEach((label, i) => {
      const arr = byLabel.get(label) ?? [];
      arr.push(i);
      byLabel.set(label, arr);
    });
    blocks = [...byLabel.keys()].sort().map((label) => byLabel.get(label)!);
  }

  const random = mulberry32(seed);
  const maxima: number[] = [];
  const atLeastAsExtreme = new Array<number>(members.length).fill(0);
  const atLeastAsExtremeFamily = new Array<number>(members.length).fill(0);
  let used = 0;

  for (let iter = 0; iter < iterations; iter++) {
    let permutation: number[];
    if (blocks === null) {
      permutation = shuffleIndices(n, random);
    } else {
      permutation = new Array<number>(n);
      for (const block of blocks) {
        const within = shuffleIndices(block.length, random);
        for (let pos = 0; pos < block.length; pos++) permutation[block[pos]] = block[within[pos]];
      }
    }

    const statistics: number[] = [];
    let computable = true;
    for (const member of members) {
      const permuted = permutation.map((source) => member.outcome[source]);
      const value = statistic(member.predictor, permuted);
      if (value === null) {
        computable = false;
        break;
      }
      statistics.push(Math.abs(value));
    }
    if (!computable) continue;

    used++;
    let maximum = statistics[0];
    for (const value of statistics) if (value > maximum) maximum = value;
    maxima.push(maximum);

    for (let j = 0; j < members.length; j++) {
      if (statistics[j] >= observed[j] - TIE_EPSILON) atLeastAsExtreme[j]++;
      if (maximum >= observed[j] - TIE_EPSILON) atLeastAsExtremeFamily[j]++;
    }
  }

  if (used === 0) return null;
  maxima.sort((a, b) => a - b);

  return {
    comparisons: members.map((m, j) => ({
      key: m.key,
      observed: observed[j],
      // (count + 1) / (used + 1): the observed arrangement is one of the permutations, so a p
      // is never reported as exactly zero off a finite number of draws.
      pUnadjusted: (atLeastAsExtreme[j] + 1) / (used + 1),
      pFamilyWise: (atLeastAsExtremeFamily[j] + 1) / (used + 1),
    })),
    size: members.length,
    iterations,
    used,
    level,
    criticalValue: percentile(maxima, 1 - level),
    seed,
    stratified,
  };
}

/**
 * What a family-wise p licenses saying about one comparison. Lives next to relationshipVerdict
 * so the wording is decided in one place — and the wording is never "predicts" or "does not
 * predict": see maximumAttainableGap for why this cohort cannot support either claim.
 */
export function subAuditVerdict(
  p: number,
  level: number
): "distinguishable" | "not-distinguishable" {
  return p <= level ? "distinguishable" : "not-distinguishable";
}

// ---------------------------------------------------------------------------
// The exact permutation null
//
// The Monte-Carlo p above is an estimate of a number that is, for this statistic, exactly
// computable: meanGap is monotone in the sum of the passing group, so enumerating C(n, k)
// subsets reduces to counting subsets by their sum. Success rates are multiples of 1/trials, so
// the sums are integers and a subset-sum DP walks the whole null distribution.
// ---------------------------------------------------------------------------

export interface GapNullBucket {
  gap: number;
  /** How many of the C(n, k) splits produce this gap. */
  count: number;
}

/**
 * Every value the gap could take under the null, with multiplicities, ascending.
 *
 * Depends only on the MULTISET of outcomes and the group size — never on which site holds which
 * outcome. That is what makes it a null distribution, and it is why a simulation that permutes
 * the outcome vector can compute this once instead of once per replicate.
 *
 * Null when the split is degenerate or the outcomes are not multiples of 1/denominator.
 */
export function gapNullDistribution(
  outcome: number[],
  ones: number,
  denominator: number
): GapNullBucket[] | null {
  const n = outcome.length;
  const zeros = n - ones;
  if (ones < 1 || zeros < 1 || denominator < 1) return null;

  const scaled = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const value = Math.round(outcome[i] * denominator);
    if (Math.abs(value / denominator - outcome[i]) > 1e-9) return null;
    scaled[i] = value;
  }

  const total = scaled.reduce((s, v) => s + v, 0);
  // counts[size][sum] — how many subsets of that size reach that sum.
  const counts: number[][] = [];
  for (let size = 0; size <= ones; size++) counts.push(new Array<number>(total + 1).fill(0));
  counts[0][0] = 1;

  for (const value of scaled) {
    for (let size = Math.min(ones, n) - 1; size >= 0; size--) {
      const from = counts[size];
      const to = counts[size + 1];
      for (let sum = total - value; sum >= 0; sum--) {
        const c = from[sum];
        if (c !== 0) to[sum + value] += c;
      }
    }
  }

  const buckets: GapNullBucket[] = [];
  for (let sum = 0; sum <= total; sum++) {
    const count = counts[ones][sum];
    if (count === 0) continue;
    buckets.push({
      gap: sum / denominator / ones - (total - sum) / denominator / zeros,
      count,
    });
  }
  return buckets;
}

export interface ExactGapP {
  p: number;
  /** C(n, k) — the size of the exact null. */
  splits: number;
  /** Splits at least as extreme as the observed one, in either direction. */
  extreme: number;
}

/** Exact two-sided permutation p for meanGap. Null when it is not enumerable. */
export function exactGapP(
  predictor: number[],
  outcome: number[],
  denominator: number
): ExactGapP | null {
  const ones = predictor.filter((x) => x === 1).length;
  const zeros = predictor.filter((x) => x === 0).length;
  if (ones + zeros !== predictor.length) return null;

  const observed = meanGap(predictor.map((x, i) => ({ x, y: outcome[i] })));
  if (observed === null) return null;

  const buckets = gapNullDistribution(outcome, ones, denominator);
  if (buckets === null) return null;

  return pFromNull(buckets, observed);
}

/** Two-sided p of one observed gap against a precomputed null. */
export function pFromNull(buckets: GapNullBucket[], observed: number): ExactGapP {
  let splits = 0;
  let extreme = 0;
  for (const bucket of buckets) {
    splits += bucket.count;
    if (Math.abs(bucket.gap) >= Math.abs(observed) - TIE_EPSILON) extreme += bucket.count;
  }
  return { p: extreme / splits, splits, extreme };
}

/**
 * The smallest exact p ANY split of this size could have produced on this outcome vector.
 *
 * When that floor is above the level, the comparison is not merely unresolved — it is
 * unfalsifiable. No arrangement of the data, including the one that would have looked most
 * convincing, could have cleared the bar. "Not enough sites" invites "so run more trials";
 * this says the question was unanswerable as posed.
 */
export function minimumAttainableP(
  predictor: number[],
  outcome: number[],
  denominator: number
): number | null {
  const ones = predictor.filter((x) => x === 1).length;
  const buckets = gapNullDistribution(outcome, ones, denominator);
  if (buckets === null) return null;

  let mostExtreme = 0;
  for (const bucket of buckets) mostExtreme = Math.max(mostExtreme, Math.abs(bucket.gap));
  return pFromNull(buckets, mostExtreme).p;
}

// ---------------------------------------------------------------------------
// The exact within-site rerandomization null
//
// Two arms measured on the same sites (two agents, or one agent twice). Conditioning on each
// site's total successes over both arms, the only randomness left under the null is which of
// those successes fell in arm 2, which is hypergeometric per site and independent across sites.
// The statistic is a sum over sites, so its null distribution is the convolution of the per-site
// pmfs, exactly enumerable with no seed. Same shape as gapNullDistribution, but with weights:
// the product of the per-site table counts overflows 2^53 long before 27 sites, so the pmf is
// carried as floats from the start, in a fixed operation order on both sides of the contract.
// ---------------------------------------------------------------------------

export interface RerandomizationCell {
  site_id: string;
  /** Arm 1 successes and trials. */
  k1: number;
  n1: number;
  /** Arm 2 successes and trials. */
  k2: number;
  n2: number;
}

/**
 * "sum": T = sum over sites of (N * x - n2 * s) / g, arm 2's deviation from its conditional
 * expectation; two-sided, and at equal arms it reduces to n * sum(k2 - k1). Words the shift.
 * "dispersion": D = sum of the squared terms; one-sided, since retest drift has no sign.
 */
export type RerandomizationKind = "sum" | "dispersion";

export interface RerandomizationNull {
  kind: RerandomizationKind;
  /** g, the gcd over sites of gcd(N, n2), which keeps every term an integer. */
  scale: number;
  /** The statistic value at pmf index 0. */
  min: number;
  /** pmf[i] = P(T = min + i). Dense, so unreachable values in between carry exactly 0. */
  pmf: number[];
  /** Sites whose total was strictly between 0 and N, the only ones that carry any randomness. */
  informative: number;
  sites: number;
}

/** Exact binomial coefficient. Every intermediate is an integer, exact below 2^53. */
export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const j = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= j; i++) result = (result * (n - j + i)) / i;
  return result;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Cells in canonical order, validated. Throws on a malformed cell: that is a programming error. */
function canonicalCells(cells: RerandomizationCell[]): RerandomizationCell[] {
  const ordered = [...cells].sort((a, b) =>
    a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0
  );
  for (const c of ordered) {
    const whole = [c.k1, c.n1, c.k2, c.n2].every((v) => Number.isInteger(v) && v >= 0);
    if (!whole || c.k1 > c.n1 || c.k2 > c.n2) {
      throw new Error(`rerandomization: malformed cell for "${c.site_id}"`);
    }
  }
  return ordered.filter((c) => c.n1 + c.n2 > 0);
}

/** g over the cells that carry trials. 0 when there are none. */
function rerandomizationScale(cells: RerandomizationCell[]): number {
  let g = 0;
  for (const c of cells) g = gcd(g, gcd(c.n1 + c.n2, c.n2));
  return g;
}

/** The observed statistic on the same integer scale as the null. Null when no cell has trials. */
export function rerandomizationStatistic(
  cells: RerandomizationCell[],
  kind: RerandomizationKind
): { value: number; scale: number } | null {
  const ordered = canonicalCells(cells);
  if (ordered.length === 0) return null;
  const g = rerandomizationScale(ordered);
  let total = 0;
  for (const c of ordered) {
    const term = ((c.n1 + c.n2) * c.k2 - c.n2 * (c.k1 + c.k2)) / g;
    total += kind === "sum" ? term : term * term;
  }
  return { value: total, scale: g };
}

/**
 * The exact null of the statistic, convolved site by site in ascending site-id order, each
 * site's terms in ascending x. The per-site probabilities are exact comb ratios converted to a
 * float once; both comb values and their product are exact integers up to N = 52 per site, so
 * the division is correctly rounded and identical in both languages.
 *
 * Null when there are no cells with trials, or when every site's total is 0 or N: then the
 * null has a single point and no test exists.
 */
export function rerandomizationNull(
  cells: RerandomizationCell[],
  kind: RerandomizationKind
): RerandomizationNull | null {
  const ordered = canonicalCells(cells);
  if (ordered.length === 0) return null;
  const g = rerandomizationScale(ordered);

  let min = 0;
  let pmf: number[] = [1];
  let informative = 0;

  for (const c of ordered) {
    const s = c.k1 + c.k2;
    const N = c.n1 + c.n2;
    if (s === 0 || s === N) continue; // a point mass at zero: convolving it changes nothing
    informative++;

    const lo = Math.max(0, s - c.n1);
    const hi = Math.min(c.n2, s);
    const denominator = comb(N, s);
    const terms: number[] = [];
    const probabilities: number[] = [];
    for (let x = lo; x <= hi; x++) {
      const term = (N * x - c.n2 * s) / g;
      terms.push(kind === "sum" ? term : term * term);
      probabilities.push((comb(c.n2, x) * comb(c.n1, s - x)) / denominator);
    }

    let termMin = terms[0];
    let termMax = terms[0];
    for (const t of terms) {
      if (t < termMin) termMin = t;
      if (t > termMax) termMax = t;
    }

    const next = new Array<number>(pmf.length + (termMax - termMin)).fill(0);
    for (let i = 0; i < pmf.length; i++) {
      const p = pmf[i];
      if (p === 0) continue;
      for (let j = 0; j < terms.length; j++) {
        next[i + (terms[j] - termMin)] += p * probabilities[j];
      }
    }
    min += termMin;
    pmf = next;
  }

  if (informative === 0) return null;
  return { kind, scale: g, min, pmf, informative, sites: ordered.length };
}

/**
 * p of an observed statistic against the exact null. Two-sided on |T| for the sum, one-sided
 * (large D) for the dispersion, with TIE_EPSILON slack so a tie counts as at least as extreme.
 */
export function pFromRerandomization(distribution: RerandomizationNull, observed: number): number {
  let p = 0;
  for (let i = 0; i < distribution.pmf.length; i++) {
    const value = distribution.min + i;
    const extreme =
      distribution.kind === "sum"
        ? Math.abs(value) >= Math.abs(observed) - TIE_EPSILON
        : value >= observed - TIE_EPSILON;
    if (extreme) p += distribution.pmf[i];
  }
  // A pmf that sums to 1 in exact arithmetic can sum to 1 + 2e-16 in floats; a p is at most 1.
  return Math.min(1, p);
}

/**
 * The smallest p any arrangement of these cells could reach: the p at the extreme of the
 * support. Above the level, no outcome of the comparison could have cleared it.
 */
export function minAttainableRerandomizationP(distribution: RerandomizationNull): number {
  const max = distribution.min + distribution.pmf.length - 1;
  const extreme =
    distribution.kind === "sum" ? Math.max(Math.abs(distribution.min), Math.abs(max)) : max;
  return pFromRerandomization(distribution, extreme);
}

// ---------------------------------------------------------------------------
// What this cohort could have detected
//
// The critical value alone is a 50%-power threshold: the gap at which a study of this shape
// clears the bar half the time. Publishing it as a "minimum detectable effect" understates the
// sample size a follow-up needs by a factor of 1.85, so the three numbers travel together —
// critical value, the gap needed for real power, and the largest gap that is arithmetically
// possible at all.
// ---------------------------------------------------------------------------

/**
 * The largest gap the arithmetic permits, given the group sizes and the overall mean.
 *
 * Success rates cannot exceed 100%, so pinning the passing group at the ceiling forces the
 * failing group down to whatever keeps the total fixed. On a 6-of-27 split at a 51% overall
 * rate that caps the gap at 63 points — which can be *below* the gap an 80%-powered test would
 * need, in which case no audit of that shape was detectable in this cohort at any effect size.
 */
export function maximumAttainableGap(
  ones: number,
  zeros: number,
  overallMean: number
): number | null {
  if (ones < 1 || zeros < 1) return null;
  const total = overallMean * (ones + zeros);
  const passMean = Math.min(1, total / ones);
  const failMean = (total - ones * passMean) / zeros;
  return passMean - failMean;
}

/**
 * Arithmetic mean, accumulated left to right.
 *
 * Written out rather than reduced over a built-in for a reason that cost a debugging session:
 * Python 3.12's sum() applies Neumaier compensation to float sequences and JavaScript does not,
 * so the two languages disagree in the last bit — enough to flip a bootstrap draw's comparison
 * against zero and move a simulated false-positive count by one. Every mirrored accumulation in
 * this file adds naively, in order, on both sides.
 */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Median; an even count takes the mean of the middle two. Null on an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample (n-1) standard deviation. */
export function standardDeviation(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const centre = mean(values)!;
  let sum = 0;
  for (const value of values) sum += (value - centre) ** 2;
  return Math.sqrt(sum / (n - 1));
}

/**
 * Standard error of the gap: sd(outcome) * sqrt(1/n1 + 1/n0), on the sample (n-1) variance.
 *
 * The sample variance, not the population one — the outcome vector is a sample of websites, and
 * the published 80%-power threshold moves if this switches.
 */
export function gapStandardError(outcome: number[], ones: number, zeros: number): number | null {
  if (outcome.length < 2 || ones < 1 || zeros < 1) return null;
  return standardDeviation(outcome)! * Math.sqrt(1 / ones + 1 / zeros);
}

/** The gap needed for `power` chance of clearing `criticalValue`. */
export function powerThreshold(criticalValue: number, se: number, power: number): number {
  return criticalValue + normalQuantile(power) * se;
}

/**
 * Sites needed to reach `power` against a true gap, scaling the observed family-wise critical
 * value as sqrt(1/n1 + 1/n0). Both the threshold and the standard error scale the same way, so
 * the whole requirement scales as 1/n and inverts cleanly.
 *
 * Returns a real number; the caller rounds up. Reported as "roughly n", because the input sd is
 * itself estimated from 27 sites.
 */
export function sitesForGap(args: {
  gap: number;
  /** Fraction of sites expected to pass the audit. 0.5 is a balanced design. */
  prevalence: number;
  power: number;
  criticalValue: number;
  referenceOnes: number;
  referenceZeros: number;
  sd: number;
}): number | null {
  const { gap, prevalence, power, criticalValue, referenceOnes, referenceZeros, sd } = args;
  if (gap <= 0 || prevalence <= 0 || prevalence >= 1) return null;
  const reference = 1 / referenceOnes + 1 / referenceZeros;
  // threshold(n) = k * sqrt(1/n1 + 1/n0), with k independent of n.
  const k = criticalValue / Math.sqrt(reference) + normalQuantile(power) * sd;
  const unit = 1 / prevalence + 1 / (1 - prevalence); // (1/n1 + 1/n0) * n
  return (k / gap) ** 2 * unit;
}

// ---------------------------------------------------------------------------
// The wrong test, kept as an exhibit
//
// Counting trials instead of sites turns 5 trials on one website into 5 independent
// observations. The page prints what that does, because the number is more persuasive than any
// paragraph about clustering: on v1's llms.txt split it is the difference between p = 5e-8 and
// p = 0.03.
// ---------------------------------------------------------------------------

export interface TwoProportionTest {
  z: number;
  p: number;
}

/** Pooled two-proportion z test on RAW COUNTS. Deliberately the wrong unit of analysis. */
export function twoProportionZ(
  successes1: number,
  n1: number,
  successes0: number,
  n0: number
): TwoProportionTest | null {
  if (n1 < 1 || n0 < 1) return null;
  const pooled = (successes1 + successes0) / (n1 + n0);
  if (pooled <= 0 || pooled >= 1) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n0));
  if (se === 0) return null;
  const z = (successes1 / n1 - successes0 / n0) / se;
  return { z, p: erfc(Math.abs(z) / Math.SQRT2) };
}

// ---------------------------------------------------------------------------
// Normal distribution helpers
//
// Both are implemented rather than borrowed so the two languages run the identical algorithm:
// Python's math.erfc and statistics.NormalDist would agree to about 15 digits with a different
// approximation, and "about" is not what a cross-language contract pinned to 12 digits means.
// ---------------------------------------------------------------------------

/** Inverse standard normal CDF. Wichura's AS 241 (PPND16), accurate to ~1e-16. */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  const q = p - 0.5;

  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((5226.495278852854561 * r + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1)
    );
  }

  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let value: number;

  if (r <= 5) {
    r -= 1.6;
    value =
      (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r +
        0.24178072517745061177) *
        r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
        1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r +
        0.0151986665636164571966) *
        r +
        0.14810397642748007459) *
        r +
        0.68976733498510000455) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
        1);
  } else {
    r -= 5;
    value =
      (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r +
        0.0012426609473880784386) *
        r +
        0.026532189526576123093) *
        r +
        0.29656057182850489123) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
        6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r +
        1.8463183175100546818e-5) *
        r +
        7.868691311456132591e-4) *
        r +
        0.0148753612908506148525) *
        r +
        0.13692988092273580531) *
        r +
        0.59983220655588793769) *
        r +
        1);
  }

  return q < 0 ? -value : value;
}

/**
 * Complementary error function. Maclaurin series below 2, modified-Lentz continued fraction
 * above it — both iterated to double precision, so the algorithm (not a table of constants) is
 * what the Python mirror reproduces.
 */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;

  if (x < 2) {
    let term = x;
    let sum = x;
    for (let k = 1; k < 400; k++) {
      term *= (-x * x) / k;
      const add = term / (2 * k + 1);
      sum += add;
      if (Math.abs(add) <= 1e-18 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }

  const tiny = 1e-300;
  let f = x;
  let c = f;
  let d = 0;
  for (let k = 1; k < 400; k++) {
    const a = k / 2;
    d = x + a * d;
    if (d === 0) d = tiny;
    c = x + a / c;
    if (c === 0) c = tiny;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) <= 1e-16) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
}

// ---------------------------------------------------------------------------
// Calibration by simulation
//
// Two questions no amount of prose settles: how often does each procedure fire when nothing is
// there, and how much power would a bigger cohort actually buy. Both are Monte Carlo, both are
// seeded, and both are slow enough that their results are frozen as constants (see
// lib/sub-audits.ts) rather than recomputed on every page render.
// ---------------------------------------------------------------------------

export interface FalsePositiveRates {
  /** How often the bootstrap interval excluded zero when the null was true. */
  bootstrap: number;
  /** How often the exact permutation p cleared the level when the null was true. */
  permutation: number;
  replicates: number;
  iterations: number;
}

/**
 * False-positive rate of both procedures at a given split, against a true null.
 *
 * The null is built by permuting the real outcome vector, so the outcome distribution is v1's
 * own — bimodal, 5 trials per site, all of it — and only the association is destroyed. Anything
 * either procedure reports is by construction a false positive.
 *
 * The exact permutation null is computed once: permuting the outcomes cannot change their
 * multiset, and the null distribution depends on nothing else.
 */
export function simulateFalsePositiveRate(args: {
  outcome: number[];
  ones: number;
  replicates: number;
  seed: number;
  iterations: number;
  level: number;
  denominator: number;
}): FalsePositiveRates | null {
  const { outcome, ones, replicates, seed, iterations, level, denominator } = args;
  const n = outcome.length;
  const buckets = gapNullDistribution(outcome, ones, denominator);
  if (buckets === null) return null;

  const random = mulberry32(seed);
  let bootstrapHits = 0;
  let bootstrapUsed = 0;
  let permutationHits = 0;

  for (let replicate = 0; replicate < replicates; replicate++) {
    const order = shuffleIndices(n, random);
    const pairs: Pair[] = order.map((source, i) => ({
      x: i < ones ? 1 : 0,
      y: outcome[source],
    }));

    // A fresh seed per replicate: reusing one would correlate every replicate's resample draws.
    const ci = bootstrapCI(pairs, meanGap, { iterations, seed: seed + replicate, level: 1 - level });
    if (ci !== null) {
      bootstrapUsed++;
      if (relationshipVerdict(ci) !== "none") bootstrapHits++;
    }

    const gap = meanGap(pairs);
    if (gap !== null && pFromNull(buckets, gap).p <= level) permutationHits++;
  }

  if (bootstrapUsed === 0) return null;
  return {
    bootstrap: bootstrapHits / bootstrapUsed,
    permutation: permutationHits / replicates,
    replicates,
    iterations,
  };
}

export interface PowerSimulation {
  power: number;
  /** Mean gap actually realized — below `effect` whenever the ceiling bites. */
  meanGap: number;
  /** The family-wise critical value scaled to this design. */
  criticalValue: number;
  replicates: number;
}

/**
 * Power of the family-wise decision rule at a design size, using v1's own outcome distribution.
 *
 * Site base rates are drawn from the empirical distribution; passing the audit adds `effect` to
 * a site's success PROBABILITY, capped at 100%; then `trials` Bernoulli draws per site. The cap
 * is not a modelling nicety — it is the same ceiling that makes maximumAttainableGap bind. With
 * three quarters of v1's sites already at exactly 0% or 100%, a nominal 30-point audit delivers
 * a realized gap closer to 17 points, and the analytic sizing is an optimistic floor.
 */
export function simulatePower(args: {
  baseRates: number[];
  ones: number;
  zeros: number;
  effect: number;
  trials: number;
  replicates: number;
  seed: number;
  criticalValue: number;
  referenceOnes: number;
  referenceZeros: number;
}): PowerSimulation | null {
  const {
    baseRates,
    ones,
    zeros,
    effect,
    trials,
    replicates,
    seed,
    criticalValue,
    referenceOnes,
    referenceZeros,
  } = args;
  if (baseRates.length === 0 || ones < 1 || zeros < 1 || trials < 1) return null;

  const n = ones + zeros;
  const scaled =
    criticalValue *
    Math.sqrt((1 / ones + 1 / zeros) / (1 / referenceOnes + 1 / referenceZeros));
  const random = mulberry32(seed);
  let hits = 0;
  let gapTotal = 0;

  for (let replicate = 0; replicate < replicates; replicate++) {
    let sumOnes = 0;
    let sumZeros = 0;
    for (let i = 0; i < n; i++) {
      const base = baseRates[Math.floor(random() * baseRates.length)];
      const rate = i < ones ? Math.min(1, base + effect) : base;
      let successes = 0;
      for (let t = 0; t < trials; t++) if (random() < rate) successes++;
      if (i < ones) sumOnes += successes / trials;
      else sumZeros += successes / trials;
    }
    const gap = sumOnes / ones - sumZeros / zeros;
    gapTotal += gap;
    if (Math.abs(gap) > scaled) hits++;
  }

  return {
    power: hits / replicates,
    meanGap: gapTotal / replicates,
    criticalValue: scaled,
    replicates,
  };
}
