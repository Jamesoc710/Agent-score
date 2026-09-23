"""HC4 and HC12, the health-card gates P4 builds (design S2-6 §4)."""

import importlib.util
import json
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "health_card", Path(__file__).resolve().parent.parent / "health-card.py"
)
health_card = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(health_card)


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(health_card, "DATA", tmp_path)
    (tmp_path / "lhr" / "b").mkdir(parents=True)
    (tmp_path / "lhr" / "b" / "stripe.1.json").write_text(json.dumps({"lighthouseVersion": "13.3.0"}))
    (tmp_path / "manifest-b.json").write_text(
        json.dumps({"schema_version": 1, "batch_label": "b", "finished_at": None, "finished_at_null_reason": "running"})
    )
    return tmp_path


def write_rows(data, n):
    rows = {f"site{i}": {"site_id": f"site{i}"} for i in range(n)}
    (data / "lighthouse-b.json").write_text(json.dumps(rows))


def test_hc4_blocks_below_the_expected_count_and_names_the_failures(data):
    write_rows(data, 27)
    (data / "lighthouse-b.failures.json").write_text(
        json.dumps({"costco": {"repeats": [{"error_class": "access_failure"}, {"error_class": "timeout"}]}})
    )
    gate = health_card.hc4("b", 28)
    assert gate["verdict"] == "block"
    assert gate["detail"]["not_measured"] == ["costco"]
    assert gate["detail"]["failure_classes"] == {"costco": ["access_failure", "timeout"]}
    write_rows(data, 28)
    assert health_card.hc4("b", 28)["verdict"] == "pass"


def test_hc12_blocks_an_invalid_manifest_and_warns_over_budget(data, monkeypatch):
    assert health_card.hc12("b")["verdict"] == "pass"

    (data / "manifest-b.json").write_text(json.dumps({"schema_version": 1, "batch_label": "b", "finished_at": None}))
    gate = health_card.hc12("b")
    assert gate["verdict"] == "block"
    assert "bare nulls: finished_at" in gate["detail"]["manifest_problems"]

    (data / "manifest-b.json").write_text(json.dumps({"schema_version": 1, "batch_label": "b"}))
    monkeypatch.setattr(health_card, "LHR_BUDGET_BYTES", 1)
    assert health_card.hc12("b")["verdict"] == "warn"


def test_bare_nulls_matches_the_typescript_rule():
    assert health_card.bare_nulls({"a": None, "b": {"c": None, "c_null_reason": "x"}, "d": [None]}) == ["a", "d[0]"]


def test_main_writes_the_card_and_exits_nonzero_on_block(data):
    write_rows(data, 1)
    assert health_card.main(["--batch", "b", "--expected", "2"]) == 1
    card = json.loads((data / "health-b.json").read_text())
    assert card["verdict"] == "block"
    assert set(card["gates"]) == {"HC4", "HC12"}
