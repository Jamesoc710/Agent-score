"""Plan rule 11: no numeral enters an append-only file before it is pinned.

docs/METHODOLOGY.md and docs/EXHIBIT.md are append-only. From 2026-09-22 (the date the rule was
adopted, plan section 8) every dated amendment block appended to either file may print a
numeral only if it is one of:

  1. a registered protocol constant (S2-2 section 12): five, seven, 15 steps, 90 s, 180 s,
     0.05, 8 s, 1280x800;
  2. a value in scripts/tests/stats-vectors.json, in any of the forms a page prints it (as
     recorded, rounded to up to four decimals, as a percentage, or in scientific notation);
  3. a value or version in a committed artifact: data/*.json, data/*.csv, data/env-*.txt, the
     reconstruction reports under data/lhr/, and the pins in package.json.

A dated block is any heading carrying an ISO date; it runs to the next heading of the same or a
higher level. Blocks dated before 2026-09-22 are exempt by date (today: EXHIBIT's measured
result of 2026-08-30) and are listed rather than checked. A placeholder date (2026-09-XX) is
never allowed in a committed append. Dates, times, commit hashes and identifiers that mix letters
and digits (batch labels, model ids, tags) are not numerals. Number words are read as numerals
so "five" and "twenty-eight" are held to the same rule as their digits.

The transcripts in data/agent-runs-*.jsonl are deliberately not a source: a number inside a
model's reasoning is text, not a measurement, and whitelisting it would whitelist almost
everything.
"""

import csv
import json
import re
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DOCS = [REPO_ROOT / "docs" / "METHODOLOGY.md", REPO_ROOT / "docs" / "EXHIBIT.md"]
VECTORS_PATH = REPO_ROOT / "scripts" / "tests" / "stats-vectors.json"
RULE_DATE = "2026-09-22"

PROTOCOL_CONSTANTS = {"5", "7", "15", "90", "180", "0.05", "8", "1280", "800", "1280x800"}

NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
}

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
DATE = re.compile(r"\b\d{4}-\d{2}-(\d{2}|XX)(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b")
PLACEHOLDER = re.compile(r"\b\d{4}-\d{2}-XX\b")
TIME = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?Z?\b")
CODE_SPAN = re.compile(r"`[^`\n]*`")
# Anything mixing letters and digits: lh-v2-20260923, gemini-3.5-flash-lite, P6a, v13.5.0, 5v5.
IDENTIFIER = re.compile(r"[A-Za-z_][\w.-]*\d[\w.-]*|\d[\w.-]*[A-Za-z_][\w.-]*")
NUMERAL = re.compile(r"(?<![\w.])[−+-]?\d+(?:[.,]\d+)*(?:e[−+-]?\d+)?(?![\w])")
WORD = re.compile(r"\b([a-z]+(?:-[a-z]+)?)\b", re.IGNORECASE)
VERSION_STRING = re.compile(r"^\d+(?:\.\d+)+$")
PLAIN_NUMBER = re.compile(r"^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# The dated blocks
# ---------------------------------------------------------------------------


def dated_blocks(text: str, source: str) -> list[dict]:
    lines = text.splitlines()
    headings = []
    for index, line in enumerate(lines):
        match = HEADING.match(line)
        if match:
            headings.append((index, len(match.group(1)), match.group(2)))

    blocks = []
    for position, (start, level, title) in enumerate(headings):
        match = DATE.search(title)
        if not match:
            continue
        end = len(lines)
        for later_start, later_level, _ in headings[position + 1 :]:
            if later_level <= level:
                end = later_start
                break
        blocks.append(
            {
                "source": source,
                "title": title,
                "date": match.group(0)[:10],
                "placeholder": bool(PLACEHOLDER.search(title)),
                "text": title + "\n" + "\n".join(lines[start + 1 : end]),
            }
        )
    return blocks


# ---------------------------------------------------------------------------
# The allowed numerals
# ---------------------------------------------------------------------------


def _half_up(value: float, decimals: int) -> str:
    return str(Decimal(repr(value)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP))


def number_forms(value) -> set[str]:
    """Every way a page might print one pinned number."""
    forms: set[str] = set()
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return forms
    if isinstance(value, int):
        forms.add(str(abs(value)))
    number = abs(float(value))
    if number != number or number in (float("inf"),):
        return forms
    forms.add(repr(number))
    for decimals in range(0, 5):
        forms.add(f"{number:.{decimals}f}")
        forms.add(_half_up(number, decimals))
    for decimals in range(0, 3):
        forms.add(f"{number * 100:.{decimals}f}")
        forms.add(_half_up(number * 100, decimals))
    for digits in range(1, 4):
        forms.add(_normalize_exponent(f"{number:.{digits}e}"))
    return forms


def _normalize_exponent(text: str) -> str:
    return re.sub(r"e([-+])0*(\d)", r"e\1\2", text).replace("e+", "e")


def _walk_json(value, forms: set[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            _add_string(key, forms)
            _walk_json(child, forms)
    elif isinstance(value, list):
        for child in value:
            _walk_json(child, forms)
    elif isinstance(value, str):
        _add_string(value, forms)
    else:
        forms.update(number_forms(value))


def _add_string(text: str, forms: set[str]) -> None:
    stripped = text.strip().lstrip("^~=v")
    if VERSION_STRING.match(stripped):
        forms.add(stripped)
    elif PLAIN_NUMBER.match(stripped):
        forms.update(number_forms(float(stripped)))
        if "." not in stripped and "e" not in stripped.lower():
            forms.add(stripped.lstrip("+-"))


def artifact_paths() -> list[Path]:
    data = REPO_ROOT / "data"
    paths = sorted(data.glob("*.json")) + sorted(data.glob("*.csv")) + sorted(data.glob("env-*.txt"))
    paths += sorted((data / "lhr").glob("*/reconstruction.json"))
    paths.append(REPO_ROOT / "package.json")
    return [p for p in paths if p.exists()]


def allowed_numerals() -> set[str]:
    forms: set[str] = set(PROTOCOL_CONSTANTS)
    _walk_json(json.loads(VECTORS_PATH.read_text(encoding="utf-8")), forms)
    for path in artifact_paths():
        if path.suffix == ".json":
            _walk_json(json.loads(path.read_text(encoding="utf-8")), forms)
        elif path.suffix == ".csv":
            with path.open(newline="", encoding="utf-8") as handle:
                for row in csv.reader(handle):
                    for cell in row:
                        _add_string(cell, forms)
        else:
            for token in NUMERAL.findall(path.read_text(encoding="utf-8")):
                _add_string(token, forms)
    return forms


# ---------------------------------------------------------------------------
# The numerals in a block
# ---------------------------------------------------------------------------


def numerals_in(text: str) -> list[str]:
    """Every numeral token in a block, digits and number words, after the non-numerals are
    removed: code spans that name things, dates and times, and mixed identifiers."""
    cleaned = CODE_SPAN.sub(lambda m: " " if re.search(r"[A-Za-z]", m.group(0)) else m.group(0), text)
    cleaned = DATE.sub(" ", cleaned)
    cleaned = TIME.sub(" ", cleaned)
    cleaned = cleaned.replace("1280x800", " ")
    cleaned = IDENTIFIER.sub(" ", cleaned)
    tokens = [_normalize_token(t) for t in NUMERAL.findall(cleaned)]
    for word in WORD.findall(cleaned):
        value = _word_value(word.lower())
        if value is not None:
            tokens.append(str(value))
    return tokens


def _normalize_token(token: str) -> str:
    text = token.replace("−", "-").lstrip("+-")
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", text):
        text = text.replace(",", "")
    return _normalize_exponent(text)


def _word_value(word: str) -> int | None:
    if word in NUMBER_WORDS:
        return NUMBER_WORDS[word]
    if "-" in word:
        tens, _, units = word.partition("-")
        if tens in NUMBER_WORDS and units in NUMBER_WORDS and NUMBER_WORDS[tens] >= 20 and NUMBER_WORDS[units] < 10:
            return NUMBER_WORDS[tens] + NUMBER_WORDS[units]
    return None


def unpinned_numerals(text: str, allowed: set[str]) -> list[str]:
    unpinned = []
    for token in numerals_in(text):
        candidates = {token, token.replace(",", ".")}
        if not candidates & allowed:
            unpinned.append(token)
    return unpinned


# ---------------------------------------------------------------------------
# The tests
# ---------------------------------------------------------------------------

BLOCKS = [block for doc in DOCS for block in dated_blocks(doc.read_text(encoding="utf-8"), doc.name)]
CHECKED = [b for b in BLOCKS if b["placeholder"] or b["date"] >= RULE_DATE]
EXEMPT = [b for b in BLOCKS if b not in CHECKED]
ALLOWED = allowed_numerals()


def test_blocks_before_the_rule_are_exempt_by_date():
    """Existing text predates the rule and is not rewritten (the files are append-only)."""
    for block in EXEMPT:
        assert block["date"] < RULE_DATE, block["title"]
    exempt_titles = [b["title"] for b in EXEMPT]
    assert any("2026-08-30" in title for title in exempt_titles), (
        "EXHIBIT's measured-result block of 2026-08-30 should be found and exempt"
    )


def test_no_placeholder_date_in_a_dated_block():
    placeholders = [f"{b['source']}: {b['title']}" for b in BLOCKS if b["placeholder"]]
    assert not placeholders, f"a committed append carries a placeholder date: {placeholders}"


def test_every_numeral_in_a_dated_append_is_pinned():
    """On or after 2026-09-22 every numeral must be registered, pinned or in an artifact. With no
    such block committed yet the check passes on the exempt list alone, and says so."""
    failures = {}
    for block in CHECKED:
        unpinned = unpinned_numerals(block["text"], ALLOWED)
        if unpinned:
            failures[f"{block['source']}: {block['title']}"] = unpinned
    assert not failures, (
        "numerals in a dated append that are neither registered constants, pinned in "
        f"stats-vectors.json nor in a committed artifact: {failures}"
    )
    if not CHECKED:
        assert EXEMPT, "no dated blocks at all; the parser found nothing to exempt or check"


# --- the checker itself, exercised today so it is not vacuous ------------------


def test_checker_accepts_registered_pinned_and_artifact_numerals():
    text = (
        "### 2026-09-23: a block (registered on 2026-09-23)\n"
        "Five trials per site, 15 steps and 90 s; 180 s of site time on v2; 0.05; 8 s; 1280x800.\n"
        "Of 172 answered trials 146 matched the key and 26 were self-reported blocks (3 off-site, "
        "4 blank, 19 on the site). n = 26, rho +0.129 and −0.006; the range −31.3 to +6.7 and "
        "−23.3 to +15.6 over the eight unresolved denominators; 4.57e-9. Lighthouse 13.3.0 with "
        "companions at 13.4.1 and 13.5.0 in batch `lh-v2-20260923`, model gemini-3.5-flash-lite, "
        "commit `8b22f46`, twenty-eight sites, started 07:47:40Z.\n"
    )
    assert unpinned_numerals(text, ALLOWED) == []


def test_checker_rejects_an_unpinned_numeral():
    text = "### 2026-09-23: a block\nThe mean moved 0.4321 points over 123456 trials, or 98.76%.\n"
    assert unpinned_numerals(text, ALLOWED) == ["0.4321", "123456", "98.76"]


def test_checker_reads_headings_and_dates():
    text = (
        "# Title\n\n## Old (appended 2026-08-30, after the run)\n\nbody 0.4321\n\n"
        "### 2026-09-XX: draft\n\nbody\n\n### 2026-09-25: real\n\nbody 0.4321\n\n#### inner\n\nmore\n\n## Undated\n\n0.4321\n"
    )
    blocks = dated_blocks(text, "t.md")
    assert [b["date"] for b in blocks] == ["2026-08-30", "2026-09-XX", "2026-09-25"]
    assert [b["placeholder"] for b in blocks] == [False, True, False]
    assert "more" in blocks[2]["text"] and "Undated" not in blocks[2]["text"]
    assert unpinned_numerals(blocks[2]["text"], ALLOWED) == ["0.4321"]
