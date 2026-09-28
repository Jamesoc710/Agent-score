#!/usr/bin/env python3
"""AgentReady traces.csv, run-weighted against site-weighted (S2-8 §3).

    python data/external/agentready/analyze.py                # writes output.json beside this file
    python data/external/agentready/analyze.py --out-dir DIR  # writes DIR/output.json instead

Stdlib only and standalone: it reads the verbatim traces.csv beside it and nothing else, so a
stranger can check it with this directory alone. Every rule is the one agentready.org states for
its own figure; the only change is the unit, a site instead of a run.

Blank cells are not-applicable, never missing (the dataset's README). A blank is excluded from
a column's denominator and never counted as a 0, except where the page's rule names a different
base (the two llms.txt claims divide by every run that reached the file).

Rates are fractions; `pct` is the same rate x 100, rounded to one decimal for reading.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRACES = HERE / "traces.csv"

# The 19 uniformly designed sites: every run is one of these two models, nine of each.
UNIFORM_MIX = {"claude-sonnet-4-6": 9, "gpt-5.4": 9}
TOP_N = 6

# (key, the page's wording, the column the page's rule reads). The rule is `column == 1`
# over the rows where the column is not blank.
REACH_CLAIMS = [
    ("homepage", 'homepage "Reached in 69% of runs"', "homepage_reached"),
    ("docs", 'docs "Reached in 83% of runs"', "docs_reached"),
    ("well_known", '.well-known "Reached in about 23% of runs"', "well_known_reached"),
    ("grounded", '"82% of answers traced back to a page the agent fetched"', "answer_grounded"),
    ("llms_txt_reached", "llms.txt reached (the base of the two llms.txt claims; not a headline)",
     "llms_txt_reached"),
]


def rate(numerator: int, denominator: int) -> dict:
    value = numerator / denominator
    return {"n": numerator, "of": denominator, "rate": value, "pct": round(value * 100, 1)}


def distribution(values: list[float]) -> dict:
    return {
        "sites": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "mean_pct": round(statistics.mean(values) * 100, 1),
        "median_pct": round(statistics.median(values) * 100, 1),
    }


def site_rates(by_site: dict[str, list[dict]], column: str) -> dict[str, float]:
    out = {}
    for site in sorted(by_site):
        applicable = [r for r in by_site[site] if r[column] in ("0", "1")]
        if applicable:
            out[site] = sum(r[column] == "1" for r in applicable) / len(applicable)
    return out


def analyze(path: Path) -> dict:
    raw = path.read_bytes()
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8"), newline="")))

    by_site: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_site[r["domain"]].append(r)
    order = sorted(by_site, key=lambda s: (-len(by_site[s]), s))

    models = sorted({r["model"] for r in rows})
    harnesses = sorted({r["harness"] for r in rows})
    model_mix = {s: Counter(r["model"] for r in by_site[s]) for s in by_site}
    uniform = sorted(s for s in by_site if dict(model_mix[s]) == UNIFORM_MIX)
    uniform_rows = [r for s in uniform for r in by_site[s]]

    top = order[:TOP_N]
    top_runs = sum(len(by_site[s]) for s in top)
    ora_telnyx_runs = len(by_site["ora.ai"]) + len(by_site["telnyx.com"])

    concentration = {
        "runs_per_site": [
            {
                "site": s,
                "runs": len(by_site[s]),
                "models": dict(sorted(model_mix[s].items())),
                "harnesses": dict(sorted(Counter(r["harness"] for r in by_site[s]).items())),
            }
            for s in order
        ],
        "top_six": {"sites": top, **rate(top_runs, len(rows))},
        "ora_telnyx_of_all_runs": rate(ora_telnyx_runs, len(rows)),
        "sites_with_18_runs": sum(len(by_site[s]) == 18 for s in by_site),
    }

    llms_by_model = {}
    for m in models:
        runs = [r for r in rows if r["model"] == m]
        llms_by_model[m] = rate(sum(r["llms_txt_reached"] == "1" for r in runs), len(runs))
    confounding = {
        "runs_by_harness_and_model": {
            h: {m: sum(r["harness"] == h and r["model"] == m for r in rows) for m in models}
            for h in harnesses
        },
        "llms_txt_reached_by_model": llms_by_model,
        "sites_with_all_four_models": sorted(
            s for s in by_site if len(model_mix[s]) == len(models)),
        "sites_with_haiku_or_fable": sorted(
            s for s in by_site
            if model_mix[s]["claude-haiku-4-5"] or model_mix[s]["claude-fable-5"]
        ),
        "uniform_sites": uniform,
        "uniform_rule": "every run is claude-sonnet-4-6 or gpt-5.4, nine of each",
    }

    claims = []
    for key, page, column in REACH_CLAIMS:
        applicable = [r for r in rows if r[column] in ("0", "1")]
        run_weighted = rate(sum(r[column] == "1" for r in applicable), len(applicable))
        per_site = site_rates(by_site, column)
        site_weighted = distribution(list(per_site.values()))
        uniform_applicable = [r for r in uniform_rows if r[column] in ("0", "1")]
        claims.append({
            "key": key,
            "page": page,
            "rule": f"{column} == 1",
            "blank_cells": sum(r[column] == "" for r in rows),
            "run_weighted": run_weighted,
            "site_weighted": site_weighted,
            "run_minus_site_points": round((run_weighted["rate"] - site_weighted["mean"]) * 100, 1),
            "uniform_19": rate(sum(r[column] == "1" for r in uniform_applicable),
                               len(uniform_applicable)),
            "per_site": {s: per_site[s] for s in order if s in per_site},
        })

    reached = [r for r in rows if r["llms_txt_reached"] == "1"]
    reached_by_site = Counter(r["domain"] for r in reached)
    reaching = [s for s in order if reached_by_site[s]]
    shipping = sorted(
        s for s in by_site if any(r["site_ships_llms_txt"] == "1" for r in by_site[s]))
    shipping_zero = sorted(s for s in shipping if not reached_by_site[s])
    uniform_reached = sum(r["llms_txt_reached"] == "1" for r in uniform_rows)
    ora_telnyx_reached = reached_by_site["ora.ai"] + reached_by_site["telnyx.com"]

    llms_base = {
        "shipping_sites": len(shipping),
        "reaching_runs": len(reached),
        "reaching_sites": {s: reached_by_site[s] for s in reaching},
        "reaching_sites_all_in_top_six": all(s in top for s in reaching),
        "ora_telnyx_of_reaching_runs": {
            "ora.ai": reached_by_site["ora.ai"],
            "telnyx.com": reached_by_site["telnyx.com"],
            **rate(ora_telnyx_reached, len(reached)),
        },
        "shipping_with_zero_reach": shipping_zero,
        "shipping_with_zero_reach_all_uniform": all(s in uniform for s in shipping_zero),
        "uniform_19_reached": rate(uniform_reached, len(uniform_rows)),
    }

    # The two claims whose base is the reaching runs. Their rule divides by every reaching run,
    # so a blank llms_followed_listing on a reaching run counts in the denominator.
    conditionals = []
    for key, page, column, value, rule in [
        ("followed_listing", '"One in three agents that read it went on to fetch a page it lists"',
         "llms_followed_listing", "1", "llms_followed_listing == 1 over llms_txt_reached == 1"),
        ("answered_from_llms_txt", '"36% drew their final answer from its content"',
         "answer_ground_kind", "llms_txt",
         "answer_ground_kind == 'llms_txt' over llms_txt_reached == 1"),
    ]:
        per_site = {s: sum(r[column] == value for r in reached if r["domain"] == s)
                    / reached_by_site[s] for s in reaching}
        conditionals.append({
            "key": key,
            "page": page,
            "rule": rule,
            "blank_cells_in_base": sum(r[column] == "" for r in reached),
            "run_weighted": rate(sum(r[column] == value for r in reached), len(reached)),
            "site_weighted": distribution(list(per_site.values())),
            "uniform_19": None,
            "uniform_19_null_reason": f"no run in the 19-site group reached an llms.txt "
                                      f"({uniform_reached} of {len(uniform_rows)})",
            "per_site": per_site,
        })

    grounded = sum(r["answer_grounded"] == "1" for r in rows)
    from_llms = sum(r["answer_ground_kind"] == "llms_txt" for r in rows)
    page_checks = {
        "llms_txt_fetches_via_link": {
            "rule": "sum(llms_txt_linked) over sum(llms_txt_fetches); "
                    "llms_txt_linked is blank only where llms_txt_fetches is 0",
            **rate(sum(int(r["llms_txt_linked"] or 0) for r in rows),
                   sum(int(r["llms_txt_fetches"] or 0) for r in rows)),
        },
        "llms_txt_share_of_grounded_answers": {
            "rule": "answer_ground_kind == 'llms_txt' over answer_grounded == 1",
            **rate(from_llms, grounded),
        },
        "answer_ground_kind_llms_full_among_reaching": sum(
            r["answer_ground_kind"] == "llms_full" for r in reached),
    }

    return {
        "source": {
            "file": path.name,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "runs": len(rows),
        "sites": len(by_site),
        "models": models,
        "harnesses": harnesses,
        "concentration": concentration,
        "confounding": confounding,
        "claims": claims,
        "llms_txt_base": llms_base,
        "llms_txt_conditionals": conditionals,
        "page_checks": page_checks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out-dir", type=Path, default=HERE)
    args = parser.parse_args()
    result = analyze(TRACES)
    out = args.out_dir / "output.json"
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
