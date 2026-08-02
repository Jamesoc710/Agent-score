"""
Lane 2 — Gemini browser-agent harness

Runs a fixed Gemini agent through a fixed task on each site in the cohort,
scores the output against the pre-registered answer key via scripts/scoring.py
(the METHODOLOGY.md contract), and appends one JSON run per trial to
data/agent-runs-<batch>.jsonl.

This lane never talks to the database: the artifact is the record of the run, and
`npx tsx scripts/import-results.ts --batch <batch>` loads it into Supabase. An
interrupted run therefore loses nothing already measured.

Usage:
    # All cohort sites, 5 trials each
    python scripts/lane2-agent.py

    # Specific site IDs, N trials
    python scripts/lane2-agent.py --sites stripe voodoo --trials 3

    # Label the batch (default: ACTIVE_BATCH env var, else "dev")
    python scripts/lane2-agent.py --batch v1

    # Continue an interrupted batch: skips trials already in the artifact,
    # except failure_mode "error" rows (harness failures, not measurements)
    python scripts/lane2-agent.py --batch v1 --resume

    # Decision-gate fallback: scripted nav + Gemini extraction only
    python scripts/lane2-agent.py --scripted-only --sites irs

Requirements:
    pip install -r scripts/requirements.txt
    Set GEMINI_API_KEY in .env.local (or export it)
"""

import argparse
import asyncio
import base64
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Load .env.local if present (simple key=value parser, no library needed)
def load_env(path=".env.local"):
    if not Path(path).exists():
        return
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

load_env()

import google.generativeai as genai
from playwright.async_api import async_playwright, Page

from agent_task import build_task
from cohort_csv import read_cohort
from scoring import score_answer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GEMINI_MODEL = "gemini-2.0-flash"      # fast, cheap, multimodal
MAX_STEPS = 15
TIMEOUT_SECONDS = 90
DEFAULT_TRIALS = 5
GEMINI_ATTEMPTS = 3                    # transient-failure retries per model call
PAGE_TEXT_LIMIT = 8000                 # chars of page text shown to the model per step
CLICK_TIMEOUT_MS = 3_000               # per click attempt; several attempts may run

# Which dataset the rows written by this process belong to. Set once from argv in main(), so
# every _build_run call stamps the same batch and agent without threading them through.
BATCH_LABEL = os.environ.get("ACTIVE_BATCH", "dev")
AGENT_ID = GEMINI_MODEL

# ---------------------------------------------------------------------------
# Persistence — append-only local artifact, imported into Supabase separately
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent


def artifact_path(batch: str) -> Path:
    """data/agent-runs-<batch>.jsonl. Mirrors scripts/artifacts.ts — keep the two in sync."""
    return REPO_ROOT / "data" / f"agent-runs-{batch}.jsonl"


def write_run(run: dict, path: Path):
    """Append one trial. Flushed per trial so a crash costs at most the trial in flight."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(run) + "\n")
    print(f"    ✓ {run['site_id']} t{run['trial_number']}  "
          f"success={run['success']}  steps={run['step_count']}  → {path.name}")


def completed_trials(path: Path) -> set:
    """(site_id, trial_number) pairs already recorded for this batch+agent, minus "error"
    rows: those are harness failures, and --resume exists precisely to redo them. The
    importer's upsert key means a redone trial overwrites the error row."""
    done = set()
    if not path.exists():
        return done
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        run = json.loads(line)
        if (run.get("batch_label") == BATCH_LABEL and run.get("agent_id") == AGENT_ID
                and run.get("failure_mode") != "error"):
            done.add((run["site_id"], run["trial_number"]))
    return done

# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

_model = None


def get_model():
    """Lazily configure Gemini so --help doesn't crash at import when GEMINI_API_KEY is
    unset; fail with a clear message only when a model is actually needed."""
    global _model
    if _model is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise SystemExit(
                "GEMINI_API_KEY is not set. Add it to .env.local or export it before running Lane 2."
            )
        genai.configure(api_key=api_key)
        _model = genai.GenerativeModel(GEMINI_MODEL)
    return _model


class GeminiError(Exception):
    """Model call failed after all retries — a harness failure, never the site's."""


async def gemini_with_retry(parts, generation_config, parse):
    """Call Gemini with retry + exponential backoff on any failure (transport, rate
    limit, unparseable response). Returns (parsed_result, wasted_seconds), where
    wasted_seconds is time spent on failed attempts and backoff sleeps — callers
    subtract it from the trial clock so an API blip cannot turn into a "timeout"
    verdict against the site. Raises GeminiError when every attempt fails."""
    wasted = 0.0
    last_error = None
    for attempt in range(GEMINI_ATTEMPTS):
        if attempt:
            delay = 2 ** attempt + random.uniform(0, 1)
            await asyncio.sleep(delay)
            wasted += delay
        attempt_start = time.time()
        try:
            response = get_model().generate_content(parts, generation_config=generation_config)
            return parse(response.text), wasted
        except Exception as e:
            wasted += time.time() - attempt_start
            last_error = e
            print(f"      Gemini attempt {attempt + 1}/{GEMINI_ATTEMPTS} failed: {e}")
    raise GeminiError(f"Gemini call failed after {GEMINI_ATTEMPTS} attempts: {last_error}")


SYSTEM_PROMPT = """You are an agent browsing a website to complete a task.
You will be given a screenshot of the current page, the page URL, title, and a text excerpt.

Decide the SINGLE BEST next action. Reply with ONLY valid JSON — no markdown, no extra text.

Available actions:
  {"action": "click",    "selector": "<CSS selector or visible text>", "reasoning": "..."}
  {"action": "type",     "selector": "<CSS selector>", "text": "<text to type>", "reasoning": "..."}
  {"action": "scroll",   "direction": "down", "reasoning": "..."}
  {"action": "navigate", "url": "<full URL>", "reasoning": "..."}
  {"action": "done",     "answer": "<your extracted answer>", "reasoning": "..."}

Rules:
- Use "done" as soon as you have found the specific factual answer requested.
- If you are blocked (login wall, CAPTCHA, anti-bot) use "done" with answer="BLOCKED".
- If you cannot find the answer after many steps, use "done" with whatever you found.
- Prefer clicking visible links/buttons over typing in search boxes.
- Keep "selector" short and likely to be unique on the page.
"""


async def ask_gemini(task: str, screenshot_b64: str, accessible_text: str,
                     current_url: str, title: str):
    """One agent step. Returns (action_dict, wasted_seconds); raises GeminiError."""
    user_content = [
        f"TASK: {task}\n\nCurrent URL: {current_url}\nPage title: {title}\n\n"
        f"Page text excerpt:\n{accessible_text[:PAGE_TEXT_LIMIT]}",
        {"mime_type": "image/png", "data": screenshot_b64},
    ]
    return await gemini_with_retry(
        [SYSTEM_PROMPT, *user_content],
        {
            "temperature": 0,
            "max_output_tokens": 512,
            "response_mime_type": "application/json",
        },
        json.loads,
    )

# ---------------------------------------------------------------------------
# Browser helpers
# ---------------------------------------------------------------------------


def _active_page(page: Page) -> Page:
    """The newest open page in the context. If the agent's click opened a tab (or closed
    one), the trial follows the newest page rather than going blind."""
    pages = [p for p in page.context.pages if not p.is_closed()]
    return pages[-1] if pages else page


async def try_click(page: Page, selector: str) -> bool:
    """Attempt a click as CSS selector then visible text, in the main frame then child
    frames (consent banners often live in iframes), scrolling into view first."""
    if not selector:
        return False
    frames = [page.main_frame] + [f for f in page.frames if f is not page.main_frame][:5]
    for frame in frames:
        for locator in (frame.locator(selector).first,
                        frame.get_by_text(selector, exact=False).first):
            try:
                await locator.scroll_into_view_if_needed(timeout=CLICK_TIMEOUT_MS)
                await locator.click(timeout=CLICK_TIMEOUT_MS)
                return True
            except Exception:
                continue
    return False

# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


async def run_agent_on_site(page: Page, site: dict, task: str, trial_number: int) -> dict:
    site_id = site["site_id"]
    start = time.time()
    wasted = 0.0   # failed Gemini attempts + backoff; excluded from the trial clock
    transcript = []
    step_count = 0

    def elapsed():
        return time.time() - start - wasted

    try:
        await page.goto(site["start_url"], timeout=30_000, wait_until="domcontentloaded")
    except Exception as e:
        return _build_run(site_id, trial_number, False, 0,
                          elapsed(), "error", [{"step": 0, "error": str(e)}])

    for step in range(MAX_STEPS):
        step_count = step + 1

        if elapsed() > TIMEOUT_SECONDS:
            return _build_run(site_id, trial_number, False, step_count,
                              elapsed(), "timeout", transcript)

        # Follow tab changes the previous action caused (popup, target=_blank, closed tab)
        current = _active_page(page)
        if current is not page:
            page = current
            transcript.append({"step": step, "note": "followed newly opened tab", "url": page.url})
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=5_000)
            except Exception:
                pass

        # Capture state
        try:
            screenshot_bytes = await page.screenshot(type="png")
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
            current_url = page.url
            title = await page.title()
            accessible_text = await page.evaluate(
                "() => document.body ? document.body.innerText : ''"
            )
        except Exception as e:
            transcript.append({"step": step, "error": f"state capture failed: {e}"})
            return _build_run(site_id, trial_number, False, step_count,
                              elapsed(), "error", transcript)

        # Ask Gemini. A model failure after retries is recorded as failure_mode "error" —
        # never as the site's failure (wrong_extraction), which would corrupt the y-axis.
        try:
            action, wasted_here = await ask_gemini(
                task, screenshot_b64, accessible_text, current_url, title)
            wasted += wasted_here
        except GeminiError as e:
            transcript.append({"step": step, "url": current_url, "error": str(e)})
            return _build_run(site_id, trial_number, False, step_count,
                              elapsed(), "error", transcript)

        transcript.append({"step": step, "url": current_url, "action": action})
        print(f"      step {step_count}: {action.get('action')} — {action.get('reasoning', '')[:60]}")

        # Execute action
        if action.get("action") == "done":
            answer = action.get("answer", "") or ""
            if answer == "BLOCKED":
                return _build_run(site_id, trial_number, False, step_count,
                                  elapsed(), "blocked", transcript)
            result = score_answer(answer, site["answer_substring"], site["match_rule"])
            transcript[-1]["matched"] = result.matched
            mode = "success" if result.success else "wrong_extraction"
            return _build_run(site_id, trial_number, result.success, step_count,
                              elapsed(), mode, transcript)

        elif action.get("action") == "click":
            clicked = await try_click(page, action.get("selector", ""))
            if not clicked:
                print(f"      click failed: no clickable match for {action.get('selector', '')!r}")
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10_000)
            except Exception:
                pass

        elif action.get("action") == "type":
            try:
                await page.fill(action.get("selector", "input"), action.get("text", ""))
                await page.keyboard.press("Enter")
                await page.wait_for_load_state("domcontentloaded", timeout=10_000)
            except Exception as e:
                print(f"      type failed: {e}")

        elif action.get("action") == "scroll":
            await page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
            await asyncio.sleep(0.5)

        elif action.get("action") == "navigate":
            nav_url = action.get("url", "")
            try:
                await page.goto(nav_url, timeout=20_000, wait_until="domcontentloaded")
            except Exception as e:
                print(f"      navigate failed: {e}")

    # Exhausted the step budget without the agent ever calling "done": it couldn't find
    # the path. That's navigation_stuck, NOT timeout (which is reserved for the wall-clock
    # limit above) — keeping them distinct so the failure-mode breakdown is meaningful.
    return _build_run(site_id, trial_number, False, step_count,
                      elapsed(), "navigation_stuck", transcript)


def _build_run(site_id, trial_number, success, step_count, elapsed, failure_mode, transcript):
    """One agent_runs row. transcript stays a list — the column is jsonb, not text."""
    return {
        "site_id": site_id,
        "agent_id": AGENT_ID,
        "batch_label": BATCH_LABEL,
        "trial_number": trial_number,
        "success": success,
        "step_count": step_count,
        "duration_seconds": int(elapsed),
        "failure_mode": failure_mode,
        "transcript": transcript,
        "run_at": datetime.now(timezone.utc).isoformat(),
    }

# ---------------------------------------------------------------------------
# Scripted-navigation fallback (extraction-only baseline)
# ---------------------------------------------------------------------------


async def run_scripted_extraction(page: Page, site: dict, task: str, trial_number: int) -> dict:
    """Navigate directly to the URL and use Gemini only for extraction."""
    site_id = site["site_id"]
    start = time.time()
    try:
        await page.goto(site["start_url"], timeout=30_000, wait_until="domcontentloaded")
        accessible_text = await page.evaluate(
            "() => document.body ? document.body.innerText : ''"
        )
        screenshot_bytes = await page.screenshot(type="png")
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
    except Exception as e:
        return _build_run(site_id, trial_number, False, 1,
                          time.time() - start, "error", [{"step": 0, "error": str(e)}])

    # Single Gemini extraction call on the already-loaded page
    extraction_prompt = (
        f"You are looking at a web page. Extract the following information:\n{task}\n"
        f"Reply with ONLY the extracted answer as plain text (no JSON, no explanation)."
    )
    try:
        answer, wasted = await gemini_with_retry(
            [extraction_prompt, {"mime_type": "image/png", "data": screenshot_b64},
             accessible_text[:PAGE_TEXT_LIMIT]],
            {"temperature": 0, "max_output_tokens": 128},
            lambda text: text.strip(),
        )
    except GeminiError as e:
        return _build_run(site_id, trial_number, False, 1,
                          time.time() - start, "error",
                          [{"step": 1, "url": page.url, "error": str(e)}])

    result = score_answer(answer, site["answer_substring"], site["match_rule"])
    mode = "success" if result.success else "wrong_extraction"
    transcript = [{"step": 1, "url": page.url,
                   "action": {"action": "done", "answer": answer}, "matched": result.matched}]
    return _build_run(site_id, trial_number, result.success, 1,
                      time.time() - start - wasted, mode, transcript)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main():
    global BATCH_LABEL, AGENT_ID

    parser = argparse.ArgumentParser()
    parser.add_argument("--sites", nargs="*", help="Site IDs to run (default: all)")
    parser.add_argument("--trials", type=int, default=DEFAULT_TRIALS)
    parser.add_argument("--batch", default=BATCH_LABEL,
                        help="Dataset label written on every row (default: $ACTIVE_BATCH or 'dev')")
    parser.add_argument("--agent-id", default=AGENT_ID,
                        help="Identifies this agent loop in agent_runs (default: the Gemini model)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip trials already in this batch's artifact (error rows are re-run)")
    parser.add_argument("--scripted-only", action="store_true",
                        help="Fallback path: scripted nav + Gemini extraction only")
    args = parser.parse_args()

    BATCH_LABEL = args.batch
    AGENT_ID = args.agent_id
    out_path = artifact_path(BATCH_LABEL)

    cohort = read_cohort()

    if args.sites:
        cohort = [s for s in cohort if s["site_id"] in args.sites]

    if not cohort:
        print("No matching sites.")
        sys.exit(1)

    done = completed_trials(out_path) if args.resume else set()

    run_fn_name = "scripted extraction" if args.scripted_only else "full agent"
    print(f"\nLane 2 — Gemini {run_fn_name}")
    print(f"Sites: {len(cohort)}  Trials: {args.trials}  Model: {GEMINI_MODEL}")
    print(f"Batch: {BATCH_LABEL}  Agent: {AGENT_ID}")
    if done:
        print(f"Resume: {len(done)} recorded trial(s) will be skipped")
    print(f"Output: {out_path.relative_to(REPO_ROOT)}")
    print("-" * 60)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )

        for site in cohort:
            print(f"\n[{site['site_id']}] {site['name']}")
            # IMPORTANT: the prompt is built ONLY from the per-site question
            # (agent_task.py). Never let answer_substring or answer_note anywhere near
            # it — the leakage test in scripts/tests/ enforces this for every row.
            task = build_task(site)

            for trial in range(1, args.trials + 1):
                if (site["site_id"], trial) in done:
                    print(f"  Trial {trial}/{args.trials} — already recorded, skipping")
                    continue
                print(f"  Trial {trial}/{args.trials}")
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/124.0.0.0 Safari/537.36"
                    ),
                )
                page = await context.new_page()

                if args.scripted_only:
                    run = await run_scripted_extraction(page, site, task, trial)
                else:
                    run = await run_agent_on_site(page, site, task, trial)

                await context.close()
                write_run(run, out_path)

        await browser.close()

    print(f"\n✓ Lane 2 complete. Runs → {out_path.relative_to(REPO_ROOT)}")
    print(f"  Load into Supabase: npx tsx scripts/import-results.ts --batch {BATCH_LABEL}")


if __name__ == "__main__":
    asyncio.run(main())
