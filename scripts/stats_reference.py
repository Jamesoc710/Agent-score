#!/usr/bin/env python3
"""Reference implementation of lib/stats.ts, and the generator for its test vectors.

Same role scripts/scoring.py + scripts/tests/scoring-vectors.json play for the scoring
contract: the statistics the site publishes are computed independently in two languages, and
a committed vector file pins the values both must produce. If the TypeScript on the page ever
drifts from this file, `npm run test:unit` fails.

Inputs are the committed v1 artifacts (data/agent-runs-v1.jsonl, data/lighthouse-v1.json) —
the same rows that were imported into Supabase — so the vectors are the real published
dataset, not a synthetic stand-in.

    .venv/bin/python scripts/stats_reference.py            # print the v1 summary
    .venv/bin/python scripts/stats_reference.py --write    # regenerate the vector file

Regenerating is a deliberate act: the vectors encode a published result.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS_PATH = ROOT / "data" / "agent-runs-v1.jsonl"
LIGHTHOUSE_PATH = ROOT / "data" / "lighthouse-v1.json"
COHORT_PATH = ROOT / "data" / "cohort.csv"
VECTORS_PATH = ROOT / "scripts" / "tests" / "stats-vectors.json"

# Mirrors the constants in lib/stats.ts.
MIN_N = 3
MIN_GROUP = 3
DEFAULT_SEED = 20260819
DEFAULT_ITERATIONS = 10000
TIE_EPSILON = 1e-12

SUB_AUDITS = [
    "lh_accessibility_tree",
    "lh_layout_stability",
    "lh_llms_txt",
    "lh_webmcp",
]

UINT32 = 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Point estimates — algorithmically identical to lib/stats.ts, operation for operation
# ---------------------------------------------------------------------------


def pearson(pairs: list[tuple[float, float]]) -> float | None:
    n = len(pairs)
    if n < MIN_N:
        return None

    mean_x = 0.0
    mean_y = 0.0
    for x, y in pairs:
        mean_x += x
        mean_y += y
    mean_x /= n
    mean_y /= n

    num = 0.0
    dev_x = 0.0
    dev_y = 0.0
    for x, y in pairs:
        dx = x - mean_x
        dy = y - mean_y
        num += dx * dy
        dev_x += dx * dx
        dev_y += dy * dy

    denom = math.sqrt(dev_x * dev_y)
    return None if denom == 0 else num / denom


def rank_average(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)

    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1

    return ranks


def spearman_rho(pairs: list[tuple[float, float]]) -> float | None:
    if len(pairs) < MIN_N:
        return None
    xr = rank_average([p[0] for p in pairs])
    yr = rank_average([p[1] for p in pairs])
    return pearson(list(zip(xr, yr)))


def linear_regression(pairs: list[tuple[float, float]]) -> dict[str, float] | None:
    n = len(pairs)
    if n < 2:
        return None

    mean_x = sum(p[0] for p in pairs) / n
    mean_y = sum(p[1] for p in pairs) / n

    num = 0.0
    denom = 0.0
    for x, y in pairs:
        num += (x - mean_x) * (y - mean_y)
        denom += (x - mean_x) ** 2
    if denom == 0:
        return None

    slope = num / denom
    return {"slope": slope, "intercept": mean_y - slope * mean_x}


def binary_group_sizes(pairs: list[tuple[float, float]]) -> dict[str, int]:
    ones = sum(1 for x, _ in pairs if x == 1)
    zeros = sum(1 for x, _ in pairs if x == 0)
    return {"ones": ones, "zeros": zeros}


# ---------------------------------------------------------------------------
# Bootstrap — the PRNG mirrors JavaScript's 32-bit semantics exactly
# ---------------------------------------------------------------------------


def _imul(a: int, b: int) -> int:
    """Math.imul: 32-bit integer multiply, result kept modulo 2**32."""
    return (a * b) & UINT32


def mulberry32(seed: int):
    """Byte-for-byte mirror of mulberry32 in lib/stats.ts.

    Every JS operation here (>>> , |, ^, +) is congruent modulo 2**32, and no intermediate
    exceeds 2**53, so masking to 32 bits reproduces V8's results exactly.
    """
    state = seed & UINT32

    def next_float() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & UINT32
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ (t + _imul(t ^ (t >> 7), t | 61))) & UINT32
        return ((t ^ (t >> 14)) & UINT32) / 4294967296

    return next_float


def percentile(ascending: list[float], q: float) -> float:
    if not ascending:
        return float("nan")
    if len(ascending) == 1:
        return ascending[0]

    pos = (len(ascending) - 1) * q
    lower = math.floor(pos)
    upper = math.ceil(pos)
    if lower == upper:
        return ascending[lower]
    return ascending[lower] + (pos - lower) * (ascending[upper] - ascending[lower])


def bootstrap_ci(
    pairs: list[tuple[float, float]],
    statistic,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
    level: float = 0.95,
) -> dict | None:
    point = statistic(pairs)
    if point is None:
        return None

    # Canonical order, mirroring lib/stats.ts: a seeded bootstrap whose interval depends on
    # input order is not reproducible, and the page and this script order rows differently.
    ordered = sorted(pairs)

    n = len(ordered)
    rnd = mulberry32(seed)
    draws: list[float] = []

    for _ in range(iterations):
        sample = [ordered[math.floor(rnd() * n)] for _ in range(n)]
        value = statistic(sample)
        if value is not None:
            draws.append(value)

    if not draws:
        return None
    draws.sort()

    tail = (1 - level) / 2
    return {
        "point": point,
        "lo": percentile(draws, tail),
        "hi": percentile(draws, 1 - tail),
        "used": len(draws),
        "iterations": iterations,
    }


def bootstrap_rows(
    rows: list,
    key,
    statistic,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
    level: float = 0.95,
) -> dict | None:
    """Mirror of bootstrapRows in lib/stats.ts: records resampled with replacement, ordered by
    a caller key (compared as strings; identical to the bytewise order for ASCII ids), same
    PRNG and percentile as bootstrap_ci. Keys must be unique."""
    point = statistic(rows)
    if point is None:
        return None

    keys = [key(row) for row in rows]
    if len(set(keys)) != len(keys):
        raise ValueError("bootstrap_rows: duplicate key")
    ordered = [row for _, row in sorted(zip(keys, rows), key=lambda pair: pair[0])]

    n = len(ordered)
    rnd = mulberry32(seed)
    draws: list[float] = []

    for _ in range(iterations):
        sample = [ordered[math.floor(rnd() * n)] for _ in range(n)]
        value = statistic(sample)
        if value is not None:
            draws.append(value)

    if not draws:
        return None
    draws.sort()

    tail = (1 - level) / 2
    return {
        "point": point,
        "lo": percentile(draws, tail),
        "hi": percentile(draws, 1 - tail),
        "used": len(draws),
        "iterations": iterations,
    }


# ===========================================================================
# Sub-audit attribution — mirrors the second half of lib/stats.ts
# ===========================================================================


def mean_gap(pairs: list[tuple[float, float]]) -> float | None:
    sum_ones = sum_zeros = 0.0
    ones = zeros = 0
    for x, y in pairs:
        if x == 1:
            sum_ones += y
            ones += 1
        elif x == 0:
            sum_zeros += y
            zeros += 1
    if ones == 0 or zeros == 0:
        return None
    return sum_ones / ones - sum_zeros / zeros


def sub_audit_gap(
    pairs: list[tuple[float, float]],
    family_size: int = 1,
    alpha: float = 0.05,
    seed: int = DEFAULT_SEED,
    iterations: int = DEFAULT_ITERATIONS,
) -> dict | None:
    groups = binary_group_sizes(pairs)
    if min(groups["ones"], groups["zeros"]) < MIN_GROUP:
        return None
    ci = bootstrap_ci(pairs, mean_gap, iterations=iterations, seed=seed, level=1 - alpha)
    simultaneous = bootstrap_ci(
        pairs, mean_gap, iterations=iterations, seed=seed, level=1 - alpha / family_size
    )
    if ci is None or simultaneous is None:
        return None
    return {
        "groups": groups,
        "gap": ci["point"],
        "r": pearson(pairs),
        "ci": ci,
        "simultaneous": simultaneous,
    }


def shuffle_indices(n: int, rnd) -> list[int]:
    """Fisher-Yates, descending i, floor(rnd() * (i + 1)) — identical to lib/stats.ts."""
    indices = list(range(n))
    for i in range(n - 1, 0, -1):
        j = math.floor(rnd() * (i + 1))
        indices[i], indices[j] = indices[j], indices[i]
    return indices


def permutation_family(
    inputs: list[dict],
    statistic,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
    level: float = 0.05,
) -> dict | None:
    """Westfall-Young maxT. One shuffle per iteration, applied to every member."""
    if not inputs:
        return None

    site_ids = inputs[0]["site_ids"]
    n = len(site_ids)
    stratified = "strata" in inputs[0] and inputs[0]["strata"] is not None

    for member in inputs:
        if (
            len(member["predictor"]) != n
            or len(member["outcome"]) != n
            or len(member["site_ids"]) != n
        ):
            raise ValueError(f"permutation_family: member {member['key']} has the wrong length")
        if member["site_ids"] != site_ids:
            raise ValueError(f"permutation_family: member {member['key']} names different sites")

    order = sorted(range(n), key=lambda i: site_ids[i])
    members = [
        {
            "key": m["key"],
            "predictor": [m["predictor"][i] for i in order],
            "outcome": [m["outcome"][i] for i in order],
        }
        for m in inputs
    ]
    strata = [inputs[0]["strata"][i] for i in order] if stratified else None

    observed = []
    for m in members:
        value = statistic(m["predictor"], m["outcome"])
        if value is None:
            raise ValueError(f"permutation_family: member {m['key']} has no computable statistic")
        observed.append(abs(value))

    blocks = None
    if strata is not None:
        by_label: dict[str, list[int]] = defaultdict(list)
        for i, label in enumerate(strata):
            by_label[label].append(i)
        blocks = [by_label[label] for label in sorted(by_label)]

    rnd = mulberry32(seed)
    maxima: list[float] = []
    at_least = [0] * len(members)
    at_least_family = [0] * len(members)
    used = 0

    for _ in range(iterations):
        if blocks is None:
            permutation = shuffle_indices(n, rnd)
        else:
            permutation = [0] * n
            for block in blocks:
                within = shuffle_indices(len(block), rnd)
                for pos, index in enumerate(block):
                    permutation[index] = block[within[pos]]

        statistics = []
        computable = True
        for m in members:
            permuted = [m["outcome"][source] for source in permutation]
            value = statistic(m["predictor"], permuted)
            if value is None:
                computable = False
                break
            statistics.append(abs(value))
        if not computable:
            continue

        used += 1
        maximum = max(statistics)
        maxima.append(maximum)
        for j in range(len(members)):
            if statistics[j] >= observed[j] - TIE_EPSILON:
                at_least[j] += 1
            if maximum >= observed[j] - TIE_EPSILON:
                at_least_family[j] += 1

    if used == 0:
        return None
    maxima.sort()

    return {
        "comparisons": [
            {
                "key": m["key"],
                "observed": observed[j],
                "p_unadjusted": (at_least[j] + 1) / (used + 1),
                "p_family_wise": (at_least_family[j] + 1) / (used + 1),
            }
            for j, m in enumerate(members)
        ],
        "size": len(members),
        "iterations": iterations,
        "used": used,
        "level": level,
        "critical_value": percentile(maxima, 1 - level),
        "seed": seed,
        "stratified": stratified,
    }


# --- the exact permutation null --------------------------------------------


def gap_null_distribution(outcome: list[float], ones: int, denominator: int):
    n = len(outcome)
    zeros = n - ones
    if ones < 1 or zeros < 1 or denominator < 1:
        return None

    scaled = []
    for y in outcome:
        value = round(y * denominator)
        if abs(value / denominator - y) > 1e-9:
            return None
        scaled.append(value)

    total = sum(scaled)
    counts = [[0] * (total + 1) for _ in range(ones + 1)]
    counts[0][0] = 1
    for value in scaled:
        for size in range(min(ones, n) - 1, -1, -1):
            source = counts[size]
            target = counts[size + 1]
            for total_so_far in range(total - value, -1, -1):
                c = source[total_so_far]
                if c:
                    target[total_so_far + value] += c

    buckets = []
    for total_so_far in range(total + 1):
        count = counts[ones][total_so_far]
        if count == 0:
            continue
        buckets.append(
            {
                "gap": total_so_far / denominator / ones
                - (total - total_so_far) / denominator / zeros,
                "count": count,
            }
        )
    return buckets


def p_from_null(buckets, observed: float) -> dict:
    splits = 0
    extreme = 0
    for bucket in buckets:
        splits += bucket["count"]
        if abs(bucket["gap"]) >= abs(observed) - TIE_EPSILON:
            extreme += bucket["count"]
    return {"p": extreme / splits, "splits": splits, "extreme": extreme}


def exact_gap_p(predictor: list[float], outcome: list[float], denominator: int) -> dict | None:
    ones = sum(1 for x in predictor if x == 1)
    zeros = sum(1 for x in predictor if x == 0)
    if ones + zeros != len(predictor):
        return None
    observed = mean_gap(list(zip(predictor, outcome)))
    if observed is None:
        return None
    buckets = gap_null_distribution(outcome, ones, denominator)
    if buckets is None:
        return None
    return p_from_null(buckets, observed)


def minimum_attainable_p(
    predictor: list[float], outcome: list[float], denominator: int
) -> float | None:
    ones = sum(1 for x in predictor if x == 1)
    buckets = gap_null_distribution(outcome, ones, denominator)
    if buckets is None:
        return None
    most_extreme = max(abs(bucket["gap"]) for bucket in buckets)
    return p_from_null(buckets, most_extreme)["p"]


# --- the exact within-site rerandomization null ------------------------------
#
# Mirrors lib/stats.ts: per site the hypergeometric pmf of arm-2 successes given the site's
# total, as exact comb ratios converted to a float once; convolved site by site in ascending
# site-id order, each site's terms in ascending x, into a dense float list. Same operation
# order on both sides, so the p-values agree to the last bit.


def _canonical_cells(cells: list[dict]) -> list[dict]:
    ordered = sorted(cells, key=lambda c: c["site_id"])
    for c in ordered:
        values = [c["k1"], c["n1"], c["k2"], c["n2"]]
        whole = all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values)
        if not whole or c["k1"] > c["n1"] or c["k2"] > c["n2"]:
            raise ValueError(f"rerandomization: malformed cell for {c['site_id']}")
    return [c for c in ordered if c["n1"] + c["n2"] > 0]


def _rerandomization_scale(cells: list[dict]) -> int:
    g = 0
    for c in cells:
        g = math.gcd(g, math.gcd(c["n1"] + c["n2"], c["n2"]))
    return g


def rerandomization_statistic(cells: list[dict], kind: str) -> dict | None:
    ordered = _canonical_cells(cells)
    if not ordered:
        return None
    g = _rerandomization_scale(ordered)
    total = 0
    for c in ordered:
        term = ((c["n1"] + c["n2"]) * c["k2"] - c["n2"] * (c["k1"] + c["k2"])) // g
        total += term if kind == "sum" else term * term
    return {"value": total, "scale": g}


def rerandomization_null(cells: list[dict], kind: str) -> dict | None:
    ordered = _canonical_cells(cells)
    if not ordered:
        return None
    g = _rerandomization_scale(ordered)

    minimum = 0
    pmf = [1.0]
    informative = 0

    for c in ordered:
        s = c["k1"] + c["k2"]
        total = c["n1"] + c["n2"]
        if s == 0 or s == total:
            continue
        informative += 1

        lo = max(0, s - c["n1"])
        hi = min(c["n2"], s)
        denominator = math.comb(total, s)
        terms = []
        probabilities = []
        for x in range(lo, hi + 1):
            term = (total * x - c["n2"] * s) // g
            terms.append(term if kind == "sum" else term * term)
            probabilities.append(math.comb(c["n2"], x) * math.comb(c["n1"], s - x) / denominator)

        term_min = min(terms)
        term_max = max(terms)
        nxt = [0.0] * (len(pmf) + term_max - term_min)
        for i, p in enumerate(pmf):
            if p == 0:
                continue
            for j, term in enumerate(terms):
                nxt[i + term - term_min] += p * probabilities[j]
        minimum += term_min
        pmf = nxt

    if informative == 0:
        return None
    return {
        "kind": kind,
        "scale": g,
        "min": minimum,
        "pmf": pmf,
        "informative": informative,
        "sites": len(ordered),
    }


def p_from_rerandomization(distribution: dict, observed: float) -> float:
    p = 0.0
    for i, probability in enumerate(distribution["pmf"]):
        value = distribution["min"] + i
        if distribution["kind"] == "sum":
            extreme = abs(value) >= abs(observed) - TIE_EPSILON
        else:
            extreme = value >= observed - TIE_EPSILON
        if extreme:
            p += probability
    return min(1.0, p)


def min_attainable_rerandomization_p(distribution: dict) -> float:
    maximum = distribution["min"] + len(distribution["pmf"]) - 1
    if distribution["kind"] == "sum":
        extreme = max(abs(distribution["min"]), abs(maximum))
    else:
        extreme = maximum
    return p_from_rerandomization(distribution, extreme)


# --- what this cohort could have detected -----------------------------------


def maximum_attainable_gap(ones: int, zeros: int, overall_mean: float) -> float | None:
    if ones < 1 or zeros < 1:
        return None
    total = overall_mean * (ones + zeros)
    pass_mean = min(1.0, total / ones)
    fail_mean = (total - ones * pass_mean) / zeros
    return pass_mean - fail_mean


def mean(values: list[float]) -> float | None:
    """Left-to-right accumulation, deliberately NOT builtin sum().

    Python 3.12's sum() applies Neumaier compensation to float sequences; JavaScript does not.
    The difference is one bit, and one bit is enough to move a bootstrap draw across zero and
    change a simulated false-positive count. Every mirrored accumulation adds naively.
    """
    if not values:
        return None
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def median(values: list[float]) -> float | None:
    """Even count: the mean of the middle two, as in lib/stats.ts."""
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 == 1 else (ordered[mid - 1] + ordered[mid]) / 2


def standard_deviation(values: list[float]) -> float | None:
    n = len(values)
    if n < 2:
        return None
    centre = mean(values)
    total = 0.0
    for value in values:
        total += (value - centre) ** 2
    return math.sqrt(total / (n - 1))


def gap_standard_error(outcome: list[float], ones: int, zeros: int) -> float | None:
    if len(outcome) < 2 or ones < 1 or zeros < 1:
        return None
    return standard_deviation(outcome) * math.sqrt(1 / ones + 1 / zeros)


def power_threshold(critical_value: float, se: float, power: float) -> float:
    return critical_value + normal_quantile(power) * se


def sites_for_gap(
    gap: float,
    prevalence: float,
    power: float,
    critical_value: float,
    reference_ones: int,
    reference_zeros: int,
    sd: float,
) -> float | None:
    if gap <= 0 or prevalence <= 0 or prevalence >= 1:
        return None
    reference = 1 / reference_ones + 1 / reference_zeros
    k = critical_value / math.sqrt(reference) + normal_quantile(power) * sd
    unit = 1 / prevalence + 1 / (1 - prevalence)
    return (k / gap) ** 2 * unit


# --- the wrong test, kept as an exhibit -------------------------------------


def two_proportion_z(successes1: int, n1: int, successes0: int, n0: int) -> dict | None:
    if n1 < 1 or n0 < 1:
        return None
    pooled = (successes1 + successes0) / (n1 + n0)
    if pooled <= 0 or pooled >= 1:
        return None
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n0))
    if se == 0:
        return None
    z = (successes1 / n1 - successes0 / n0) / se
    return {"z": z, "p": erfc(abs(z) / math.sqrt(2))}


# --- normal distribution helpers -------------------------------------------
#
# math.erfc and statistics.NormalDist would be right to ~15 digits by a different route. The
# contract with lib/stats.ts is pinned to 12, so both sides run the identical algorithm instead.


def normal_quantile(p: float) -> float:
    """Inverse standard normal CDF, Wichura AS 241 (PPND16)."""
    if p <= 0 or p >= 1:
        return float("nan")
    q = p - 0.5

    if abs(q) <= 0.425:
        r = 0.180625 - q * q
        return q * (
            (
                (
                    (
                        (
                            (
                                (2509.0809287301226727 * r + 33430.575583588128105) * r
                                + 67265.770927008700853
                            )
                            * r
                            + 45921.953931549871457
                        )
                        * r
                        + 13731.693765509461125
                    )
                    * r
                    + 1971.5909503065514427
                )
                * r
                + 133.14166789178437745
            )
            * r
            + 3.387132872796366608
        ) / (
            (
                (
                    (
                        (
                            (
                                (5226.495278852854561 * r + 28729.085735721942674) * r
                                + 39307.89580009271061
                            )
                            * r
                            + 21213.794301586595867
                        )
                        * r
                        + 5394.1960214247511077
                    )
                    * r
                    + 687.1870074920579083
                )
                * r
                + 42.313330701600911252
            )
            * r
            + 1
        )

    r = p if q < 0 else 1 - p
    r = math.sqrt(-math.log(r))

    if r <= 5:
        r -= 1.6
        value = (
            (
                (
                    (
                        (
                            (
                                (7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r
                                + 0.24178072517745061177
                            )
                            * r
                            + 1.27045825245236838258
                        )
                        * r
                        + 3.64784832476320460504
                    )
                    * r
                    + 5.7694972214606914055
                )
                * r
                + 4.6303378461565452959
            )
            * r
            + 1.42343711074968357734
        ) / (
            (
                (
                    (
                        (
                            (
                                (1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r
                                + 0.0151986665636164571966
                            )
                            * r
                            + 0.14810397642748007459
                        )
                        * r
                        + 0.68976733498510000455
                    )
                    * r
                    + 1.6763848301838038494
                )
                * r
                + 2.05319162663775882187
            )
            * r
            + 1
        )
    else:
        r -= 5
        value = (
            (
                (
                    (
                        (
                            (
                                (2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r
                                + 0.0012426609473880784386
                            )
                            * r
                            + 0.026532189526576123093
                        )
                        * r
                        + 0.29656057182850489123
                    )
                    * r
                    + 1.7848265399172913358
                )
                * r
                + 5.4637849111641143699
            )
            * r
            + 6.6579046435011037772
        ) / (
            (
                (
                    (
                        (
                            (
                                (2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r
                                + 1.8463183175100546818e-5
                            )
                            * r
                            + 7.868691311456132591e-4
                        )
                        * r
                        + 0.0148753612908506148525
                    )
                    * r
                    + 0.13692988092273580531
                )
                * r
                + 0.59983220655588793769
            )
            * r
            + 1
        )

    return -value if q < 0 else value


def erfc(x: float) -> float:
    """Maclaurin series below 2, modified-Lentz continued fraction above — as in lib/stats.ts."""
    if x < 0:
        return 2 - erfc(-x)
    if x == 0:
        return 1.0

    if x < 2:
        term = x
        total = x
        for k in range(1, 400):
            term *= (-x * x) / k
            add = term / (2 * k + 1)
            total += add
            if abs(add) <= 1e-18 * abs(total):
                break
        return 1 - (2 / math.sqrt(math.pi)) * total

    tiny = 1e-300
    f = x
    c = f
    d = 0.0
    for k in range(1, 400):
        a = k / 2
        d = x + a * d
        if d == 0:
            d = tiny
        c = x + a / c
        if c == 0:
            c = tiny
        d = 1 / d
        delta = c * d
        f *= delta
        if abs(delta - 1) <= 1e-16:
            break
    return math.exp(-x * x) / math.sqrt(math.pi) / f


# --- calibration by simulation ---------------------------------------------


def simulate_false_positive_rate(
    outcome: list[float],
    ones: int,
    replicates: int,
    seed: int,
    iterations: int,
    level: float,
    denominator: int,
) -> dict | None:
    n = len(outcome)
    buckets = gap_null_distribution(outcome, ones, denominator)
    if buckets is None:
        return None

    rnd = mulberry32(seed)
    bootstrap_hits = bootstrap_used = permutation_hits = 0

    for replicate in range(replicates):
        order = shuffle_indices(n, rnd)
        pairs = [(1.0 if i < ones else 0.0, outcome[source]) for i, source in enumerate(order)]

        ci = bootstrap_ci(
            pairs, mean_gap, iterations=iterations, seed=seed + replicate, level=1 - level
        )
        if ci is not None:
            bootstrap_used += 1
            if ci["lo"] > 0 or ci["hi"] < 0:
                bootstrap_hits += 1

        gap = mean_gap(pairs)
        if gap is not None and p_from_null(buckets, gap)["p"] <= level:
            permutation_hits += 1

    if bootstrap_used == 0:
        return None
    return {
        "bootstrap": bootstrap_hits / bootstrap_used,
        "permutation": permutation_hits / replicates,
        "replicates": replicates,
        "iterations": iterations,
    }


def simulate_power(
    base_rates: list[float],
    ones: int,
    zeros: int,
    effect: float,
    trials: int,
    replicates: int,
    seed: int,
    critical_value: float,
    reference_ones: int,
    reference_zeros: int,
) -> dict | None:
    if not base_rates or ones < 1 or zeros < 1 or trials < 1:
        return None

    n = ones + zeros
    scaled = critical_value * math.sqrt(
        (1 / ones + 1 / zeros) / (1 / reference_ones + 1 / reference_zeros)
    )
    rnd = mulberry32(seed)
    hits = 0
    gap_total = 0.0

    for _ in range(replicates):
        sum_ones = sum_zeros = 0.0
        for i in range(n):
            base = base_rates[math.floor(rnd() * len(base_rates))]
            rate = min(1.0, base + effect) if i < ones else base
            successes = 0
            for _t in range(trials):
                if rnd() < rate:
                    successes += 1
            if i < ones:
                sum_ones += successes / trials
            else:
                sum_zeros += successes / trials
        gap = sum_ones / ones - sum_zeros / zeros
        gap_total += gap
        if abs(gap) > scaled:
            hits += 1

    return {
        "power": hits / replicates,
        "mean_gap": gap_total / replicates,
        "critical_value": scaled,
        "replicates": replicates,
    }


# ===========================================================================
# Study v2 — mirrors lib/study.ts (design/s2-2-study-v2.md section 7: c, b, m)
# ===========================================================================

_URL_AUTHORITY = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*)")
_IPV4 = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
_PORT = re.compile(r":\d*$")
# ASCII word boundaries, which is what JavaScript's \b means without the u flag.
_BLANK = re.compile(r"\bblank\b", re.IGNORECASE | re.ASCII)
BLOCK_PREFIX = "block_"
UNCORROBORATED = "block_self_report_uncorroborated"


def registrable_domain(url: str | None) -> str | None:
    """Last two host labels; an IP literal or single-label host is itself. One regex, as in
    lib/study.ts, so neither language's URL library gets a say."""
    if not url:
        return None
    match = _URL_AUTHORITY.match(url)
    if not match:
        return None
    authority = match.group(1)
    at = authority.rfind("@")
    if at >= 0:
        authority = authority[at + 1 :]
    if authority.startswith("["):
        close = authority.find("]")
        return authority[1:close].lower() if close > 1 else None
    host = _PORT.sub("", authority).lower()
    if not host:
        return None
    if _IPV4.match(host):
        return host
    labels = [label for label in host.split(".") if label]
    if not labels:
        return None
    return ".".join(labels[-2:])


def _transcript(run: dict) -> list:
    transcript = run.get("transcript")
    return transcript if isinstance(transcript, list) else []


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def site_domains(run: dict, site: dict | None) -> set[str]:
    domains: set[str] = set()
    if site:
        for domain in (registrable_domain(site["start_url"]), site.get("answer_domain")):
            if domain is not None:
                domains.add(domain)
    transcript = _transcript(run)
    first = transcript[0] if transcript else None
    if isinstance(first, dict) and isinstance(first.get("url"), str):
        domain = registrable_domain(first["url"])
        if domain is not None:
            domains.add(domain)
    return domains


def _answer_step(run: dict) -> dict | None:
    transcript = _transcript(run)
    for i in range(len(transcript) - 1, -1, -1):
        entry = transcript[i]
        if not isinstance(entry, dict):
            continue
        action = entry.get("action")
        if not isinstance(action, dict) or action.get("action") != "done":
            continue
        url = entry.get("url") if isinstance(entry.get("url"), str) else None
        j = i - 1
        while url is None and j >= 0:
            earlier = transcript[j].get("url") if isinstance(transcript[j], dict) else None
            if isinstance(earlier, str):
                url = earlier
            j -= 1
        step = entry.get("step")
        matched = entry.get("matched")
        answer = action.get("answer")
        reasoning = action.get("reasoning")
        return {
            "index": i,
            "step": step if _is_number(step) else None,
            "url": url,
            "answer": answer if isinstance(answer, str) else None,
            "reasoning": reasoning if isinstance(reasoning, str) else None,
            "matched": matched if isinstance(matched, str) and matched else None,
        }
    return None


def _end_reason(run: dict) -> str | None:
    for entry in reversed(_transcript(run)):
        if not isinstance(entry, dict):
            continue
        end = entry.get("end")
        if isinstance(end, dict):
            reason = end.get("reason")
            return reason if isinstance(reason, str) else None
    return None


def classify_answer(run: dict, site: dict | None) -> dict | None:
    """The registered rule of S2-2 section 7c, in the order lib/study.ts tests it."""
    step = _answer_step(run)
    if step is None:
        return None

    domain = registrable_domain(step["url"])
    off_domain = domain is not None and domain not in site_domains(run, site)
    reason = _end_reason(run)
    reported = (step["answer"] or "").strip().upper() == "BLOCKED"

    if run.get("success") is True or step["matched"] is not None:
        answer_class = "matched"
    elif reason is not None and reason.startswith(BLOCK_PREFIX) and reason != UNCORROBORATED:
        answer_class = "corroborated_blocked"
    elif reason == UNCORROBORATED or reported:
        answer_class = "self_reported_blocked"
    else:
        answer_class = "wrong_answer"

    self_reported = None
    if answer_class == "self_reported_blocked":
        if off_domain:
            self_reported = "off_site"
        elif _BLANK.search(step["reasoning"] or ""):
            self_reported = "blank_report"
        else:
            self_reported = "on_site_report"

    return {
        "answer_class": answer_class,
        "off_domain": off_domain,
        "self_reported": self_reported,
        "first_observation": step["step"] == 0,
    }


def answered_trials(runs: list[dict], sites: dict[str, dict]) -> dict | None:
    if not any(isinstance(r.get("transcript"), list) and len(r["transcript"]) > 0 for r in runs):
        return None

    result = {
        "recorded": len(runs),
        "answered": 0,
        "matched": 0,
        "corroborated_blocked": 0,
        "self_reported_blocked": 0,
        "wrong_answer": 0,
        "matched_off_domain": 0,
        "self_reported_split": {
            "off_site": 0,
            "blank_report": 0,
            "on_site_report": 0,
            "first_observation": 0,
        },
        "not_answered": {"count": 0, "by_failure_mode": {}},
    }
    modes: dict[str, int] = defaultdict(int)

    for run in runs:
        answer = classify_answer(run, sites.get(run["site_id"]))
        if answer is None:
            result["not_answered"]["count"] += 1
            modes[run["failure_mode"]] += 1
            continue
        result["answered"] += 1
        result[answer["answer_class"]] += 1
        if answer["answer_class"] == "matched" and answer["off_domain"]:
            result["matched_off_domain"] += 1
        if answer["self_reported"] is not None:
            result["self_reported_split"][answer["self_reported"]] += 1
            if answer["first_observation"]:
                result["self_reported_split"]["first_observation"] += 1

    result["not_answered"]["by_failure_mode"] = {mode: modes[mode] for mode in sorted(modes)}
    return result


def _split_group(cells: list[dict]) -> dict:
    sites = sorted(c["site_id"] for c in cells)
    scores = [c["lh_total"] for c in cells if c["lh_total"] is not None]
    reportable = len(scores) >= MIN_GROUP
    return {
        "sites": sites,
        "count": len(cells),
        "dropped_null_lh": len(cells) - len(scores),
        "mean": mean(scores) if reportable else None,
        "min": min(scores) if reportable else None,
        "max": max(scores) if reportable else None,
    }


def group_split(rows: list[dict], excluded=()) -> dict:
    out = set(excluded)
    measured_rows = [r for r in rows if r["n"] > 0]
    present = {r["site_id"] for r in rows}
    kept = [r for r in measured_rows if r["site_id"] not in out]
    return {
        "excluded": sorted(out),
        "removed": sorted(s for s in out if s in present),
        "unmeasured": sorted(r["site_id"] for r in rows if r["n"] == 0),
        "all_succeeded": _split_group([r for r in kept if r["k"] == r["n"]]),
        "all_failed": _split_group([r for r in kept if r["k"] == 0]),
    }


def sensitivity(
    rows: list[dict],
    excluded,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
) -> dict | None:
    out = set(excluded)
    kept = [
        r for r in rows if r["n"] > 0 and r["lh_total"] is not None and r["site_id"] not in out
    ]
    if len(kept) < MIN_N:
        return None
    pairs = [(r["lh_total"], r["k"] / r["n"]) for r in kept]
    rho = spearman_rho(pairs)
    if rho is None:
        return None
    ci = bootstrap_ci(pairs, spearman_rho, iterations=iterations, seed=seed)
    if ci is None:
        return None
    split = group_split(rows, excluded)
    return {
        "excluded": split["excluded"],
        "removed": split["removed"],
        "n": len(kept),
        "rho": rho,
        "ci": ci,
        "group_split": split,
    }


# ===========================================================================
# The x-axis decomposition — mirrors lib/x-axis.ts (design/s2-7-x-axis.md section 8)
# ===========================================================================

ROUNDING_SLACK = 0.005
LIGHTHOUSE_PASS_THRESHOLD = 0.9


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def implied_cls(row: dict) -> dict:
    t = row["lh_total"] / 100
    candidates: list[dict] = []

    def consider(denominator: int, base: int, schema) -> None:
        point = t * denominator - base
        lo = (t - ROUNDING_SLACK) * denominator - base
        hi = (t + ROUNDING_SLACK) * denominator - base
        if hi < -TIE_EPSILON or lo > 1 + TIE_EPSILON:
            return
        candidates.append(
            {
                "denominator": denominator,
                "schema": schema,
                "cls": _clamp01(point),
                "lo": _clamp01(lo),
                "hi": _clamp01(hi),
            }
        )

    a11y = row["lh_accessibility_tree"]
    llms = row["lh_llms_txt"]
    if llms != 1:
        consider(2, a11y, None)
    consider(3, a11y + llms, None)
    if row["lh_webmcp"] == 1:
        consider(4, a11y + llms, 0)
        consider(4, a11y + llms + 1, 1)

    values = sorted({c["cls"] for c in candidates})
    return {
        "candidates": candidates,
        "values": values,
        "resolved": len(values) == 1,
        "cls": values[0] if len(values) == 1 else None,
    }


def _range(values: list[float]) -> dict | None:
    if not values:
        return None
    return {"min": min(values), "median": median(values), "max": max(values)}


def cls_decomposition(rows: list[dict]) -> dict:
    sites = [
        {"site_id": r["site_id"], "lh_total": r["lh_total"], "implied": implied_cls(r)}
        for r in sorted(rows, key=lambda r: r["site_id"])
    ]
    resolved = [s["site_id"] for s in sites if s["implied"]["resolved"]]
    ambiguous = [
        {"site_id": s["site_id"], "values": s["implied"]["values"]}
        for s in sites
        if len(s["implied"]["values"]) > 1
    ]
    inconsistent = [s["site_id"] for s in sites if len(s["implied"]["values"]) == 0]

    identical = sorted(
        (
            (r["site_id"], r["lh_total"])
            for r in rows
            if r["lh_accessibility_tree"] == 0 and r["lh_llms_txt"] == 0 and r["lh_webmcp"] == 0
        ),
        key=lambda pair: pair[0],
    )
    span = None
    if identical:
        span = {"min": min(v for _, v in identical), "max": max(v for _, v in identical)}

    assignments = 1
    for site in ambiguous:
        assignments *= len(site["values"])

    decomposition = {
        "sites": sites,
        "resolved": resolved,
        "ambiguous": ambiguous,
        "inconsistent": inconsistent,
        "identical_input": {"sites": [s for s, _ in identical], "span": span},
        "assignments": assignments,
        "rho_lh_total_cls": None,
    }

    usable = [s for s in sites if len(s["implied"]["values"]) > 0]
    rhos = []
    for assignment in cls_assignments(decomposition):
        rho = spearman_rho([(s["lh_total"], assignment[s["site_id"]]) for s in usable])
        if rho is not None:
            rhos.append(rho)
    if rhos:
        decomposition["rho_lh_total_cls"] = {**_range(rhos), "n": len(usable)}
    return decomposition


def cls_assignments(decomposition: dict) -> list[dict]:
    """Ambiguous sites in site-id order, the first as the fastest-varying digit, values
    ascending: index i names the same assignment as clsAssignments in lib/x-axis.ts."""
    fixed = {
        s["site_id"]: s["implied"]["cls"]
        for s in decomposition["sites"]
        if s["implied"]["resolved"]
    }
    out = []
    for index in range(decomposition["assignments"]):
        assignment = dict(fixed)
        rest = index
        for site in decomposition["ambiguous"]:
            assignment[site["site_id"]] = site["values"][rest % len(site["values"])]
            rest //= len(site["values"])
        out.append(assignment)
    return out


def cls_alternative_rule(
    decomposition: dict, outcomes: list[dict], threshold: float = LIGHTHOUSE_PASS_THRESHOLD
) -> dict:
    rate_by_site = {o["site_id"]: o["success_rate"] for o in outcomes}
    sites = [
        s
        for s in decomposition["sites"]
        if len(s["implied"]["values"]) > 0 and s["site_id"] in rate_by_site
    ]

    gaps = []
    rhos = []
    splits: dict[int, list[int]] = {}
    for assignment in cls_assignments(decomposition):
        pairs = [
            (
                1.0 if assignment[s["site_id"]] >= threshold - TIE_EPSILON else 0.0,
                rate_by_site[s["site_id"]],
            )
            for s in sites
        ]
        ones = sum(1 for x, _ in pairs if x == 1)
        splits[ones] = [ones, len(pairs) - ones]
        gap = mean_gap(pairs)
        if gap is not None:
            gaps.append(gap)
        rho = spearman_rho([(assignment[s["site_id"]], rate_by_site[s["site_id"]]) for s in sites])
        if rho is not None:
            rhos.append(rho)

    return {
        "threshold": threshold,
        "n": len(sites),
        "assignments": decomposition["assignments"],
        "splits": [splits[k] for k in sorted(splits)],
        "gap": _range(gaps),
        "rho_cls_rate": _range(rhos),
    }


# ---------------------------------------------------------------------------
# The v1 dataset, read the way lib/queries.ts reads it
# ---------------------------------------------------------------------------


def measured(runs: list[dict]) -> list[dict]:
    """METHODOLOGY denominator rule, mirrored from measuredRuns() in lib/queries.ts:
    an 'error' trial counts as a failure unless the agent never reached the site."""
    return [r for r in runs if not (r["failure_mode"] == "error" and r["step_count"] == 0)]


def load_cohort_tiers() -> dict[str, str]:
    """site_id -> tier, from the canonical cohort CSV. Read here so the confound the page
    states can be proven from the vector file without a CSV parser in vitest."""
    with COHORT_PATH.open(newline="") as handle:
        return {row["site_id"]: row["tier"] for row in csv.DictReader(handle)}


def load_dataset() -> dict:
    runs = [json.loads(line) for line in RUNS_PATH.read_text().splitlines() if line.strip()]
    lighthouse = json.loads(LIGHTHOUSE_PATH.read_text())
    tiers = load_cohort_tiers()

    agents: dict[str, dict] = {}
    for agent_id in sorted({r["agent_id"] for r in runs}):
        by_site: dict[str, list[dict]] = defaultdict(list)
        for run in runs:
            if run["agent_id"] == agent_id:
                by_site[run["site_id"]].append(run)

        sites = []
        # Per-site trial counts and cohort tier, kept OUT of `sites` so the published
        # v1 vector block stays byte-identical across this file's extensions.
        site_meta: dict[str, dict] = {}
        unmeasured = []
        trials = 0
        successes = 0
        for site_id in sorted(by_site):
            kept = measured(by_site[site_id])
            if not kept:
                unmeasured.append(site_id)
                continue
            trials += len(kept)
            site_successes = sum(1 for r in kept if r["success"])
            successes += site_successes
            lh = lighthouse.get(site_id)
            if lh is None:
                continue
            sites.append(
                {
                    "site_id": site_id,
                    "lh_total": lh["lh_total"],
                    "success_rate": site_successes / len(kept),
                    **{key: lh[key] for key in SUB_AUDITS},
                }
            )
            site_meta[site_id] = {
                "tier": tiers[site_id],
                "trials": len(kept),
                "successes": site_successes,
            }

        run_times = sorted(r["run_at"] for r in runs if r["agent_id"] == agent_id)
        agents[agent_id] = {
            "sites": sites,
            "site_meta": site_meta,
            "unmeasured_sites": unmeasured,
            "trials": trials,
            "successes": successes,
            "run_window": {"first": run_times[0], "last": run_times[-1]},
        }

    return agents


def summarize(agent: dict) -> dict:
    pairs = [(s["lh_total"], s["success_rate"]) for s in agent["sites"]]
    summary = {
        "n": len(pairs),
        "trials": agent["trials"],
        "successes": agent["successes"],
        "unmeasured_sites": agent["unmeasured_sites"],
        "run_window": agent["run_window"],
        # Full per-site rows so the TypeScript side can rebuild every pair itself rather
        # than trusting a pre-derived one.
        "sites": agent["sites"],
        "pairs": [{"x": x, "y": y} for x, y in pairs],
        "pearson": pearson(pairs),
        "spearman": spearman_rho(pairs),
        "linear_regression": linear_regression(pairs),
        "spearman_ci": bootstrap_ci(pairs, spearman_rho),
        "pearson_ci": bootstrap_ci(pairs, pearson),
        "sub_audits": {},
    }

    for key in SUB_AUDITS:
        audit_pairs = [(s[key], s["success_rate"]) for s in agent["sites"]]
        groups = binary_group_sizes(audit_pairs)
        reportable = min(groups["ones"], groups["zeros"]) >= MIN_GROUP
        summary["sub_audits"][key] = {
            "groups": groups,
            "reportable": reportable,
            "pearson": pearson(audit_pairs) if reportable else None,
        }

    return summary


# ---------------------------------------------------------------------------
# Edge cases the page can actually hit — each one must return null, not zero
# ---------------------------------------------------------------------------


def edge_cases() -> list[dict]:
    def case(name: str, pairs: list[tuple[float, float]], note: str) -> dict:
        return {
            "name": name,
            "note": note,
            "pairs": [{"x": x, "y": y} for x, y in pairs],
            "pearson": pearson(pairs),
            "spearman": spearman_rho(pairs),
            "linear_regression": linear_regression(pairs),
        }

    return [
        case("empty", [], "no sites measured yet"),
        case("single", [(50.0, 1.0)], "one site: nothing to correlate"),
        case("two_points", [(50.0, 1.0), (80.0, 0.5)], "below MIN_N, a line is not a finding"),
        case(
            "constant_x",
            [(70.0, 0.2), (70.0, 0.6), (70.0, 1.0), (70.0, 0.4)],
            "every site scores the same statically: undefined, not r=0",
        ),
        case(
            "constant_y",
            [(3.0, 0.4), (50.0, 0.4), (80.0, 0.4), (100.0, 0.4)],
            "every site has the same success rate: undefined, not r=0",
        ),
        case(
            "perfect_positive",
            [(10.0, 0.2), (20.0, 0.4), (30.0, 0.6), (40.0, 0.8)],
            "sanity anchor",
        ),
        case(
            "perfect_negative",
            [(10.0, 0.8), (20.0, 0.6), (30.0, 0.4), (40.0, 0.2)],
            "sanity anchor",
        ),
        case(
            "monotone_not_linear",
            [(1.0, 0.1), (2.0, 0.2), (3.0, 0.9), (4.0, 0.95), (5.0, 0.99)],
            "rho reaches 1 where r does not: why the headline is rank-based",
        ),
        case(
            "ties",
            [(10.0, 0.5), (10.0, 0.5), (20.0, 0.5), (30.0, 1.0), (30.0, 0.0)],
            "tied ranks share the block mean",
        ),
    ]


# ---------------------------------------------------------------------------
# Sub-audit attribution vectors — the Phase 6 analysis, computed once, pinned
# ---------------------------------------------------------------------------

# The family: the audits with a reportable split, across every published agent.
FAMILY_AUDITS = ["lh_accessibility_tree", "lh_layout_stability", "lh_llms_txt"]
FAMILY_ALPHA = 0.05
TRIALS_PER_SITE = 5

# Calibration (see simulate_false_positive_rate). 2,000 bootstrap iterations inside each of
# 1,000 replicates: the published intervals use 10,000, and the measured rate is the same to
# within Monte-Carlo error either way, but 6 x 1,000 x 10,000 resamples is a slow test.
CALIBRATION_SPLITS = [12, 6, 1]
CALIBRATION_REPLICATES = 1000
CALIBRATION_ITERATIONS = 2000

POWER_EFFECT = 0.30
POWER_TRIALS = 5
POWER_REPLICATES = 20000
POWER_DESIGN_SIZES = [50, 93]

SIZING_GAPS = [0.30, 0.20]
SIZING_POWERS = [0.50, 0.80]


def _gap_statistic(predictor: list[float], outcome: list[float]) -> float | None:
    return mean_gap(list(zip(predictor, outcome)))


def _pairs(sites: list[dict], key: str) -> list[tuple[float, float]]:
    return [(float(s[key]), s["success_rate"]) for s in sites]


def sub_audit_vectors(agents: dict, calibration: bool = True) -> dict:
    lighthouse = json.loads(LIGHTHOUSE_PATH.read_text())
    tiers = load_cohort_tiers()
    agent_ids = sorted(agents)
    family_size = len(agent_ids) * len(FAMILY_AUDITS)

    def sites_of(agent_id: str) -> list[dict]:
        return agents[agent_id]["sites"]

    def meta_of(agent_id: str, site_id: str) -> dict:
        return agents[agent_id]["site_meta"][site_id]

    # --- the family -------------------------------------------------------
    members = [
        {
            "key": f"{agent_id}|{audit}",
            "site_ids": [s["site_id"] for s in sites_of(agent_id)],
            "predictor": [float(s[audit]) for s in sites_of(agent_id)],
            "outcome": [s["success_rate"] for s in sites_of(agent_id)],
        }
        for agent_id in agent_ids
        for audit in FAMILY_AUDITS
    ]
    family = permutation_family(members, _gap_statistic, level=FAMILY_ALPHA)
    by_key = {c["key"]: c for c in family["comparisons"]}

    per_agent: dict[str, dict] = {}
    for agent_id in agent_ids:
        sites = sites_of(agent_id)
        audits: dict[str, dict] = {}
        for audit in SUB_AUDITS:
            pairs = _pairs(sites, audit)
            groups = binary_group_sizes(pairs)
            gap = sub_audit_gap(pairs, family_size=family_size, alpha=FAMILY_ALPHA)
            comparison = by_key.get(f"{agent_id}|{audit}")
            exact = exact_gap_p([x for x, _ in pairs], [y for _, y in pairs], TRIALS_PER_SITE)
            audits[audit] = {
                "groups": groups,
                "reportable": gap is not None,
                "gap": gap["gap"] if gap else mean_gap(pairs),
                "r": gap["r"] if gap else None,
                "ci95": {k: gap["ci"][k] for k in ("lo", "hi", "used")} if gap else None,
                "simultaneous": (
                    {k: gap["simultaneous"][k] for k in ("lo", "hi", "used")} if gap else None
                ),
                "p_unadjusted": comparison["p_unadjusted"] if comparison else None,
                "p_exact": exact["p"] if exact else None,
                "p_family_wise": comparison["p_family_wise"] if comparison else None,
            }
        per_agent[agent_id] = audits

    # --- the WebMCP trap: what the estimator does when the gate is removed --
    degenerate = {}
    for agent_id in agent_ids:
        pairs = _pairs(sites_of(agent_id), "lh_webmcp")
        ci = bootstrap_ci(pairs, mean_gap)
        predictor = [x for x, _ in pairs]
        outcome = [y for _, y in pairs]
        degenerate[agent_id] = {
            "groups": binary_group_sizes(pairs),
            "gap": mean_gap(pairs),
            "ci95": {k: ci[k] for k in ("lo", "hi", "used", "iterations")},
            "discarded": ci["iterations"] - ci["used"],
            "p_exact": exact_gap_p(predictor, outcome, TRIALS_PER_SITE)["p"],
            "min_attainable_p": minimum_attainable_p(predictor, outcome, TRIALS_PER_SITE),
        }

    # --- what the cohort could have detected -------------------------------
    power = {}
    for agent_id in agent_ids:
        sites = sites_of(agent_id)
        outcome = [s["success_rate"] for s in sites]
        ones = binary_group_sizes(_pairs(sites, "lh_llms_txt"))["ones"]
        zeros = len(sites) - ones
        se = gap_standard_error(outcome, ones, zeros)
        threshold = power_threshold(family["critical_value"], se, 0.80)
        ceiling = maximum_attainable_gap(ones, zeros, mean(outcome))
        power[agent_id] = {
            "reference_split": {"ones": ones, "zeros": zeros},
            "overall_rate": mean(outcome),
            "sd": standard_deviation(outcome),
            "se_at_split": se,
            "critical_value": family["critical_value"],
            "threshold_80": threshold,
            "max_attainable_gap": ceiling,
            "detectable_at_80": ceiling >= threshold,
            "sites_at_extremes": sum(1 for y in outcome if y in (0.0, 1.0)),
        }

    headline = agent_ids[0]
    sizing = [
        {
            "gap": gap,
            "prevalence": prevalence,
            "power": target,
            "n": sites_for_gap(
                gap,
                prevalence,
                target,
                family["critical_value"],
                power[headline]["reference_split"]["ones"],
                power[headline]["reference_split"]["zeros"],
                power[headline]["sd"],
            ),
        }
        for gap in SIZING_GAPS
        for prevalence in (0.5, power[headline]["reference_split"]["ones"] / len(sites_of(headline)))
        for target in SIZING_POWERS
    ]

    # --- the confound ------------------------------------------------------
    stratified_members = [
        {**member, "strata": [tiers[site_id] for site_id in member["site_ids"]]}
        for member in members
    ]
    stratified = permutation_family(stratified_members, _gap_statistic, level=FAMILY_ALPHA)

    confound = {
        "llms_txt_sites": [
            {"site_id": s["site_id"], "tier": tiers[s["site_id"]]}
            for s in sites_of(headline)
            if s["lh_llms_txt"] == 1
        ],
        "anchors_without_llms_txt": [
            s["site_id"]
            for s in sites_of(headline)
            if tiers[s["site_id"]] == "anchor" and s["lh_llms_txt"] == 0
        ],
        "anchor_pseudo_audit": {},
        "stratified": {
            c["key"]: {"p_unadjusted": c["p_unadjusted"], "p_family_wise": c["p_family_wise"]}
            for c in stratified["comparisons"]
        },
        "stratified_critical_value": stratified["critical_value"],
        "within_anchor": {},
        "identical_to_anchor": {},
    }
    for agent_id in agent_ids:
        sites = sites_of(agent_id)
        anchor_pairs = [
            (1.0 if tiers[s["site_id"]] == "anchor" else 0.0, s["success_rate"]) for s in sites
        ]
        ci = bootstrap_ci(anchor_pairs, mean_gap)
        confound["anchor_pseudo_audit"][agent_id] = {
            "groups": binary_group_sizes(anchor_pairs),
            "gap": mean_gap(anchor_pairs),
            "ci95": {k: ci[k] for k in ("lo", "hi", "used")},
        }
        anchors = [s for s in sites if tiers[s["site_id"]] == "anchor"]
        within = _pairs(anchors, "lh_llms_txt")
        confound["within_anchor"][agent_id] = {
            "groups": binary_group_sizes(within),
            "gap": mean_gap(within),
        }
        confound["identical_to_anchor"][agent_id] = sorted(anchor_pairs) == sorted(
            _pairs(sites, "lh_llms_txt")
        )

    # --- pooling the panel: computed, rejected, published as rejected ------
    pooled_sites = []
    for site in sites_of(agent_ids[0]):
        site_id = site["site_id"]
        trials = sum(meta_of(a, site_id)["trials"] for a in agent_ids)
        successes = sum(meta_of(a, site_id)["successes"] for a in agent_ids)
        pooled_sites.append({**site, "success_rate": successes / trials})
    pooled_denominator = TRIALS_PER_SITE * len(agent_ids)

    pooled = {}
    for audit in SUB_AUDITS:
        pairs = _pairs(pooled_sites, audit)
        groups = binary_group_sizes(pairs)
        # An exact p is legitimate at any split; a bootstrap interval is not.
        ci = (
            bootstrap_ci(pairs, mean_gap)
            if min(groups["ones"], groups["zeros"]) >= MIN_GROUP
            else None
        )
        pooled[audit] = {
            "gap": mean_gap(pairs),
            "ci95": {k: ci[k] for k in ("lo", "hi", "used")} if ci else None,
            "p_exact": exact_gap_p(
                [x for x, _ in pairs], [y for _, y in pairs], pooled_denominator
            )["p"],
        }

    rate_of = {a: {s["site_id"]: s["success_rate"] for s in sites_of(a)} for a in agent_ids}
    flipped = sorted(
        (
            {
                "site_id": site_id,
                "first": rate_of[agent_ids[0]][site_id],
                "second": rate_of[agent_ids[1]][site_id],
            }
            for site_id in rate_of[agent_ids[0]]
            if abs(rate_of[agent_ids[0]][site_id] - rate_of[agent_ids[1]][site_id]) >= 0.6
        ),
        key=lambda row: row["site_id"],
    )

    # --- the wrong unit of analysis ---------------------------------------
    unit_of_analysis = {}
    for audit in SUB_AUDITS:
        passing = [s for s in pooled_sites if s[audit] == 1]
        failing = [s for s in pooled_sites if s[audit] == 0]

        def totals(group: list[dict]) -> tuple[int, int]:
            successes = sum(
                meta_of(a, s["site_id"])["successes"] for s in group for a in agent_ids
            )
            trials = sum(meta_of(a, s["site_id"])["trials"] for s in group for a in agent_ids)
            return successes, trials

        s1, n1 = totals(passing)
        s0, n0 = totals(failing)
        test = two_proportion_z(s1, n1, s0, n0)
        unit_of_analysis[audit] = {
            "successes_pass": s1,
            "trials_pass": n1,
            "successes_fail": s0,
            "trials_fail": n0,
            "trial_z": test["z"],
            "trial_p": test["p"],
            "site_p": pooled[audit]["p_exact"],
            "ratio": pooled[audit]["p_exact"] / test["p"],
        }

    # --- costco: excluded (n=27) vs scored 0% (n=28) -----------------------
    costco_lh = lighthouse["costco"]
    pooled_28 = pooled_sites + [
        {
            "site_id": "costco",
            "success_rate": 0.0,
            **{key: costco_lh[key] for key in SUB_AUDITS},
        }
    ]
    costco = {}
    for audit in SUB_AUDITS:
        p27 = _pairs(pooled_sites, audit)
        p28 = _pairs(pooled_28, audit)
        costco[audit] = {
            "gap_27": mean_gap(p27),
            "p_27": exact_gap_p([x for x, _ in p27], [y for _, y in p27], pooled_denominator)["p"],
            "gap_28": mean_gap(p28),
            "p_28": exact_gap_p([x for x, _ in p28], [y for _, y in p28], pooled_denominator)["p"],
        }

    # --- calibration -------------------------------------------------------
    # The slow block (about two minutes): skipped under calibration=False, which the fast
    # Python vector test uses; `--write` and the slow test always run it.
    calibration_block = None
    if calibration:
        false_positive = {}
        for agent_id in agent_ids:
            outcome = [s["success_rate"] for s in sites_of(agent_id)]
            false_positive[agent_id] = {
                str(ones): simulate_false_positive_rate(
                    outcome,
                    ones,
                    CALIBRATION_REPLICATES,
                    DEFAULT_SEED,
                    CALIBRATION_ITERATIONS,
                    FAMILY_ALPHA,
                    TRIALS_PER_SITE,
                )
                for ones in CALIBRATION_SPLITS
            }

        base_rates = [s["success_rate"] for s in sites_of(headline)]
        power_simulation = []
        for size in POWER_DESIGN_SIZES:
            ones = size // 2
            zeros = size - ones
            result = simulate_power(
                base_rates,
                ones,
                zeros,
                POWER_EFFECT,
                POWER_TRIALS,
                POWER_REPLICATES,
                DEFAULT_SEED,
                family["critical_value"],
                power[headline]["reference_split"]["ones"],
                power[headline]["reference_split"]["zeros"],
            )
            power_simulation.append({"n": size, "ones": ones, "zeros": zeros, **result})

        calibration_block = {
            "false_positive": {
                "splits": CALIBRATION_SPLITS,
                "replicates": CALIBRATION_REPLICATES,
                "iterations": CALIBRATION_ITERATIONS,
                "level": FAMILY_ALPHA,
                "agents": false_positive,
            },
            "power_simulation": {
                "effect": POWER_EFFECT,
                "trials": POWER_TRIALS,
                "replicates": POWER_REPLICATES,
                "seed": DEFAULT_SEED,
                "base_rate_agent": headline,
                "designs": power_simulation,
            },
        }

    # --- the estimator note (identical in v1, not identical in principle) ---
    equivalence = {
        agent_id: {
            "mean_of_site_rates": mean([s["success_rate"] for s in sites_of(agent_id)]),
            "pooled_trial_rate": agents[agent_id]["successes"] / agents[agent_id]["trials"],
            "trials_per_site": sorted(
                {meta_of(agent_id, s["site_id"])["trials"] for s in sites_of(agent_id)}
            ),
        }
        for agent_id in agent_ids
    }

    block = {
        "min_group": MIN_GROUP,
        "alpha": FAMILY_ALPHA,
        "iterations": DEFAULT_ITERATIONS,
        "seed": DEFAULT_SEED,
        "trials_per_site": TRIALS_PER_SITE,
        "family_audits": FAMILY_AUDITS,
        # Cohort design bucket per site, so the confound is provable from this file alone.
        "site_tiers": {site_id: tiers[site_id] for site_id in sorted(tiers)},
        # Attempted, never reached, therefore no behavioral measurement. Carried so the
        # exclusion-sensitivity analysis can be reproduced without re-reading the artifacts.
        "excluded_sites": [
            {
                "site_id": site_id,
                "tier": tiers[site_id],
                **{key: lighthouse[site_id][key] for key in SUB_AUDITS},
            }
            for site_id in sorted(agents[headline]["unmeasured_sites"])
        ],
        # Fisher-Yates, pinned as exact integers: every p-value below depends on this stream.
        "shuffle": {
            "n": 27,
            "seed": DEFAULT_SEED,
            "first_3": _shuffles(27, DEFAULT_SEED, 3),
            "n_6_first_2": _shuffles(6, DEFAULT_SEED, 2),
        },
        "normal_quantile": [
            {"p": p, "value": normal_quantile(p)} for p in (0.5, 0.8, 0.9, 0.975, 0.99, 0.999)
        ],
        "erfc": [{"x": x, "value": erfc(x)} for x in (0.0, 0.5, 1.0, 2.0, 3.0, 3.854)],
        "family": {
            "size": family["size"],
            "level": family["level"],
            "iterations": family["iterations"],
            "used": family["used"],
            "critical_value": family["critical_value"],
            "members": [c["key"] for c in family["comparisons"]],
        },
        "agents": per_agent,
        "degenerate_webmcp": degenerate,
        "power": power,
        "sizing": sizing,
        "confound": confound,
        "unit_of_analysis": unit_of_analysis,
        "costco_sensitivity": costco,
        "pooled_panel_rejected": {
            "audits": pooled,
            "between_agent_spearman": spearman_rho(
                [
                    (rate_of[agent_ids[0]][s["site_id"]], rate_of[agent_ids[1]][s["site_id"]])
                    for s in sites_of(agent_ids[0])
                ]
            ),
            "flipped_sites": flipped,
        },
        "estimator_equivalence": equivalence,
    }
    if calibration_block is not None:
        block["calibration"] = calibration_block
    return block


# ---------------------------------------------------------------------------
# Study v2 vectors — the blocks a P5 surface prints (S2-2 section 13, as amended)
# ---------------------------------------------------------------------------

# The registrable domain of each site's registered answer page (docs/COHORT.md, the URL line
# of every entry, under the last-two-labels rule). The third member of a site's domains, an
# input to the v1 split of self-reported blocks; pinned in the `study_v2` block until
# data/answer-pages.csv exists (plan A.13 item 3). Every site equals its start domain except
# zalando, whose registered answer page is on zalando.pt.
ANSWER_PAGE_DOMAINS = {
    "amazon": "amazon.com",
    "apple": "apple.com",
    "bear": "bear.app",
    "bestbuy": "bestbuy.com",
    "ca_dmv": "ca.gov",
    "cloudflare": "cloudflare.com",
    "costco": "costco.com",
    "craigslist": "craigslist.org",
    "github": "github.com",
    "ikea": "ikea.com",
    "innout": "in-n-out.com",
    "irs": "irs.gov",
    "notion": "notion.com",
    "oregon_state": "oregonstate.edu",
    "portland": "portland.gov",
    "powells": "powells.com",
    "shopify": "shopify.com",
    "spotify": "spotify.com",
    "ssa": "ssa.gov",
    "stripe": "stripe.com",
    "target": "target.com",
    "ticketmaster": "ticketmaster.com",
    "trimet": "trimet.org",
    "twilio": "twilio.com",
    "tx_dmv": "txdmv.gov",
    "usps": "usps.com",
    "voodoo": "voodoodoughnut.com",
    "zalando": "zalando.pt",
}

# Rule (d) of the registered exclusion rule reads the first complete three-pass
# `instrument-v1`, which has not run. This is the site a scripted check predicts it will name
# (S2-2 section 2); every figure computed with it is labelled conditional and is not printed
# until the control is dated.
RULE_D_CONDITIONAL = ["oregon_state"]


def load_artifacts() -> tuple[list[dict], dict, dict[str, dict]]:
    runs = [json.loads(line) for line in RUNS_PATH.read_text().splitlines() if line.strip()]
    lighthouse = json.loads(LIGHTHOUSE_PATH.read_text())
    with COHORT_PATH.open(newline="") as handle:
        cohort = {row["site_id"]: row for row in csv.DictReader(handle)}
    return runs, lighthouse, cohort


def _rule_b_sites(runs: list[dict], agent_id: str) -> list[str]:
    """Rule (b): a measured site whose every recorded trial is a harness error. Derived from
    the rows, never typed; a site with no measured trial is rule (c), not (b)."""
    by_site: dict[str, list[dict]] = defaultdict(list)
    for run in runs:
        if run["agent_id"] == agent_id:
            by_site[run["site_id"]].append(run)
    return sorted(
        site_id
        for site_id, rows in by_site.items()
        if measured(rows) and all(r["failure_mode"] == "error" for r in rows)
    )


def _site_cells(agents: dict, agent_id: str, lighthouse: dict, site_ids: list[str]) -> list[dict]:
    meta = agents[agent_id]["site_meta"]
    cells = []
    for site_id in site_ids:
        m = meta.get(site_id)
        lh = lighthouse.get(site_id)
        cells.append(
            {
                "site_id": site_id,
                "k": m["successes"] if m else 0,
                "n": m["trials"] if m else 0,
                "lh_total": lh["lh_total"] if lh else None,
            }
        )
    return cells


def _paired_delta(rows: list[dict]) -> float | None:
    """Mean over sites of arm 2's rate minus arm 1's, as a fraction."""
    return mean([r["k2"] / r["n2"] - r["k1"] / r["n1"] for r in rows])


def _rerandomization_block(cells: list[dict]) -> dict:
    block: dict = {"cells": cells}
    for kind in ("sum", "dispersion"):
        null = rerandomization_null(cells, kind)
        statistic = rerandomization_statistic(cells, kind)
        if null is None:
            block[kind] = None
            continue
        block[kind] = {
            "statistic": statistic["value"],
            "scale": statistic["scale"],
            "p": p_from_rerandomization(null, statistic["value"]),
            "min_attainable_p": min_attainable_rerandomization_p(null),
            "informative": null["informative"],
            "support_min": null["min"],
            "support_max": null["min"] + len(null["pmf"]) - 1,
            # Sparse: the reachable values only. Every other index of the dense pmf is exactly 0,
            # which the TypeScript test asserts.
            "pmf": {str(null["min"] + i): p for i, p in enumerate(null["pmf"]) if p != 0},
        }
    return block


def _synthetic_v2_answers() -> dict:
    """v2-shaped rows, one per class, plus an off-domain match, a login-wall corroboration, a
    redirected start and two non-answers. Answers known by hand."""
    start = "https://example.com/"
    sites = {"v2site": {"start_url": start, "answer_domain": "example.com"}}

    def run(number, success, mode, transcript, site_id="v2site"):
        return {
            "site_id": site_id,
            "agent_id": "synthetic@v2",
            "batch_label": "synthetic",
            "trial_number": number,
            "success": success,
            "step_count": len([s for s in transcript if "action" in s]),
            "duration_seconds": 1,
            "failure_mode": mode,
            "transcript": transcript,
            "run_at": "2026-09-23T00:00:00+00:00",
        }

    home = {"step": 0, "url": "https://www.example.com/", "action": {"action": "click", "selector": "Pricing"}}
    runs = [
        run(1, True, "success", [
            home,
            {"step": 1, "url": "https://www.example.com/pricing", "action": {"action": "done", "answer": "$12"}, "matched": "$12"},
        ]),
        run(2, False, "wrong_extraction", [
            home,
            {"step": 1, "url": "https://www.google.com/search?q=example", "action": {"action": "done", "answer": "$12"}, "matched": "$12"},
            {"end": {"reason": "off_domain_done"}},
        ]),
        run(3, False, "blocked", [
            home,
            {"step": 1, "url": "https://www.example.com/login", "action": {"action": "done", "answer": "BLOCKED", "reasoning": "A sign-in wall."}, "matched": None},
            {"end": {"reason": "block_corroborated:login_wall"}},
        ]),
        run(4, False, "wrong_extraction", [
            home,
            {"step": 1, "url": "https://www.example.com/pricing", "action": {"action": "done", "answer": "BLOCKED", "reasoning": "The page is blank."}, "matched": None},
            {"end": {"reason": "block_self_report_uncorroborated"}},
        ]),
        run(5, False, "wrong_extraction", [
            home,
            {"step": 1, "url": "https://www.example.com/pricing", "action": {"action": "done", "answer": "$99"}, "matched": None},
            {"end": {"reason": "answer_mismatch"}},
        ]),
        run(6, False, "timeout", [home, {"step": 1, "url": "https://www.example.com/pricing", "action": {"action": "scroll"}}]),
        run(7, False, "blocked", [{"end": {"reason": "transport:ERR_CONNECTION_RESET"}}]),
        run(8, True, "success", [
            {"step": 0, "url": "https://shop.example-redirect.net/", "action": {"action": "click", "selector": "Pricing"}},
            {"step": 1, "url": "https://shop.example-redirect.net/pricing", "action": {"action": "done", "answer": "$12"}, "matched": "$12"},
        ]),
    ]
    return {
        "sites": sites,
        "runs": runs,
        "per_run": [classify_answer(r, sites[r["site_id"]]) for r in runs],
        "result": answered_trials(runs, sites),
        "no_transcripts": answered_trials(
            [{**runs[0], "transcript": None}, {**runs[1], "transcript": []}], sites
        ),
    }


def study_v2_vectors(agents: dict) -> dict:
    runs, lighthouse, cohort = load_artifacts()
    agent_ids = sorted(agents)
    site_ids = sorted(cohort)
    sites = {
        s: {"start_url": cohort[s]["start_url"], "answer_domain": ANSWER_PAGE_DOMAINS[s]}
        for s in site_ids
    }

    # --- answered trials, the four classes and the v1 split -----------------
    by_site_split: dict[str, dict] = {}
    for run in runs:
        answer = classify_answer(run, sites[run["site_id"]])
        if answer is None or answer["self_reported"] is None:
            continue
        split = by_site_split.setdefault(
            run["site_id"],
            {"off_site": 0, "blank_report": 0, "on_site_report": 0, "first_observation": 0},
        )
        split[answer["self_reported"]] += 1
        if answer["first_observation"]:
            split["first_observation"] += 1

    answered = {
        "pooled": answered_trials(runs, sites),
        "by_agent": {
            a: answered_trials([r for r in runs if r["agent_id"] == a], sites) for a in agent_ids
        },
        "self_reported_by_site": {s: by_site_split[s] for s in sorted(by_site_split)},
        "v2_synthetic": _synthetic_v2_answers(),
    }

    # --- the one registered exclusion rule ------------------------------------
    rule_b_by_agent = {a: _rule_b_sites(runs, a) for a in agent_ids}
    rule_b = sorted(set().union(*rule_b_by_agent.values()))
    rule_b_and_d = sorted(set(rule_b) | set(RULE_D_CONDITIONAL))
    cells = {a: _site_cells(agents, a, lighthouse, site_ids) for a in agent_ids}

    group = {
        a: {
            "published": group_split(cells[a]),
            "rule_b": group_split(cells[a], rule_b),
            "rule_b_and_d_conditional": group_split(cells[a], rule_b_and_d),
        }
        for a in agent_ids
    }
    sensitivities = {
        a: {
            "rule_b": sensitivity(cells[a], rule_b),
            "rule_b_and_d_conditional": sensitivity(cells[a], rule_b_and_d),
        }
        for a in agent_ids
    }

    # --- the paired model gap: bootstrapRows and the exact null -----------------
    first, second = agent_ids[0], agent_ids[1]
    paired = []
    for c1, c2 in zip(cells[first], cells[second]):
        assert c1["site_id"] == c2["site_id"]
        if c1["n"] > 0 and c2["n"] > 0:
            paired.append(
                {"site_id": c1["site_id"], "k1": c1["k"], "n1": c1["n"], "k2": c2["k"], "n2": c2["n"]}
            )

    synthetic_rows = [
        {"site_id": "b", "k1": 1, "n1": 5, "k2": 4, "n2": 5},
        {"site_id": "a", "k1": 5, "n1": 5, "k2": 5, "n2": 5},
        {"site_id": "c", "k1": 0, "n1": 5, "k2": 0, "n2": 5},
    ]
    bootstrap = {
        "v1_model_gap": {
            "arms": [first, second],
            "n": len(paired),
            "sites_moved": sum(1 for r in paired if r["k1"] != r["k2"]),
            "ci": bootstrap_rows(paired, lambda r: r["site_id"], _paired_delta),
        },
        "synthetic": {
            "rows": synthetic_rows,
            "ci": bootstrap_rows(synthetic_rows, lambda r: r["site_id"], _paired_delta),
        },
    }

    rerandomization = {
        "v1_model_gap": _rerandomization_block(paired),
        "two_site": _rerandomization_block(
            [
                {"site_id": "a", "k1": 0, "n1": 2, "k2": 2, "n2": 2},
                {"site_id": "b", "k1": 1, "n1": 2, "k2": 1, "n2": 2},
            ]
        ),
        "five_v_seven": _rerandomization_block(
            [
                {"site_id": "x", "k1": 5, "n1": 5, "k2": 0, "n2": 7},
                {"site_id": "y", "k1": 2, "n1": 5, "k2": 3, "n2": 7},
                {"site_id": "z", "k1": 0, "n1": 5, "k2": 7, "n2": 7},
            ]
        ),
        "all_boundary": _rerandomization_block(
            [
                {"site_id": "p", "k1": 0, "n1": 5, "k2": 0, "n2": 5},
                {"site_id": "q", "k1": 5, "n1": 5, "k2": 5, "n2": 5},
            ]
        ),
    }

    return {
        "sites": sites,
        "exclusions": {
            "rule_b": rule_b,
            "rule_b_by_agent": rule_b_by_agent,
            "rule_d": {"status": "pending instrument-v1", "conditional": RULE_D_CONDITIONAL},
        },
        "answered_trials": answered,
        "cells": cells,
        "group_split": group,
        "sensitivity": sensitivities,
        "bootstrap_rows": bootstrap,
        "rerandomization": rerandomization,
    }


# ---------------------------------------------------------------------------
# The x-axis decomposition vectors (S2-7 section 8)
# ---------------------------------------------------------------------------


def x_axis_vectors(agents: dict) -> dict:
    lighthouse = json.loads(LIGHTHOUSE_PATH.read_text())
    rows = [
        {"site_id": site_id, "lh_total": row["lh_total"], **{key: row[key] for key in SUB_AUDITS}}
        for site_id, row in sorted(lighthouse.items())
    ]
    decomposition = cls_decomposition(rows)

    agent_ids = sorted(agents)
    measured_ids = sorted(agents[agent_ids[0]]["site_meta"])
    measured_only = cls_decomposition([r for r in rows if r["site_id"] in measured_ids])

    alternative = {}
    for agent_id in agent_ids:
        outcomes = [
            {"site_id": s["site_id"], "success_rate": s["success_rate"]}
            for s in agents[agent_id]["sites"]
        ]
        alternative[agent_id] = cls_alternative_rule(decomposition, outcomes)

    return {
        "rounding_slack": ROUNDING_SLACK,
        "rows": rows,
        "implied_cls": {s["site_id"]: s["implied"] for s in decomposition["sites"]},
        "resolved": decomposition["resolved"],
        "ambiguous": decomposition["ambiguous"],
        "inconsistent": decomposition["inconsistent"],
        "identical_input": decomposition["identical_input"],
        "assignments": decomposition["assignments"],
        "rho_lh_total_cls": decomposition["rho_lh_total_cls"],
        # The same statistic on the y-axis frame, which is where the behavioral half lives.
        "measured": {
            "excluded": sorted(set(lighthouse) - set(measured_ids)),
            "assignments": measured_only["assignments"],
            "rho_lh_total_cls": measured_only["rho_lh_total_cls"],
        },
        "alternative_rule": {"threshold": LIGHTHOUSE_PASS_THRESHOLD, "agents": alternative},
    }


def _shuffles(n: int, seed: int, count: int) -> list[list[int]]:
    rnd = mulberry32(seed)
    return [shuffle_indices(n, rnd) for _ in range(count)]


def build_vectors(calibration: bool = True) -> dict:
    """Every block of the vector file. calibration=False skips the slow simulation block of
    sub_audit_attribution (about two minutes) and omits its key; the fast Python test runs
    that way, and `--write` never does."""
    agents = load_dataset()
    return {
        "_comment": (
            "Generated by scripts/stats_reference.py from the committed v1 artifacts. "
            "Cross-language contract for lib/stats.ts — regenerate deliberately."
        ),
        "constants": {
            "MIN_N": MIN_N,
            "MIN_GROUP": MIN_GROUP,
            "DEFAULT_SEED": DEFAULT_SEED,
            "DEFAULT_ITERATIONS": DEFAULT_ITERATIONS,
        },
        # The raw generator stream: if this diverges nothing downstream can agree.
        "prng": {
            "seed": DEFAULT_SEED,
            "first_10": _stream(DEFAULT_SEED, 10),
            "seed_1_first_5": _stream(1, 5),
        },
        "rank_average": [
            {"values": [10, 20, 20, 30], "ranks": rank_average([10, 20, 20, 30])},
            {"values": [5, 5, 5], "ranks": rank_average([5, 5, 5])},
            {"values": [3, 1, 2], "ranks": rank_average([3, 1, 2])},
            {
                "values": [1, 2, 2, 2, 5, 5],
                "ranks": rank_average([1, 2, 2, 2, 5, 5]),
            },
        ],
        "percentile": [
            {"sorted": [1, 2, 3, 4], "q": 0.025, "value": percentile([1, 2, 3, 4], 0.025)},
            {"sorted": [1, 2, 3, 4], "q": 0.5, "value": percentile([1, 2, 3, 4], 0.5)},
            {"sorted": [1, 2, 3, 4], "q": 0.975, "value": percentile([1, 2, 3, 4], 0.975)},
            {"sorted": [7], "q": 0.5, "value": percentile([7], 0.5)},
        ],
        "edge_cases": edge_cases(),
        "v1": {agent_id: summarize(agent) for agent_id, agent in agents.items()},
        "sub_audit_attribution": sub_audit_vectors(agents, calibration=calibration),
        "study_v2": study_v2_vectors(agents),
        "x_axis_decomposition": x_axis_vectors(agents),
    }


def render_vectors(vectors: dict) -> str:
    """The exact bytes `--write` puts in the file; the Python vector test checks them."""
    return json.dumps(vectors, indent=2) + "\n"


def _stream(seed: int, count: int) -> list[float]:
    rnd = mulberry32(seed)
    return [rnd() for _ in range(count)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="regenerate the vector file")
    args = parser.parse_args()

    vectors = build_vectors()

    for agent_id, summary in vectors["v1"].items():
        rate = summary["successes"] / summary["trials"] * 100
        rho_ci = summary["spearman_ci"]
        print(
            f"{agent_id}: {summary['successes']}/{summary['trials']} = {rate:.1f}% "
            f"| n={summary['n']} | r={summary['pearson']:.4f} "
            f"| rho={summary['spearman']:.4f} "
            f"[{rho_ci['lo']:.3f}, {rho_ci['hi']:.3f}] "
            f"| unmeasured: {summary['unmeasured_sites'] or 'none'}"
        )

    if args.write:
        VECTORS_PATH.write_text(render_vectors(vectors))
        print(f"\nwrote {VECTORS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
