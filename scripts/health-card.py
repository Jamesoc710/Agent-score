"""Health card for a batch: HC4 and HC12 only, the slice P4 needs (design S2-6 §4, §13).

    python scripts/health-card.py --batch <label> --expected <n>

HC4   Lane 1 completeness: rows in data/lighthouse-<batch>.json against the sites expected
      (the cohort's 28 for a dated batch), with the failures sidecar named. Below: block.
HC12  data/lhr/<batch>/ gzipped byte total against the 25 MB commit budget (over: warn), and the
      manifest's validity: parses, schema_version 1, its batch_label, no bare null (invalid: block).

Reads artifacts only; no database, no model. Writes data/health-<batch>.json, prints a table,
exits 1 on any blocking gate. The gates live in Python until a page renders a gate id (D10).
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path("data")
LHR_BUDGET_BYTES = 25 * 1024 * 1024
MANIFEST_SCHEMA_VERSION = 1


def bare_nulls(value, at=""):
    """Dotted paths of nulls with no sibling <field>_null_reason (the rule in scripts/manifest.ts)."""
    out = []
    if isinstance(value, list):
        for i, item in enumerate(value):
            where = f"{at}[{i}]"
            out.extend([where] if item is None else bare_nulls(item, where))
    elif isinstance(value, dict):
        for key, child in value.items():
            where = f"{at}.{key}" if at else key
            if child is None:
                reason = value.get(f"{key}_null_reason")
                if not isinstance(reason, str) or not reason.strip():
                    out.append(where)
            else:
                out.extend(bare_nulls(child, where))
    return out


def hc4(batch: str, expected: int) -> dict:
    rows_path = DATA / f"lighthouse-{batch}.json"
    rows = json.loads(rows_path.read_text()) if rows_path.exists() else {}
    failures_path = DATA / f"lighthouse-{batch}.failures.json"
    failures = json.loads(failures_path.read_text()) if failures_path.exists() else {}
    measured = len(rows)
    return {
        "id": "HC4",
        "value": measured,
        "threshold": expected,
        "verdict": "pass" if measured >= expected else "block",
        "detail": {
            "not_measured": sorted(failures),
            "failure_classes": {
                site: sorted({r.get("error_class") or "unknown" for r in f.get("repeats", [])})
                for site, f in sorted(failures.items())
            },
        },
    }


def hc12(batch: str) -> dict:
    lhr_dir = DATA / "lhr" / batch
    files = sorted(lhr_dir.glob("*.json")) if lhr_dir.exists() else []
    raw = sum(f.stat().st_size for f in files)
    gz = sum(len(gzip.compress(f.read_bytes(), compresslevel=6)) for f in files)

    manifest_path = DATA / f"manifest-{batch}.json"
    problems = []
    if not manifest_path.exists():
        problems.append("no manifest")
    else:
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as err:
            manifest = None
            problems.append(f"manifest does not parse: {err}")
        if isinstance(manifest, dict):
            if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
                problems.append(f"schema_version is {manifest.get('schema_version')!r}")
            if manifest.get("batch_label") != batch:
                problems.append(f"batch_label is {manifest.get('batch_label')!r}")
            nulls = bare_nulls(manifest)
            if nulls:
                problems.append(f"bare nulls: {', '.join(nulls)}")
        elif manifest is not None:
            problems.append("manifest is not an object")

    if problems:
        verdict = "block"
    elif gz > LHR_BUDGET_BYTES:
        verdict = "warn"
    else:
        verdict = "pass"
    return {
        "id": "HC12",
        "value": gz,
        "threshold": LHR_BUDGET_BYTES,
        "verdict": verdict,
        "detail": {
            "lhr_files": len(files),
            "lhr_bytes": raw,
            "lhr_bytes_gzip": gz,
            "over_budget": gz > LHR_BUDGET_BYTES,
            "manifest_problems": problems,
        },
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--batch", required=True)
    parser.add_argument("--expected", type=int, required=True)
    args = parser.parse_args(argv)

    gates = [hc4(args.batch, args.expected), hc12(args.batch)]
    verdicts = {g["verdict"] for g in gates}
    overall = "block" if "block" in verdicts else "warn" if "warn" in verdicts else "pass"
    card = {
        "batch_label": args.batch,
        "computed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "gates": {g["id"]: g for g in gates},
        "verdict": overall,
    }
    (DATA / f"health-{args.batch}.json").write_text(json.dumps(card, indent=2) + "\n")

    print(f"\nHealth card: {args.batch}")
    print(f"  HC4   rows {gates[0]['value']} of {gates[0]['threshold']}".ljust(40) + gates[0]["verdict"])
    if gates[0]["detail"]["not_measured"]:
        print(f"        not measured: {', '.join(gates[0]['detail']['not_measured'])}")
    d = gates[1]["detail"]
    print(f"  HC12  {d['lhr_files']} LHRs, {d['lhr_bytes_gzip'] / 1e6:.1f} MB gzipped".ljust(40) + gates[1]["verdict"])
    for problem in d["manifest_problems"]:
        print(f"        manifest: {problem}")
    print(f"  verdict: {overall}\n")
    return 1 if overall == "block" else 0


if __name__ == "__main__":
    sys.exit(main())
