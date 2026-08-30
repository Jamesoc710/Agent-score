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
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS_PATH = ROOT / "data" / "agent-runs-v1.jsonl"
LIGHTHOUSE_PATH = ROOT / "data" / "lighthouse-v1.json"
VECTORS_PATH = ROOT / "scripts" / "tests" / "stats-vectors.json"

# Mirrors the constants in lib/stats.ts.
MIN_N = 3
MIN_GROUP = 3
DEFAULT_SEED = 20260819
DEFAULT_ITERATIONS = 10000

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


# ---------------------------------------------------------------------------
# The v1 dataset, read the way lib/queries.ts reads it
# ---------------------------------------------------------------------------


def measured(runs: list[dict]) -> list[dict]:
    """METHODOLOGY denominator rule, mirrored from measuredRuns() in lib/queries.ts:
    an 'error' trial counts as a failure unless the agent never reached the site."""
    return [r for r in runs if not (r["failure_mode"] == "error" and r["step_count"] == 0)]


def load_dataset() -> dict:
    runs = [json.loads(line) for line in RUNS_PATH.read_text().splitlines() if line.strip()]
    lighthouse = json.loads(LIGHTHOUSE_PATH.read_text())

    agents: dict[str, dict] = {}
    for agent_id in sorted({r["agent_id"] for r in runs}):
        by_site: dict[str, list[dict]] = defaultdict(list)
        for run in runs:
            if run["agent_id"] == agent_id:
                by_site[run["site_id"]].append(run)

        sites = []
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

        run_times = sorted(r["run_at"] for r in runs if r["agent_id"] == agent_id)
        agents[agent_id] = {
            "sites": sites,
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


def build_vectors() -> dict:
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
    }


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
        VECTORS_PATH.write_text(json.dumps(vectors, indent=2) + "\n")
        print(f"\nwrote {VECTORS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
