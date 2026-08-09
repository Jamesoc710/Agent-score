"""
Python mirror of scripts/cohort-csv.ts — reads data/cohort.csv, the canonical 28-site
cohort, validating on the way in so CSV drift surfaces with a row number. Keep the two
readers in sync; the TS one is used by the seed and Lane 1, this one by Lane 2 and the
scoring tests.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List

TIERS = {"anchor", "middle", "government", "small_business", "off_diagonal", "blocker"}
REQUIRED = ("site_id", "name", "tier", "start_url", "question", "answer_substring")

REPO_ROOT = Path(__file__).resolve().parent.parent
COHORT_CSV_PATH = REPO_ROOT / "data" / "cohort.csv"


def read_cohort(csv_path: Path = COHORT_CSV_PATH) -> List[Dict[str, str]]:
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
