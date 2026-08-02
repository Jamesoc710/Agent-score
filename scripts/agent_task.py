"""
The one task prompt Lane 2 gives the agent, kept in its own importable module so the
leakage test in scripts/tests/ can prove no registered answer ever appears in it.

METHODOLOGY.md, rule 7: the task shape is constant; only the per-site `question`
varies. NEVER format answer_substring, answer_note, or anything derived from them
into this template — the agent must earn the answer by browsing, and leakage
invalidates the run.
"""

from __future__ import annotations

from typing import Dict

TASK_TEMPLATE = (
    "You are browsing this website to answer one specific question.\n"
    "Question: {question}\n"
    'Navigate from the current page to find the answer, then use the "done" action '
    "to report the answer exactly as the page states it."
)


def build_task(site: Dict[str, str]) -> str:
    return TASK_TEMPLATE.format(question=site["question"])
