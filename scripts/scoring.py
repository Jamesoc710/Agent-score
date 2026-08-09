"""
Scoring module — the match contract from docs/METHODOLOGY.md, "The scoring contract".

Success on a single run = the agent's final output contains the site's pre-registered
answer_substring after normalization. This module is the single implementation of that
contract; the harness (lane2-agent.py) must import it and never score any other way.
The unit tests in scripts/tests/ run every case in scoring-vectors.json — a future
TypeScript port must pass the identical vector file.

Contract rules implemented (numbering matches METHODOLOGY.md):
  1. Case-insensitive; trim and collapse whitespace.
  2. Currency symbols ($, €, £) stripped from both sides.
  3. Numeric word-boundary: a numeric value never matches inside a longer number,
     including across a decimal point ("67" does not match "26.67%").
  4. Whole-dollar prices: thousands commas stripped only where the row's match_rule
     says so, and only between digits (sentence commas survive); a trailing ".00" on
     an integer candidate's occurrence is always accepted ("1848" matches "1,848.00").
  5. Prices with meaningful cents match their exact decimal form.
  6. any-of: answer_substring splits on " | "; any candidate matching is success.
  7. (Prompt parameterization lives in agent_task.py, not here.)

Exceptions (METHODOLOGY "Exceptions and special handling"):
  - zalando: comma is the decimal separator; its row must not comma-strip, enforced by
    the "DO NOT comma-strip" directive conflicting with any strip-commas directive.
  - voodoo: the phone alternate is matched against the digit stream of the output
    ("(503) 241-4704" matches "5032414704") via the "phone alt digits-only" directive.

One interpretation beyond the letter of the contract, chosen to prevent false
positives: candidates with alphanumeric edges also get word boundaries at those edges,
so "Visa" cannot match inside "advisable". Digit edges use the stricter numeric rules.

match_rule strings are parsed by a strict tokenizer: every clause must be recognized,
and unknown directives raise MatchRuleError so CSV drift breaks tests instead of
silently mis-scoring. Parenthetical text is a comment ("numeric word-boundary
($20 != $200)" parses as "numeric word-boundary").
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional


class MatchRuleError(ValueError):
    """A match_rule clause the tokenizer does not recognize, or a conflicting pair."""


@dataclass(frozen=True)
class MatchFlags:
    strip_commas: bool = False
    forbid_comma_strip: bool = False
    phone_digits_only: bool = False


@dataclass(frozen=True)
class ScoreResult:
    success: bool
    matched: Optional[str]  # the registered candidate that matched, if any


# Clauses that name behavior the pipeline always applies (rules 1-3, 5, 6) or that are
# purely advisory. They parse to no flag so the vocabulary stays closed and auditable.
_NOOP_CLAUSES = {
    "",
    "exact",
    "exact phrase",
    "case/space-normalize",
    "case-normalize",
    "any-of",
    "avoid table-dump",
    "numeric word-boundary",
    "keep decimal",
    "keep decimals",
    "match decimal",
}

# Items allowed after "strip": currency is always stripped anyway; "commas" is the one
# that sets a flag; "trailing .00" names the always-on integer allowance from rule 4.
_STRIP_ITEMS = {"$": None, "€": None, "euro symbol": None, "commas": "strip_commas", "trailing .00": None}

_CURRENCY = "$€£"


def _canon(text: str) -> str:
    text = re.sub(r"\([^)]*\)", "", text)  # parentheticals are comments
    return re.sub(r"\s+", " ", text).strip().lower()


@lru_cache(maxsize=None)
def parse_match_rule(match_rule: str) -> MatchFlags:
    strip_commas = False
    forbid_comma_strip = False
    phone_digits_only = False

    for raw_clause in (match_rule or "").split(";"):
        clause = _canon(raw_clause)
        if clause in _NOOP_CLAUSES:
            continue
        if clause == "do not comma-strip":
            forbid_comma_strip = True
            continue
        if clause == "phone alt digits-only":
            phone_digits_only = True
            continue
        if clause.startswith("strip "):
            for raw_item in clause[len("strip "):].split(","):
                item = raw_item.strip()
                if item not in _STRIP_ITEMS:
                    raise MatchRuleError(
                        f'unknown strip item "{item}" in match_rule "{match_rule}"'
                    )
                if _STRIP_ITEMS[item] == "strip_commas":
                    strip_commas = True
            continue
        raise MatchRuleError(f'unknown match_rule clause "{raw_clause.strip()}" in "{match_rule}"')

    if strip_commas and forbid_comma_strip:
        raise MatchRuleError(f'match_rule both strips and forbids stripping commas: "{match_rule}"')

    return MatchFlags(
        strip_commas=strip_commas,
        forbid_comma_strip=forbid_comma_strip,
        phone_digits_only=phone_digits_only,
    )


def _normalize(text: str, flags: MatchFlags) -> str:
    text = text.casefold()
    text = "".join(ch for ch in text if ch not in _CURRENCY)  # rule 2
    text = re.sub(r"\s+", " ", text).strip()  # rule 1
    if flags.strip_commas:
        # Rule 4 — only between digits, so sentence commas cannot create adjacencies.
        text = re.sub(r"(?<=\d),(?=\d)", "", text)
    return text


def _candidate_pattern(cand: str) -> str:
    pattern = re.escape(cand)

    if cand[0].isdigit():
        # Rule 3: no digit before, and no digit-then-separator before ("26." before "67").
        pattern = r"(?<!\d)(?<!\d[.,])" + pattern
    elif cand[0].isalnum():
        pattern = r"(?<![a-z0-9])" + pattern

    if re.fullmatch(r"\d+", cand):
        # Rule 4: an integer candidate's occurrence may carry a trailing ".00".
        pattern += r"(?:\.00)?(?!\d)(?![.,]\d)"
    elif cand[-1].isdigit():
        pattern += r"(?!\d)(?![.,]\d)"
    elif cand[-1].isalnum():
        pattern += r"(?![a-z0-9])"

    return pattern


def _candidate_matches(output_norm: str, output_raw: str, candidate: str, flags: MatchFlags) -> bool:
    cand = _normalize(candidate, flags)
    if not cand:
        return False
    if flags.phone_digits_only and re.fullmatch(r"\d{7,}", cand):
        # Phone-shaped candidate: match against the digit stream, "(503) 241-4704" and all.
        return cand in re.sub(r"\D", "", output_raw)
    return re.search(_candidate_pattern(cand), output_norm) is not None


def score_answer(output: str, answer_substring: str, match_rule: str = "") -> ScoreResult:
    """Score one agent output against one site's registered answer key."""
    flags = parse_match_rule(match_rule)
    candidates = [c.strip() for c in (answer_substring or "").split(" | ") if c.strip()]
    if not candidates:
        raise ValueError("answer_substring is empty — a row without an answer key cannot be scored")
    output_raw = output or ""
    output_norm = _normalize(output_raw, flags)
    for cand in candidates:
        if _candidate_matches(output_norm, output_raw, cand, flags):
            return ScoreResult(success=True, matched=cand)
    return ScoreResult(success=False, matched=None)
