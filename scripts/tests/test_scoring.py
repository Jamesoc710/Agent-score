"""
Tests for the METHODOLOGY.md scoring contract (scripts/scoring.py).

Three layers:
  1. scoring-vectors.json — the language-neutral contract cases; any port must pass them.
  2. Cohort-wide invariants — every real data/cohort.csv row parses, self-matches, and
     never leaks its answer into the task prompt.
  3. Parser strictness — unknown or conflicting match_rule directives fail loudly.
"""

import json
from pathlib import Path

import pytest

from agent_task import build_task
from cohort_csv import read_cohort
from scoring import MatchRuleError, parse_match_rule, score_answer

VECTORS = json.loads(
    (Path(__file__).parent / "scoring-vectors.json").read_text(encoding="utf-8")
)["cases"]

COHORT = read_cohort()


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_vector(case):
    result = score_answer(case["output"], case["answer_substring"], case["match_rule"])
    assert result.success == case["expected"], (
        f'{case["name"]}: expected {case["expected"]}, got {result.success} '
        f'(matched={result.matched!r})'
    )


def test_vectors_cover_every_cohort_match_rule():
    """Every distinct match_rule in the live cohort appears in at least one vector."""
    covered = {c["match_rule"] for c in VECTORS}
    missing = {s["match_rule"] for s in COHORT} - covered
    assert not missing, f"cohort match_rules with no vector coverage: {missing}"


@pytest.mark.parametrize("site", COHORT, ids=[s["site_id"] for s in COHORT])
def test_every_cohort_match_rule_parses(site):
    parse_match_rule(site["match_rule"])


@pytest.mark.parametrize("site", COHORT, ids=[s["site_id"] for s in COHORT])
def test_every_registered_candidate_matches_itself(site):
    """Each registered candidate, embedded in a plain sentence, must score as success."""
    for cand in site["answer_substring"].split(" | "):
        output = f"After browsing, the agent reports: the answer is {cand}, per the page."
        result = score_answer(output, site["answer_substring"], site["match_rule"])
        assert result.success, f'{site["site_id"]}: registered candidate {cand!r} did not match'


@pytest.mark.parametrize("site", COHORT, ids=[s["site_id"] for s in COHORT])
def test_task_prompt_never_contains_the_answer(site):
    """Leakage guard: the built prompt must never score as a successful answer."""
    prompt = build_task(site)
    result = score_answer(prompt, site["answer_substring"], site["match_rule"])
    assert not result.success, (
        f'{site["site_id"]}: prompt leaks registered answer {result.matched!r}'
    )


def test_unknown_directive_raises():
    with pytest.raises(MatchRuleError):
        parse_match_rule("fuzzy semantic match")


def test_unknown_strip_item_raises():
    with pytest.raises(MatchRuleError):
        parse_match_rule("strip $, spaces")


def test_conflicting_comma_directives_raise():
    with pytest.raises(MatchRuleError):
        parse_match_rule("strip $, commas; DO NOT comma-strip")


def test_empty_answer_substring_raises():
    with pytest.raises(ValueError):
        score_answer("anything", "", "exact")
