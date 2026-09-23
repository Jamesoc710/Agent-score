"""The Python half of the two-language statistics contract (design S2-2 section 8).

Every number the site publishes is computed in lib/stats.ts (with lib/sub-audits.ts, lib/study.ts
and lib/x-axis.ts) and in scripts/stats_reference.py, and pinned in scripts/tests/stats-vectors.json.
Until this file existed the contract ran one way: vitest proved the TypeScript agrees with the
committed vectors, and nothing proved the Python still produced them. An edit to the reference
without `--write` left vitest green against stale vectors.

Three layers:
  1. Block by block, `build_vectors(calibration=False)` equals the committed file, exactly.
     Floats round-trip through json.dumps exactly in CPython, so equality is exact, and one
     parametrized case per top-level key names the block that drifted.
  2. The calibration block is slow (about two minutes) and off by default: the fast run asserts
     the committed block exists and carries the registered constants, so a stale block cannot go
     unnoticed; `-m slow` regenerates it and compares.
  3. The `--write` path leaves the file unchanged: the bytes the generator would write are the
     bytes committed.
"""

import copy
import json

import pytest

import stats_reference as sr

COMMITTED = json.loads(sr.VECTORS_PATH.read_text(encoding="utf-8"))
SLOW_BLOCK = ("sub_audit_attribution", "calibration")


@pytest.fixture(scope="module")
def generated() -> dict:
    return sr.build_vectors(calibration=False)


def first_difference(expected, actual, path: str = "$") -> str | None:
    """The first path at which two JSON trees differ, or None. Exact comparison: an int and an
    equal float are the same JSON number, a float differing in the last bit is not."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        if list(expected) != list(actual):
            return f"{path}: keys {list(expected)} != {list(actual)}"
        for key in expected:
            found = first_difference(expected[key], actual[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return f"{path}: length {len(expected)} != {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual)):
            found = first_difference(e, a, f"{path}[{i}]")
            if found:
                return found
        return None
    if type(expected) is bool or type(actual) is bool:
        return None if expected is actual else f"{path}: {expected!r} != {actual!r}"
    if expected != actual:
        return f"{path}: {expected!r} != {actual!r}"
    return None


# ---------------------------------------------------------------------------
# 1. Every block regenerates to the committed value
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("key", list(COMMITTED))
def test_block_matches_committed_vectors(generated, key):
    expected = COMMITTED[key]
    actual = generated[key]
    if key == SLOW_BLOCK[0]:
        expected = {k: v for k, v in expected.items() if k != SLOW_BLOCK[1]}
        assert SLOW_BLOCK[1] not in actual, "calibration=False must omit the slow block"
    difference = first_difference(expected, actual)
    assert difference is None, f"{key}: {difference}"


def test_top_level_keys_are_the_committed_ones(generated):
    assert list(generated) == list(COMMITTED)


# ---------------------------------------------------------------------------
# 2. The slow block: committed, carrying the registered constants
# ---------------------------------------------------------------------------


def test_committed_calibration_block_carries_the_registered_constants():
    block = COMMITTED[SLOW_BLOCK[0]][SLOW_BLOCK[1]]
    false_positive = block["false_positive"]
    assert false_positive["splits"] == sr.CALIBRATION_SPLITS
    assert false_positive["replicates"] == sr.CALIBRATION_REPLICATES
    assert false_positive["iterations"] == sr.CALIBRATION_ITERATIONS
    assert false_positive["level"] == sr.FAMILY_ALPHA
    for agent_id, splits in false_positive["agents"].items():
        assert agent_id in COMMITTED["v1"]
        assert list(splits) == [str(ones) for ones in sr.CALIBRATION_SPLITS]
        for result in splits.values():
            assert result["replicates"] == sr.CALIBRATION_REPLICATES
            assert result["iterations"] == sr.CALIBRATION_ITERATIONS
            assert 0 <= result["bootstrap"] <= 1 and 0 <= result["permutation"] <= 1

    power = block["power_simulation"]
    assert power["effect"] == sr.POWER_EFFECT
    assert power["trials"] == sr.POWER_TRIALS
    assert power["replicates"] == sr.POWER_REPLICATES
    assert power["seed"] == sr.DEFAULT_SEED
    assert power["base_rate_agent"] in COMMITTED["v1"]
    assert [design["n"] for design in power["designs"]] == sr.POWER_DESIGN_SIZES


@pytest.mark.slow
def test_calibration_block_regenerates():
    """About two minutes. Run before any `--write`, and on demand with `-m slow`."""
    full = sr.build_vectors(calibration=True)
    difference = first_difference(
        COMMITTED[SLOW_BLOCK[0]][SLOW_BLOCK[1]], full[SLOW_BLOCK[0]][SLOW_BLOCK[1]]
    )
    assert difference is None, difference
    assert sr.render_vectors(full) == sr.VECTORS_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 3. The --write path leaves the file unchanged
# ---------------------------------------------------------------------------


def test_generator_leaves_the_vector_file_unchanged(generated):
    """What people forget is `--write`. With the committed slow block spliced back in, the bytes
    the generator would write must be the bytes in the repository."""
    spliced = copy.deepcopy(generated)
    spliced[SLOW_BLOCK[0]][SLOW_BLOCK[1]] = COMMITTED[SLOW_BLOCK[0]][SLOW_BLOCK[1]]
    assert sr.render_vectors(spliced) == sr.VECTORS_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Hand-checked cases for the P6a functions. The vectors prove the two languages agree; these
# prove the Python agrees with arithmetic done by hand.
# ---------------------------------------------------------------------------


def test_two_site_rerandomization_null_by_hand():
    cells = [
        {"site_id": "a", "k1": 0, "n1": 2, "k2": 2, "n2": 2},
        {"site_id": "b", "k1": 1, "n1": 2, "k2": 1, "n2": 2},
    ]
    total = sr.rerandomization_null(cells, "sum")
    assert total["scale"] == 2 and total["min"] == -4 and len(total["pmf"]) == 9
    assert sr.rerandomization_statistic(cells, "sum") == {"value": 2, "scale": 2}
    assert sr.p_from_rerandomization(total, 2) == pytest.approx(0.5)
    assert sr.min_attainable_rerandomization_p(total) == pytest.approx(2 / 36)
    dispersion = sr.rerandomization_null(cells, "dispersion")
    assert sr.rerandomization_statistic(cells, "dispersion")["value"] == 4
    assert sr.p_from_rerandomization(dispersion, 4) == pytest.approx(20 / 36)
    assert sr.rerandomization_null([], "sum") is None
    assert (
        sr.rerandomization_null([{"site_id": "p", "k1": 5, "n1": 5, "k2": 5, "n2": 5}], "sum")
        is None
    )
    with pytest.raises(ValueError):
        sr.rerandomization_null([{"site_id": "x", "k1": 6, "n1": 5, "k2": 0, "n2": 5}], "sum")


def test_v1_model_gap_headline_values():
    block = COMMITTED["study_v2"]["rerandomization"]["v1_model_gap"]
    assert block["sum"]["statistic"] == 8 and block["sum"]["scale"] == 5
    assert round(block["sum"]["p"], 4) == 0.1750
    assert block["dispersion"]["statistic"] == 118
    assert block["dispersion"]["p"] == pytest.approx(4.57e-9, rel=0.01)
    gap = COMMITTED["study_v2"]["bootstrap_rows"]["v1_model_gap"]
    assert gap["n"] == 27 and gap["sites_moved"] == 11
    assert round(gap["ci"]["point"] * 100, 1) == 5.9
    assert gap["ci"]["lo"] < 0 < gap["ci"]["hi"]


def test_answered_trials_headline_counts():
    pooled = COMMITTED["study_v2"]["answered_trials"]["pooled"]
    assert pooled["recorded"] == 280 and pooled["answered"] == 172
    assert pooled["matched"] == 146 and pooled["wrong_answer"] == 0
    assert pooled["corroborated_blocked"] == 0 and pooled["self_reported_blocked"] == 26
    assert pooled["self_reported_split"] == {
        "off_site": 3,
        "blank_report": 4,
        "on_site_report": 19,
        "first_observation": 2,
    }
    assert pooled["not_answered"] == {
        "count": 108,
        "by_failure_mode": {"error": 45, "navigation_stuck": 6, "timeout": 57},
    }


def test_group_split_and_sensitivity_headline_values():
    lite = COMMITTED["study_v2"]["group_split"]["gemini-3.5-flash-lite"]
    assert lite["published"]["all_succeeded"]["count"] == 11
    assert round(lite["published"]["all_succeeded"]["mean"], 1) == 72.1
    assert lite["published"]["all_failed"]["count"] == 9
    assert round(lite["published"]["all_failed"]["mean"], 1) == 68.1
    assert lite["rule_b"]["removed"] == ["trimet"]
    assert round(lite["rule_b"]["all_failed"]["mean"], 1) == 64.4
    assert round(lite["rule_b_and_d_conditional"]["all_failed"]["mean"], 1) == 66.7
    sensitivity = COMMITTED["study_v2"]["sensitivity"]
    assert sensitivity["gemini-3.5-flash-lite"]["rule_b"]["n"] == 26
    assert round(sensitivity["gemini-3.5-flash-lite"]["rule_b"]["rho"], 3) == 0.129
    assert round(sensitivity["gemini-3.6-flash"]["rule_b"]["rho"], 3) == -0.006


def test_registrable_domain_rule():
    assert sr.registrable_domain("https://www.zalando.pt/x.html") == "zalando.pt"
    assert sr.registrable_domain("https://financialaid.oregonstate.edu/") == "oregonstate.edu"
    assert sr.registrable_domain("http://127.0.0.1:3100/exhibit") == "127.0.0.1"
    assert sr.registrable_domain("chrome-error://chromewebdata/") == "chromewebdata"
    assert sr.registrable_domain("https://user:pw@Shop.Example.COM:8443/x") == "example.com"
    assert sr.registrable_domain("about:blank") is None
    assert sr.registrable_domain("") is None


def test_x_axis_decomposition_headline_values():
    block = COMMITTED["x_axis_decomposition"]
    assert len(block["resolved"]) == 20 and len(block["ambiguous"]) == 8
    assert block["assignments"] == 256 and block["inconsistent"] == []
    assert len(block["identical_input"]["sites"]) == 14
    assert block["identical_input"]["span"] == {"min": 3, "max": 50}
    assert round(block["measured"]["rho_lh_total_cls"]["median"], 2) == 0.68
    lite = block["alternative_rule"]["agents"]["gemini-3.5-flash-lite"]["gap"]
    assert round(lite["median"] * 100, 1) == -11.0
    assert (round(lite["min"] * 100, 1), round(lite["max"] * 100, 1)) == (-31.3, 6.7)
    flash = block["alternative_rule"]["agents"]["gemini-3.6-flash"]["gap"]
    assert round(flash["median"] * 100, 1) == -2.6
    assert (round(flash["min"] * 100, 1), round(flash["max"] * 100, 1)) == (-23.3, 15.6)
