"""
Lane 2 — Gemini browser-agent harness

Runs a fixed Gemini agent through a fixed task on each site in the cohort,
scores the output against the pre-registered answer_substring, and appends
one JSON run per trial to data/agent-runs-<batch>.jsonl.

This lane never talks to the database: the artifact is the record of the run, and
`npx tsx scripts/import-results.ts --batch <batch>` loads it into Supabase. An
interrupted run therefore loses nothing already measured.

Usage:
    # All cohort sites, 5 trials each
    python scripts/lane2-agent.py

    # Specific site IDs, N trials
    python scripts/lane2-agent.py --sites stripe vercel --trials 3

    # Label the batch (default: ACTIVE_BATCH env var, else "dev")
    python scripts/lane2-agent.py --batch v1

    # Decision-gate fallback: scripted nav + Gemini extraction only
    python scripts/lane2-agent.py --scripted-only --sites irs_gov

Requirements:
    pip install -r scripts/requirements.txt
    Set GEMINI_API_KEY in .env.local (or export it)
"""

import argparse
import asyncio
import base64
import json
import os
import re
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

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GEMINI_MODEL = "gemini-2.0-flash"      # fast, cheap, multimodal
MAX_STEPS = 15
TIMEOUT_SECONDS = 90
DEFAULT_TRIALS = 5

# Which dataset the rows written by this process belong to. Set once from argv in main(), so
# every _build_run call stamps the same batch and agent without threading them through.
BATCH_LABEL = os.environ.get("ACTIVE_BATCH", "dev")
AGENT_ID = GEMINI_MODEL

TASK_TEMPLATE = (
    "Find the page describing the primary product or service offered by this website, "
    "and extract one specific factual claim about it. "
    "{task_hint}"
)

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
                     current_url: str, title: str) -> dict:
    user_content = [
        f"TASK: {task}\n\nCurrent URL: {current_url}\nPage title: {title}\n\nPage text excerpt:\n{accessible_text[:2000]}",
        {"mime_type": "image/png", "data": screenshot_b64},
    ]
    try:
        response = get_model().generate_content(
            [SYSTEM_PROMPT, *user_content],
            generation_config={"temperature": 0, "max_output_tokens": 256},
        )
        text = response.text.strip()
        # Strip markdown code fences if Gemini wraps in them
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
        return json.loads(text)
    except Exception as e:
        print(f"      Gemini error: {e}")
        return {"action": "done", "answer": "", "reasoning": f"error: {e}"}

# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

async def run_agent_on_site(
    page: Page,
    site_id: str,
    url: str,
    task: str,
    answer_substring: str,
    trial_number: int,
) -> dict:
    start = time.time()
    transcript = []
    step_count = 0

    try:
        await page.goto(url, timeout=30_000, wait_until="domcontentloaded")
    except Exception as e:
        return _build_run(site_id, trial_number, False, 0,
                          time.time() - start, "error", [{"step": 0, "error": str(e)}])

    for step in range(MAX_STEPS):
        step_count = step + 1

        if time.time() - start > TIMEOUT_SECONDS:
            return _build_run(site_id, trial_number, False, step_count,
                              time.time() - start, "timeout", transcript)

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
            return _build_run(site_id, trial_number, False, step_count,
                              time.time() - start, "error", transcript)

        # Ask Gemini
        action = await ask_gemini(task, screenshot_b64, accessible_text, current_url, title)
        transcript.append({"step": step, "url": current_url, "action": action})
        print(f"      step {step_count}: {action.get('action')} — {action.get('reasoning', '')[:60]}")

        # Execute action
        if action.get("action") == "done":
            answer = action.get("answer", "")
            if answer == "BLOCKED":
                return _build_run(site_id, trial_number, False, step_count,
                                  time.time() - start, "blocked", transcript)
            success = answer_substring.lower() in answer.lower()
            mode = "success" if success else "wrong_extraction"
            return _build_run(site_id, trial_number, success, step_count,
                              time.time() - start, mode, transcript)

        elif action.get("action") == "click":
            selector = action.get("selector", "")
            try:
                # Try CSS selector first, then visible text
                try:
                    await page.click(selector, timeout=5_000)
                except Exception:
                    await page.click(f"text={selector}", timeout=5_000)
                await page.wait_for_load_state("domcontentloaded", timeout=10_000)
            except Exception as e:
                print(f"      click failed: {e}")

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
                      time.time() - start, "navigation_stuck", transcript)


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
# Scripted-navigation fallback (Saturday 6pm decision gate)
# ---------------------------------------------------------------------------

async def run_scripted_extraction(
    page: Page,
    site_id: str,
    url: str,
    task: str,
    answer_substring: str,
    trial_number: int,
) -> dict:
    """Navigate directly to the URL and use Gemini only for extraction."""
    start = time.time()
    try:
        await page.goto(url, timeout=30_000, wait_until="domcontentloaded")
        accessible_text = await page.evaluate(
            "() => document.body ? document.body.innerText : ''"
        )
        screenshot_bytes = await page.screenshot(type="png")
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
    except Exception as e:
        return _build_run(site_id, trial_number, False, 1,
                          time.time() - start, "error", [])

    # Single Gemini extraction call on the already-loaded page
    extraction_prompt = (
        f"You are looking at a web page. Extract the following information:\n{task}\n"
        f"Reply with ONLY the extracted answer as plain text (no JSON, no explanation)."
    )
    try:
        response = get_model().generate_content(
            [extraction_prompt, {"mime_type": "image/png", "data": screenshot_b64},
             accessible_text[:3000]],
            generation_config={"temperature": 0, "max_output_tokens": 128},
        )
        answer = response.text.strip()
    except Exception as e:
        answer = ""

    success = answer_substring.lower() in answer.lower()
    mode = "success" if success else "wrong_extraction"
    transcript = [{"step": 1, "url": page.url, "action": {"action": "done", "answer": answer}}]
    return _build_run(site_id, trial_number, success, 1,
                      time.time() - start, mode, transcript)

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
    parser.add_argument("--scripted-only", action="store_true",
                        help="Fallback path: scripted nav + Gemini extraction only")
    args = parser.parse_args()

    BATCH_LABEL = args.batch
    AGENT_ID = args.agent_id
    out_path = artifact_path(BATCH_LABEL)

    cohort_path = Path(__file__).parent / "cohort.json"
    cohort = json.loads(cohort_path.read_text())

    if args.sites:
        cohort = [s for s in cohort if s["site_id"] in args.sites]

    if not cohort:
        print("No matching sites.")
        sys.exit(1)

    run_fn_name = "scripted extraction" if args.scripted_only else "full agent"
    print(f"\nLane 2 — Gemini {run_fn_name}")
    print(f"Sites: {len(cohort)}  Trials: {args.trials}  Model: {GEMINI_MODEL}")
    print(f"Batch: {BATCH_LABEL}  Agent: {AGENT_ID}")
    print(f"Output: {out_path.relative_to(REPO_ROOT)}")
    print("-" * 60)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )

        for site in cohort:
            print(f"\n[{site['site_id']}] {site['name']}")
            # IMPORTANT: never inject the answer value (answer_substring / answer_note) into the
            # prompt — the model could then echo the answer without browsing, which would
            # invalidate success_rate and the headline correlation. Use the neutral task_hint,
            # which names WHAT to find, not its value.
            hint = (site.get("task_hint") or "").strip()
            task = TASK_TEMPLATE.format(task_hint=f"Specifically, find: {hint}." if hint else "")

            for trial in range(1, args.trials + 1):
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
                    run = await run_scripted_extraction(
                        page, site["site_id"], site["url"],
                        task, site["answer_substring"], trial,
                    )
                else:
                    run = await run_agent_on_site(
                        page, site["site_id"], site["url"],
                        task, site["answer_substring"], trial,
                    )

                await context.close()
                write_run(run, out_path)

        await browser.close()

    print(f"\n✓ Lane 2 complete. Runs → {out_path.relative_to(REPO_ROOT)}")
    print(f"  Load into Supabase: npx tsx scripts/import-results.ts --batch {BATCH_LABEL}")


if __name__ == "__main__":
    asyncio.run(main())
