"""
Tests for the authored Goodhart exhibit (docs/EXHIBIT.md).

The exhibit is two authored pages measured by the same frozen lanes as the cohort, into
their own batch_label. Its rows live in data/exhibit-cohort.csv, never in data/cohort.csv.
Three things are pinned here:

  1. The exhibit rows obey the same pre-registration invariants the cohort rows do: the
     match_rule parses, the registered answer matches itself, and the built prompt never
     leaks it.
  2. The cohort reader's default is unchanged. AGENTRANK_COHORT_CSV is what lets the lanes
     read a different row set; with it unset the readers must still resolve data/cohort.csv,
     because the v1 loop is frozen and its inputs are frozen with it.
  3. The pair is matched. The two pages are byte-identical up to the marked render block,
     they carry the same 40-row dataset, and the registered answer is in that dataset. This
     is what makes "they differ only in the mechanism" checkable rather than asserted.
"""

import os
from pathlib import Path

import pytest

import cohort_csv
from agent_task import build_task
from cohort_csv import DEFAULT_COHORT_CSV_PATH, default_csv_path, read_cohort
from scoring import parse_match_rule, score_answer

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXHIBIT_CSV = REPO_ROOT / "data" / "exhibit-cohort.csv"
PAGE_A = REPO_ROOT / "public" / "exhibit" / "pair-a.html"
PAGE_B = REPO_ROOT / "public" / "exhibit" / "pair-b.html"

# The line the two pages diverge on. Everything above it must be identical.
MECHANISM_MARKER = "  // MECHANISM (exhibit "

EXHIBIT = read_cohort(EXHIBIT_CSV)


# ---------------------------------------------------------------------------
# 1. The exhibit rows are pre-registered on the same terms as the cohort rows
# ---------------------------------------------------------------------------


def test_exhibit_has_exactly_the_matched_pair():
    assert [s["site_id"] for s in EXHIBIT] == ["exhibit_a", "exhibit_b"]


@pytest.mark.parametrize("site", EXHIBIT, ids=[s["site_id"] for s in EXHIBIT])
def test_exhibit_match_rule_parses(site):
    parse_match_rule(site["match_rule"])


@pytest.mark.parametrize("site", EXHIBIT, ids=[s["site_id"] for s in EXHIBIT])
def test_exhibit_registered_candidate_matches_itself(site):
    for cand in site["answer_substring"].split(" | "):
        output = f"After browsing, the agent reports: the answer is {cand}, per the page."
        assert score_answer(output, site["answer_substring"], site["match_rule"]).success


@pytest.mark.parametrize("site", EXHIBIT, ids=[s["site_id"] for s in EXHIBIT])
def test_exhibit_prompt_never_contains_the_answer(site):
    """Leakage guard, identical to the cohort's: the prompt must not score as a success."""
    assert not score_answer(
        build_task(site), site["answer_substring"], site["match_rule"]
    ).success


def test_both_halves_register_the_same_question_and_answer():
    """A matched pair that asked two different questions would prove nothing."""
    a, b = EXHIBIT
    for column in ("question", "answer_substring", "match_rule"):
        assert a[column] == b[column], f"the pair disagrees on {column}"


def test_the_exhibit_is_not_in_the_cohort():
    """The 28-site cohort must not gain a row, and the exhibit must not borrow one."""
    cohort_ids = {s["site_id"] for s in read_cohort(DEFAULT_COHORT_CSV_PATH)}
    assert len(cohort_ids) == 28
    assert cohort_ids.isdisjoint({s["site_id"] for s in EXHIBIT})


# ---------------------------------------------------------------------------
# 2. The default row set is still the frozen cohort
# ---------------------------------------------------------------------------


def test_default_csv_path_is_the_canonical_cohort(monkeypatch):
    monkeypatch.delenv("AGENTRANK_COHORT_CSV", raising=False)
    assert default_csv_path() == DEFAULT_COHORT_CSV_PATH
    assert DEFAULT_COHORT_CSV_PATH == cohort_csv.REPO_ROOT / "data" / "cohort.csv"


def test_override_is_honoured_when_set(monkeypatch):
    monkeypatch.setenv("AGENTRANK_COHORT_CSV", str(EXHIBIT_CSV))
    assert default_csv_path() == EXHIBIT_CSV
    assert [s["site_id"] for s in read_cohort()] == ["exhibit_a", "exhibit_b"]


def test_the_test_process_reads_the_cohort_by_default():
    """A stray override in the environment would silently re-point the whole suite."""
    assert os.environ.get("AGENTRANK_COHORT_CSV") is None


# ---------------------------------------------------------------------------
# 3. The pair is matched: identical up to the render block
# ---------------------------------------------------------------------------


def _split_at_mechanism(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    assert text.count(MECHANISM_MARKER) == 1, f"{path.name}: mechanism marker is not unique"
    head, _, tail = text.partition(MECHANISM_MARKER)
    return head, tail


def test_the_two_pages_are_identical_above_the_render_block():
    """Markup, styling, copy and the inline dataset are shared byte-for-byte."""
    head_a, _ = _split_at_mechanism(PAGE_A)
    head_b, _ = _split_at_mechanism(PAGE_B)
    assert head_a == head_b


def test_both_pages_carry_the_same_registered_answer_in_their_dataset():
    answer = EXHIBIT[0]["answer_substring"]
    for path in (PAGE_A, PAGE_B):
        assert answer in path.read_text(encoding="utf-8"), f"{path.name} lost the target row"


def test_the_registered_answer_is_not_in_the_shared_prose():
    """The answer must reach the reader only through the table, never through the copy."""
    answer = EXHIBIT[0]["answer_substring"]
    head_a, _ = _split_at_mechanism(PAGE_A)
    before_data = head_a.split('<script type="application/json"')[0]
    assert answer not in before_data
