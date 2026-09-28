#!/usr/bin/env python3
"""Fetch WebBench's eight results CSVs at a pinned commit and derive trials.csv (S2-8 §2, §4).

    python data/external/webbench/fetch.py                  # download, verify, write trials.csv
    python data/external/webbench/fetch.py --from-dir DIR   # same, from local copies of the eight

The only network step in data/external/, run by hand and never by the test suite. Each file must
match its pinned sha256 or nothing is written. The upstream files are 11.7 MB and carry every
agent's output text, which the analysis never reads, so only the six columns it needs are kept.

A trial is a row whose label column is Success or Failure; the six unlabelled rtrvr rows
("Omit") are dropped. The site is the start URL's host, lowercased, leading "www." removed, and
nothing coarser. Stdlib only. MIT, Copyright (c) 2025 Halluminate: see LICENSE.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
COMMIT = "ea7a1628443321363989f354401f0653e0cba6f4"
RAW = f"https://raw.githubusercontent.com/Halluminate/WebBench/{COMMIT}/results/"

# (agent, file, label column, sha256 of the file at COMMIT)
FILES = [
    ("anthropic_cua", "anthropicfinal.csv", "Anthropic_Eval",
     "d7021b5402039784fc17acd26aac24b6c8d405546c5b0e927e8566b6e2042306"),
    ("browseruse", "browserusefinal.csv", "BUEval",
     "b4e03d91af37b4dc27dac36e04b08ae206034a9816c05ffd1779478f8b604a5e"),
    ("convergence_hitl", "convergencehitlfinal.csv", "convergence_hitl_eval",
     "d78a69a646265ec88a8ae8634b6a5c4b2daad9de21eeead35ae5fec3fd9f35ce"),
    ("openai_cua", "openaicuafinal.csv", "CUAEval",
     "bdae0ec40b8cddcc5ad2b5be0cb264eee575a5b0450b3de4d841add738a2e38f"),
    ("operator_hitl", "operatorhitlfinal.csv", "operator_hitl_eval",
     "9bb7e0d31b7dd9a8cc43a379efc1c32ffbef6d6acd070aa623fb408848f33440"),
    ("rtrvr", "rtrvrfinal.csv", "Human Label",
     "44671dbb7ab9ff1b76a506e71e13a81766cf2eca538207752c53cd8d7f2cc6cb"),
    ("skyvern_browserbase", "skyvern2.0browserbasefinal.csv", "Browserbase_SkyvernEval",
     "77cd32b752cc449308c6f988779223c072a2e5cc8f2dc7d5882f735178f02c33"),
    ("skyvern", "skyvern2.0final.csv", "Skyvern2.0Eval",
     "a831004bc5d9be32bcfeee315bbf600f775146552c9f389d10bf65444215958f"),
]
LABELS = ("Success", "Failure")
COLUMNS = ["agent", "task_id", "site", "category", "difficulty", "outcome"]


def site_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def read(name: str, from_dir: Path | None) -> bytes:
    if from_dir is not None:
        return (from_dir / name).read_bytes()
    with urllib.request.urlopen(RAW + name, timeout=120) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--from-dir", type=Path, default=None,
                        help="read the eight files from here instead of downloading them")
    parser.add_argument("--out-dir", type=Path, default=HERE)
    args = parser.parse_args()

    trials = []
    for agent, name, label, pinned in FILES:
        data = read(name, args.from_dir)
        digest = hashlib.sha256(data).hexdigest()
        if digest != pinned:
            raise SystemExit(f"{name}: sha256 {digest} is not the pinned {pinned}; nothing written")
        rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))
        kept = [r for r in rows if r[label] in LABELS]
        print(f"{name:32s} {len(data):8d} B  sha256 ok  rows {len(rows)}  labelled {len(kept)}")
        for r in kept:
            trials.append([agent, r["ID"], site_of(r["Starting URL"]), r["Category"],
                           r["Difficulty"], r[label]])

    out = args.out_dir / "trials.csv"
    with out.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        writer.writerows(trials)
    print(f"wrote {out}: {len(trials)} trials")


if __name__ == "__main__":
    main()
