#!/usr/bin/env python3
"""WebBench grouped by site, naive and shape-matched (S2-8 §4).

    python data/external/webbench/analyze.py                # writes output.json and sites.csv here
    python data/external/webbench/analyze.py --out-dir DIR  # writes them to DIR instead

Reads trials.csv (written by fetch.py) and nothing else. Stdlib plus the repo's own
scripts/stats_reference.py, so the one statistic that is a correlation with an interval, the
exhibit's Spearman, comes from the implementation lib/stats.ts mirrors; spearman.test.ts checks
it in TypeScript. Summaries use the same module's mean, median, standard_deviation (n - 1) and
percentile (linear interpolation).

The shape-matched rule: Category READ and Difficulty easy, a site reported at 10 or more pooled
trials and never below it. The naive grouping (every task type, 30 or more trials) is computed
only as the exhibit of why it is invalid: its rate tracks the site's READ share. Sites are
listed by name everywhere; nothing here is a ranking.

Rates are fractions; `pct` is the same rate x 100, rounded to one decimal for reading.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import stats_reference as sr

TRIALS = HERE / "trials.csv"
SHAPE = {"category": "READ", "difficulty": "easy"}
REPORT_THRESHOLD = 10
SENSITIVITY_THRESHOLD = 20
EXHIBIT_THRESHOLD = 30
EXHIBIT_SITES = ["twitch.tv", "encyclopedia.com"]
SITES_COLUMNS = ["site", "trials", "tasks", "agents", "successes", "rate"]


def rate(numerator: int, denominator: int) -> dict:
    value = numerator / denominator
    return {"n": numerator, "of": denominator, "rate": value, "pct": round(value * 100, 1)}


def pct(value: float) -> float:
    return round(value * 100, 1)


def group(trials: list[dict]) -> dict[str, list[dict]]:
    by_site: dict[str, list[dict]] = defaultdict(list)
    for t in trials:
        by_site[t["site"]].append(t)
    return dict(sorted(by_site.items()))


def successes(trials: list[dict]) -> int:
    return sum(t["outcome"] == "Success" for t in trials)


def site_row(site: str, trials: list[dict]) -> dict:
    return {
        "site": site,
        "trials": len(trials),
        "tasks": len({t["task_id"] for t in trials}),
        "agents": len({t["agent"] for t in trials}),
        "successes": successes(trials),
        "rate": successes(trials) / len(trials),
    }


def summary(values: list[float]) -> dict:
    ascending = sorted(values)
    out = {
        "median": sr.median(values),
        "mean": sr.mean(values),
        "sd": sr.standard_deviation(values),
        "q1": sr.percentile(ascending, 0.25),
        "q3": sr.percentile(ascending, 0.75),
        "min": ascending[0],
        "max": ascending[-1],
    }
    return {**out, **{f"{k}_pct": pct(v) for k, v in out.items()}}


def shape_matched_at(by_site: dict[str, list[dict]], threshold: int,
                     full_coverage: list[str]) -> tuple[dict, list[dict]]:
    rows = [site_row(s, ts) for s, ts in by_site.items() if len(ts) >= threshold]
    rates = [r["rate"] for r in rows]
    trials = [float(r["trials"]) for r in rows]
    coverage = [sum(t["agent"] in full_coverage for t in by_site[r["site"]]) / r["trials"]
                for r in rows]
    result = {
        "threshold": threshold,
        "sites": len(rows),
        "trials": sum(r["trials"] for r in rows),
        "rate": summary(rates),
        "sites_at_100": sum(r["successes"] == r["trials"] for r in rows),
        "sites_at_0": sum(r["successes"] == 0 for r in rows),
        "trials_per_site": {"median": sr.median(trials),
                            "min": min(r["trials"] for r in rows),
                            "max": max(r["trials"] for r in rows)},
        "tasks_per_site": {"median": sr.median([float(r["tasks"]) for r in rows]),
                           "min": min(r["tasks"] for r in rows)},
        "agents_per_site": {"median": sr.median([float(r["agents"]) for r in rows]),
                            "min": min(r["agents"] for r in rows)},
        "full_coverage_share": {"median": sr.median(coverage), "min": min(coverage)},
        # Checks on the agent mix, reported beside the rate and never used to adjust it.
        "residual_spearman": {
            "full_coverage_share": sr.spearman_rho(list(zip(coverage, rates))),
            "trials": sr.spearman_rho(list(zip(trials, rates))),
        },
    }
    return result, rows


def analyze(path: Path) -> tuple[dict, list[dict]]:
    raw = path.read_bytes()
    trials = list(csv.DictReader(io.StringIO(raw.decode("utf-8"), newline="")))
    by_site = group(trials)
    tasks = {t["task_id"] for t in trials}

    agents = sorted({t["agent"] for t in trials})
    by_agent = {a: [t for t in trials if t["agent"] == a] for a in agents}
    full_coverage = [a for a in agents if {t["task_id"] for t in by_agent[a]} == tasks]
    categories = sorted({t["category"] for t in trials})
    difficulties = sorted({t["difficulty"] for t in trials})

    # The exhibit: every task type, sites at 30 or more pooled trials. x is the site's READ
    # share (the annotators' task mix), y its pooled rate, as in the scatter it is drawn as.
    naive = []
    for site, ts in by_site.items():
        if len(ts) >= EXHIBIT_THRESHOLD:
            reads = sum(t["category"] == "READ" for t in ts)
            naive.append({
                "site": site,
                "trials": len(ts),
                "successes": successes(ts),
                "read_trials": reads,
                "read_share": reads / len(ts),
                "rate": successes(ts) / len(ts),
            })
    pairs = [(p["read_share"], p["rate"]) for p in naive]
    ci = sr.bootstrap_ci(pairs, sr.spearman_rho, iterations=sr.DEFAULT_ITERATIONS,
                         seed=sr.DEFAULT_SEED)
    lowest = min(naive, key=lambda p: p["rate"])
    highest = max(naive, key=lambda p: p["rate"])

    matched = [t for t in trials
               if t["category"] == SHAPE["category"] and t["difficulty"] == SHAPE["difficulty"]]
    matched_by_site = group(matched)
    reported, sites_rows = shape_matched_at(matched_by_site, REPORT_THRESHOLD, full_coverage)
    sensitivity, _ = shape_matched_at(matched_by_site, SENSITIVITY_THRESHOLD, full_coverage)

    output = {
        "source": {
            "file": path.name,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "rule": {
            "trial": "a row of one of the eight results/*.csv labelled Success or Failure",
            "site": "the start URL's host, lowercased, leading www. removed, nothing coarser",
            "shape": SHAPE,
            "report_threshold": REPORT_THRESHOLD,
            "sensitivity_threshold": SENSITIVITY_THRESHOLD,
            "exhibit_threshold": EXHIBIT_THRESHOLD,
            "below_threshold": "not measured, never 0",
            "sd": "sample (n - 1), stats_reference.standard_deviation",
            "quartiles": "linear interpolation, stats_reference.percentile",
        },
        "trials": len(trials),
        "sites": len(by_site),
        "tasks": len(tasks),
        "agents": {a: rate(successes(by_agent[a]), len(by_agent[a])) for a in agents},
        "full_coverage_agents": full_coverage,
        "categories": {
            c: rate(successes([t for t in trials if t["category"] == c]),
                    sum(t["category"] == c for t in trials))
            for c in categories
        },
        "trials_by_category_and_difficulty": {
            c: {d: sum(t["category"] == c and t["difficulty"] == d for t in trials)
                for d in difficulties}
            for c in categories
        },
        "naive_exhibit": {
            "threshold": EXHIBIT_THRESHOLD,
            "sites": len(naive),
            "trials": sum(p["trials"] for p in naive),
            "read_share": {"min": min(x for x, _ in pairs), "max": max(x for x, _ in pairs)},
            "rate_span": {
                end: {"site": p["site"], "trials": p["trials"], "rate": p["rate"],
                      "pct": pct(p["rate"])}
                for end, p in (("min", lowest), ("max", highest))
            },
            "spearman": {
                "x": "read_share",
                "y": "rate",
                "rho": ci["point"],
                "lo": ci["lo"],
                "hi": ci["hi"],
                "used": ci["used"],
                "iterations": ci["iterations"],
                "seed": sr.DEFAULT_SEED,
                "level": 0.95,
            },
            "pairs": naive,
        },
        "shape_matched": {
            "shape": SHAPE,
            "trials": len(matched),
            "sites": len(matched_by_site),
            "pooled": rate(successes(matched), len(matched)),
            "not_measured_sites": len(matched_by_site) - reported["sites"],
            "reported": reported,
            "sensitivity": sensitivity,
            "exhibit_sites": {
                s: rate(successes(matched_by_site[s]), len(matched_by_site[s]))
                for s in EXHIBIT_SITES
            },
        },
    }
    return output, sites_rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out-dir", type=Path, default=HERE)
    args = parser.parse_args()
    output, sites_rows = analyze(TRIALS)

    out = args.out_dir / "output.json"
    out.write_text(json.dumps(output, indent=2) + "\n")
    sites = args.out_dir / "sites.csv"
    with sites.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(SITES_COLUMNS)
        for r in sites_rows:
            writer.writerow([r["site"], r["trials"], r["tasks"], r["agents"], r["successes"],
                             f"{r['rate']:.4f}"])
    print(f"wrote {out} and {sites}: {len(sites_rows)} sites")


if __name__ == "__main__":
    main()
