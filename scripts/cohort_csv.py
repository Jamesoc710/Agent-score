"""
Python mirror of scripts/cohort-csv.ts — reads data/cohort.csv, the canonical 28-site
cohort, validating on the way in so CSV drift surfaces with a row number. Keep the two
readers in sync; the TS one is used by the seed and Lane 1, this one by Lane 2 and the
scoring tests.

AGENTRANK_COHORT_CSV points the lanes at a different pre-registered row set without
touching the frozen loop or the canonical cohort. It exists for the authored Goodhart
exhibit (data/exhibit-cohort.csv, docs/EXHIBIT.md), which is measured by the same lanes
into its own batch_label and is never part of the 28-site cohort. Unset, the default is
byte-for-byte the previous behaviour, and a test pins that.
"""

from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Dict, List

TIERS = {"anchor", "middle", "government", "small_business", "off_diagonal", "blocker"}
REQUIRED = ("site_id", "name", "tier", "start_url", "question", "answer_substring")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COHORT_CSV_PATH = REPO_ROOT / "data" / "cohort.csv"


def default_csv_path() -> Path:
    """The row set the lanes read: data/cohort.csv unless AGENTRANK_COHORT_CSV overrides it."""
    override = os.environ.get("AGENTRANK_COHORT_CSV")
    return Path(override) if override else DEFAULT_COHORT_CSV_PATH


COHORT_CSV_PATH = DEFAULT_COHORT_CSV_PATH


def read_cohort(csv_path: Path | None = None) -> List[Dict[str, str]]:
    csv_path = csv_path if csv_path is not None else default_csv_path()
    sites: List[Dict[str, str]] = []
    seen: set[str] = set()

    with open(csv_path, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            where = f"{Path(csv_path).name} row {i + 2}"  # +2: header plus 1-based rows
            site = {k: (v or "").strip() for k, v in row.items() if k is not None}

            for col in REQUIRED:
                if not site.get(col):
                    raise ValueError(f'{where}: missing required column "{col}"')
            if site["site_id"] in seen:
                raise ValueError(f'{where}: duplicate site_id "{site["site_id"]}"')
            seen.add(site["site_id"])
            if site["tier"] not in TIERS:
                raise ValueError(
                    f'{where}: tier "{site["tier"]}" is not one of {", ".join(sorted(TIERS))}'
                )

            site.setdefault("match_rule", "")
            site.setdefault("flag", "")
            site.setdefault("answer_note", "")
            sites.append(site)

    if not sites:
        raise ValueError(f"{csv_path} has no rows")
    return sites
