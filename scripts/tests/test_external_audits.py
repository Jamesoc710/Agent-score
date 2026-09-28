"""
Tests for the external audits under data/external/ (design S2-8 §2).

Offline: fetch.py is the only network step and is never run here. What is pinned:

  1. The inputs are the ones SOURCE.json names. traces.csv is AgentReady's file verbatim;
     trials.csv is what fetch.py derives from WebBench's eight pinned files.
  2. The committed outputs are exactly what the committed analyzers produce from the committed
     CSVs, byte for byte: any drift between a CSV, a script and an output fails.
  3. The figures the external texts quote. Regenerating an output after a rule change passes
     (2) but not this.
"""

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXTERNAL = REPO_ROOT / "data" / "external"
AGENTREADY = EXTERNAL / "agentready"
WEBBENCH = EXTERNAL / "webbench"

TRACES_SHA256 = "65ee5fe2f0c7f16429734ab4220e210dc2b8236804934dcd5e22018504167501"
# The eight digest prefixes S2-8 §2 recorded when the design was verified.
WEBBENCH_PREFIXES = ["d7021b54", "b4e03d91", "d78a69a6", "bdae0ec4",
                     "9bb7e0d3", "44671dbb", "77cd32b7", "a831004b"]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def run_analyzer(directory: Path, out_dir: Path) -> None:
    subprocess.run([sys.executable, str(directory / "analyze.py"), "--out-dir", str(out_dir)],
                   check=True, capture_output=True, text=True)


# ---------------------------------------------------------------------------
# 1. The inputs
# ---------------------------------------------------------------------------


def test_agentready_files_match_source():
    source = load(AGENTREADY / "SOURCE.json")
    assert sha256(AGENTREADY / "traces.csv") == TRACES_SHA256
    for f in source["files"]:
        path = AGENTREADY / f["committed_as"]
        assert path.stat().st_size == f["bytes"]
        assert sha256(path) == f["sha256"]
        assert source["commit"] in f["url"]


def test_webbench_trials_match_source():
    derived = load(WEBBENCH / "SOURCE.json")["derived"]
    trials = WEBBENCH / "trials.csv"
    assert sha256(trials) == derived["sha256"]
    lines = trials.read_text().splitlines()
    assert lines[0] == ",".join(derived["columns"])
    assert len(lines) - 1 == derived["rows"] == 11429


def test_fetch_pins_the_recorded_digests():
    spec = importlib.util.spec_from_file_location("webbench_fetch", WEBBENCH / "fetch.py")
    fetch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetch)
    source = load(WEBBENCH / "SOURCE.json")

    assert fetch.COMMIT == source["commit"]
    pinned = [digest for _, _, _, digest in fetch.FILES]
    assert [d[:8] for d in pinned] == WEBBENCH_PREFIXES
    recorded = {f["path"]: f["sha256"] for f in source["files"]}
    for _, name, _, digest in fetch.FILES:
        assert recorded[f"results/{name}"] == digest
    assert recorded["LICENSE"] == sha256(WEBBENCH / "LICENSE")


# ---------------------------------------------------------------------------
# 2. The outputs re-derive exactly
# ---------------------------------------------------------------------------


def test_agentready_output_rederives(tmp_path):
    run_analyzer(AGENTREADY, tmp_path)
    assert (tmp_path / "output.json").read_bytes() == (AGENTREADY / "output.json").read_bytes()


def test_webbench_outputs_rederive(tmp_path):
    run_analyzer(WEBBENCH, tmp_path)
    for name in ("output.json", "sites.csv"):
        assert (tmp_path / name).read_bytes() == (WEBBENCH / name).read_bytes(), name


# ---------------------------------------------------------------------------
# 3. The quoted figures
# ---------------------------------------------------------------------------

AGENTREADY_CLAIMS = {
    # key: (run-weighted n, of, site-weighted mean %, median %, uniform-19 %)
    "homepage": (708, 1033, 50.1, 50.0, 40.1),
    "docs": (855, 1033, 83.6, 88.9, 83.9),
    "well_known": (234, 1033, 8.2, 0.0, 0.3),
    "grounded": (844, 1023, 74.1, 88.6, 69.0),
    "llms_txt_reached": (329, 1033, 11.1, 0.0, 0.0),
}


@pytest.mark.parametrize("key", AGENTREADY_CLAIMS)
def test_agentready_claim(key):
    claims = {c["key"]: c for c in load(AGENTREADY / "output.json")["claims"]}
    n, of, site_mean, site_median, uniform = AGENTREADY_CLAIMS[key]
    c = claims[key]
    assert (c["run_weighted"]["n"], c["run_weighted"]["of"]) == (n, of)
    assert c["site_weighted"]["sites"] == 25
    assert (c["site_weighted"]["mean_pct"], c["site_weighted"]["median_pct"]) == (site_mean,
                                                                                   site_median)
    assert c["uniform_19"]["pct"] == uniform


def test_agentready_structure():
    out = load(AGENTREADY / "output.json")
    assert (out["runs"], out["sites"]) == (1033, 25)
    assert out["concentration"]["top_six"]["n"] == 691
    assert out["concentration"]["sites_with_18_runs"] == 19
    assert len(out["confounding"]["uniform_sites"]) == 19

    base = out["llms_txt_base"]
    assert (base["shipping_sites"], base["reaching_runs"], len(base["reaching_sites"])) == (15, 329, 6)
    assert base["ora_telnyx_of_reaching_runs"]["n"] == 157
    assert len(base["shipping_with_zero_reach"]) == 9
    assert base["shipping_with_zero_reach_all_uniform"]
    assert (base["uniform_19_reached"]["n"], base["uniform_19_reached"]["of"]) == (0, 342)

    conditionals = {c["key"]: c for c in out["llms_txt_conditionals"]}
    assert conditionals["followed_listing"]["run_weighted"]["n"] == 117
    assert conditionals["answered_from_llms_txt"]["run_weighted"]["n"] == 120
    assert conditionals["followed_listing"]["site_weighted"]["mean_pct"] == 37.0
    assert conditionals["answered_from_llms_txt"]["site_weighted"]["mean_pct"] == 33.0

    via_link = out["page_checks"]["llms_txt_fetches_via_link"]
    assert (via_link["n"], via_link["of"]) == (356, 416)


def test_webbench_figures():
    out = load(WEBBENCH / "output.json")
    assert (out["trials"], out["sites"]) == (11429, 447)
    assert {a: v["pct"] for a, v in out["agents"].items()
            if a in ("anthropic_cua", "skyvern", "skyvern_browserbase", "openai_cua", "browseruse")} == {
        "anthropic_cua": 66.0, "skyvern": 64.4, "skyvern_browserbase": 60.7,
        "openai_cua": 59.8, "browseruse": 43.9,
    }
    assert (out["categories"]["READ"]["pct"], out["categories"]["READ"]["of"]) == (75.3, 7402)
    assert (out["categories"]["DELETE"]["pct"], out["categories"]["DELETE"]["of"]) == (34.0, 717)

    exhibit = out["naive_exhibit"]
    assert exhibit["sites"] == 116
    assert round(exhibit["spearman"]["rho"], 3) == 0.403
    assert exhibit["spearman"]["lo"] < exhibit["spearman"]["rho"] < exhibit["spearman"]["hi"]

    matched = out["shape_matched"]
    assert (matched["trials"], matched["sites"], matched["pooled"]["pct"]) == (6279, 442, 77.4)
    reported = matched["reported"]
    assert (reported["sites"], reported["trials"]) == (351, 5651)
    assert (reported["rate"]["median_pct"], reported["rate"]["mean_pct"],
            reported["rate"]["sd_pct"]) == (81.8, 78.3, 18.7)
    assert (reported["sites_at_100"], reported["sites_at_0"]) == (47, 2)
    assert (matched["sensitivity"]["sites"], matched["sensitivity"]["rate"]["median_pct"]) == (87, 80.0)

    sites = (WEBBENCH / "sites.csv").read_text().splitlines()
    assert sites[0] == "site,trials,tasks,agents,successes,rate"
    assert len(sites) - 1 == 351
    names = [line.split(",")[0] for line in sites[1:]]
    assert names == sorted(names), "sites.csv is listed by name, never by rate"
