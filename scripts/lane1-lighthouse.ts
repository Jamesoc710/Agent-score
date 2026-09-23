/**
 * Lane 1: Lighthouse, the static x-axis (design S2-7 §2).
 *
 * Per site, per repeat (three by default, sequential, a fresh Chrome each run, 180 s timeout),
 * the v1 invocation with its report retained:
 *
 *   CHROME_PATH=<Playwright's Chromium> lighthouse "<start_url>" --output=json
 *     --output-path=data/lhr/<batch>/<site_id>.<r>.json --quiet
 *     --only-categories=agentic-browsing --chrome-flags='--headless --no-sandbox --disable-gpu'
 *
 * with `--preset=desktop` added for the desktop companion and nothing else. The row comes from
 * one repeat, the median by lh_total (ties to the earliest fetchTime); the spread sits beside
 * it. A repeat with a runtimeError is invalid; a site with fewer than two valid repeats is not
 * measured and is named in the failures sidecar. The run stops, with the offending report
 * kept, when a report's Lighthouse version or Chrome is not the one requested.
 *
 * Usage (scripts/run-batch.sh is the launch path for a published batch):
 *   npx tsx scripts/lane1-lighthouse.ts --batch <label> [--lighthouse-version 13.4.1]
 *       [--preset desktop] [--repeats 3] [--resume] [--dry-run] [site_id ...]
 *
 * Writes, and never touches the database:
 *   data/lighthouse-<batch>.json            { site_id: LighthouseResult }, importable as today
 *   data/lighthouse-<batch>.panel.json      the extended per-site row (median repeat, spread, panel)
 *   data/lighthouse-<batch>.audits.json     the per-run extract, every repeat
 *   data/lighthouse-<batch>.failures.json   sites not measured, with the error class per repeat
 *   data/lighthouse-<batch>.llms-txt.json   one plain GET /llms.txt per site
 *   data/lhr/<batch>/<site_id>.<r>.json     every raw report
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { readCohort } from "./cohort-csv";
import {
  lhrDir,
  lhrPath,
  lighthouseArtifactPath,
  lighthouseAuditsPath,
  lighthouseFailuresPath,
  lighthousePanelPath,
  llmsTxtSidecarPath,
} from "./artifacts";
import { flagValue, hasFlag, positionals } from "./args";
import {
  EXPECTED_CHROME_VERSION,
  assertLighthouseInstalled,
  chromeBinaryVersion,
  chromeMajor,
  lighthouseArgs,
  pinnedLighthouseVersion,
  repoRelative,
  resolveChromePath,
  type Lane1Preset,
} from "./lane1-env";
import {
  MIN_VALID_REPEATS,
  buildPanelRow,
  chromeVersionFromUserAgent,
  extractLighthouseRow,
  extractRunMeta,
  flatFields,
  invalidReason,
  selectMedianRepeat,
  toLighthouseResult,
  type AuditExtract,
  type LighthouseFlags,
  type LighthousePanelRow,
  type Lhr,
  type PanelFields,
  type RunMeta,
} from "./lane1-extract";
import { ACTIVE_BATCH } from "../lib/dataset";
import type { LighthouseResult, Site } from "../lib/types";

const RUN_TIMEOUT_MS = 180_000;
// SIGINT first so chrome-launcher's handler closes Chrome; SIGKILL if Lighthouse ignores it.
const KILL_GRACE_MS = 15_000;
const LLMS_TXT_TIMEOUT_MS = 20_000;
const DEFAULT_REPEATS = 3;

// Lighthouse runtimeError codes that mean the site refused or failed the load, as opposed to a
// Lighthouse or Chrome failure. v1 separated the first two.
const ACCESS_FAILURE_CODES = new Set([
  "NO_FCP",
  "FAILED_DOCUMENT_REQUEST",
  "ERRORED_DOCUMENT_REQUEST",
  "DNS_FAILURE",
  "INSECURE_DOCUMENT_REQUEST",
  "CHROME_INTERSTITIAL_ERROR",
  "NOT_HTML",
]);

export type RepeatErrorClass =
  | "access_failure"
  | "runtime_error"
  | "no_category_score"
  | "timeout"
  | "crash"
  | "unreadable_report";

export interface RepeatRecord {
  repeat: number;
  /** Repo-relative; null when Lighthouse wrote no report. */
  lhr_path: string | null;
  valid: boolean;
  invalid_reason: string | null;
  error_class: RepeatErrorClass | null;
  exit_code: number | null;
  wall_ms: number;
  run: RunMeta | null;
  extract: (LighthouseFlags & PanelFields) | null;
  audits: Record<string, AuditExtract> | null;
}

export interface SiteAudits {
  site_id: string;
  start_url: string;
  repeats: RepeatRecord[];
}

export interface SiteFailure {
  site_id: string;
  status: "not_measured";
  valid_repeats: number;
  attempted_repeats: number;
  repeats: { repeat: number; error_class: RepeatErrorClass | null; reason: string | null }[];
  recorded_at: string;
}

export interface LlmsTxtProbe {
  url: string;
  final_url: string | null;
  status: number | null;
  content_type: string | null;
  bytes: number | null;
  user_agent: string | null;
  fetched_at: string;
  error: string | null;
}

class InstrumentMismatch extends Error {}

interface RunContext {
  batch: string;
  version: string;
  preset: Lane1Preset;
  bin: string;
  chromePath: string;
}

// ---------------------------------------------------------------------------
// One repeat
// ---------------------------------------------------------------------------

async function runRepeat(site: Site, repeat: number, ctx: RunContext): Promise<RepeatRecord> {
  const out = lhrPath(ctx.batch, site.site_id, repeat);
  // A resumed site re-runs from repeat 1; never read a report left by the interrupted attempt.
  if (existsSync(out)) unlinkSync(out);

  const started = Date.now();
  const proc = await runProcess(
    ctx.bin,
    lighthouseArgs(site.start_url, out, ctx.preset),
    { ...process.env, CHROME_PATH: ctx.chromePath },
    RUN_TIMEOUT_MS
  );
  const wall_ms = Date.now() - started;

  const base = {
    repeat,
    exit_code: proc.code,
    wall_ms,
    run: null,
    extract: null,
    audits: null,
  };

  if (!existsSync(out)) {
    return {
      ...base,
      lhr_path: null,
      valid: false,
      error_class: proc.timedOut ? "timeout" : "crash",
      invalid_reason: proc.timedOut
        ? `no report within ${RUN_TIMEOUT_MS / 1000} s`
        : `exit ${proc.code ?? proc.signal}: ${lastLine(proc.stderr)}`,
    };
  }

  let lhr: Lhr;
  try {
    lhr = JSON.parse(readFileSync(out, "utf8")) as Lhr;
  } catch (err) {
    return {
      ...base,
      lhr_path: repoRelative(out),
      valid: false,
      error_class: "unreadable_report",
      invalid_reason: `report does not parse: ${(err as Error).message}`,
    };
  }

  checkInstrument(lhr, ctx, out);

  const invalid = invalidReason(lhr);
  if (invalid) {
    const code = lhr.runtimeError?.code ?? "";
    return {
      ...base,
      lhr_path: repoRelative(out),
      valid: false,
      error_class: lhr.runtimeError
        ? ACCESS_FAILURE_CODES.has(code) ? "access_failure" : "runtime_error"
        : "no_category_score",
      invalid_reason: invalid,
      run: extractRunMeta(lhr),
    };
  }

  const extracted = extractLighthouseRow(lhr, { clsRule: "v1" });
  return {
    ...base,
    lhr_path: repoRelative(out),
    valid: true,
    error_class: null,
    invalid_reason: null,
    run: extracted.run,
    extract: flatFields(extracted),
    audits: extracted.audits,
  };
}

/** Refuse, with the report kept, when a report is not from the requested instrument. */
function checkInstrument(lhr: Lhr, ctx: RunContext, file: string): void {
  const where = repoRelative(file);
  if (lhr.lighthouseVersion !== ctx.version) {
    throw new InstrumentMismatch(
      `${where}: lighthouseVersion is ${lhr.lighthouseVersion}, requested ${ctx.version}.`
    );
  }
  // Chrome reduces the user agent to <major>.0.0.0, so the LHR can confirm the major version
  // and the headless product; the full version is checked on the binary before the run.
  const ua = lhr.environment?.hostUserAgent ?? "";
  const uaVersion = chromeVersionFromUserAgent(ua);
  const major = chromeMajor(EXPECTED_CHROME_VERSION);
  const acceptable = [EXPECTED_CHROME_VERSION, `${major}.0.0.0`];
  if (!ua.includes("HeadlessChrome/") || !uaVersion || !acceptable.includes(uaVersion)) {
    throw new InstrumentMismatch(
      `${where}: environment.hostUserAgent is "${ua}", expected HeadlessChrome/${acceptable.join(" or ")}.`
    );
  }
}

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stderr: string;
}

function runProcess(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGINT");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: null, signal: null, timedOut, stderr: err.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, timedOut, stderr });
    });
  });
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return (lines[lines.length - 1] ?? "(no stderr)").slice(0, 300);
}

// ---------------------------------------------------------------------------
// The plain GET /llms.txt beside the audit
// ---------------------------------------------------------------------------

// The LHR does not carry the HTTP status of a 4xx (the audit is notApplicable with no
// displayValue), so one plain GET records it (S2-7 §2). It asks the same origin the audit asks
// (finalDisplayedUrl) with the user agent Lighthouse's own fetch presented.
export async function probeLlmsTxt(baseUrl: string, userAgent: string | null): Promise<LlmsTxtProbe> {
  const url = new URL("/llms.txt", baseUrl).href;
  const fetched_at = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLMS_TXT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "*/*" };
    if (userAgent) headers["User-Agent"] = userAgent;
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const body = await res.arrayBuffer();
    return {
      url,
      final_url: res.url || null,
      status: res.status,
      content_type: res.headers.get("content-type"),
      bytes: body.byteLength,
      user_agent: userAgent,
      fetched_at,
      error: null,
    };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const cause = e.cause ? ` (${e.cause.code ?? e.cause.message ?? "cause unknown"})` : "";
    return {
      url,
      final_url: null,
      status: null,
      content_type: null,
      bytes: null,
      user_agent: userAgent,
      fetched_at,
      error: `${e.name}: ${e.message}${cause}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Persistence: local artifacts only; scripts/import-results.ts loads the typed rows
// ---------------------------------------------------------------------------

function loadJson<T>(file: string): Record<string, T> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, T>;
}

function saveJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const batch = flagValue("--batch", ACTIVE_BATCH);
  const version = flagValue("--lighthouse-version", pinnedLighthouseVersion());
  const presetFlag = flagValue("--preset", "");
  if (presetFlag !== "" && presetFlag !== "desktop") {
    throw new Error(`--preset takes "desktop" only; got "${presetFlag}".`);
  }
  const preset: Lane1Preset = presetFlag === "desktop" ? "desktop" : null;
  const repeats = Number(flagValue("--repeats", String(DEFAULT_REPEATS)));
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`--repeats must be a positive integer.`);
  const minValid = Math.min(MIN_VALID_REPEATS, repeats);
  const resume = hasFlag("--resume");
  const dryRun = hasFlag("--dry-run");

  const cohort = readCohort();
  const requested = [
    ...positionals(),
    ...flagValue("--sites", "").split(",").map((s) => s.trim()).filter(Boolean),
  ];
  const unknown = requested.filter((id) => !cohort.some((s) => s.site_id === id));
  if (unknown.length > 0) throw new Error(`Not in the cohort: ${unknown.join(", ")}`);
  const sites = requested.length > 0 ? cohort.filter((s) => requested.includes(s.site_id)) : cohort;

  const install = assertLighthouseInstalled(version);
  const chromePath = resolveChromePath();
  const chromeVersion = chromeBinaryVersion(chromePath);
  if (chromeVersion !== EXPECTED_CHROME_VERSION) {
    throw new InstrumentMismatch(
      `CHROME_PATH is Chrome ${chromeVersion}; Lane 1 is pinned to ${EXPECTED_CHROME_VERSION} (${chromePath}).`
    );
  }

  const paths = {
    typed: lighthouseArtifactPath(batch),
    panel: lighthousePanelPath(batch),
    audits: lighthouseAuditsPath(batch),
    failures: lighthouseFailuresPath(batch),
    llms: llmsTxtSidecarPath(batch),
    lhr: lhrDir(batch),
  };
  const existing = Object.values(paths).filter((p) => existsSync(p));
  if (existing.length > 0 && !resume) {
    throw new Error(
      `Batch "${batch}" already has artifacts (${existing.map(repoRelative).join(", ")}). ` +
        `A Lane 1 label is never re-used; --resume finishes an interrupted batch.`
    );
  }

  const typed = loadJson<LighthouseResult>(paths.typed);
  const panel = loadJson<LighthousePanelRow>(paths.panel);
  const audits = loadJson<SiteAudits>(paths.audits);
  const failures = loadJson<SiteFailure>(paths.failures);
  const llms = loadJson<LlmsTxtProbe>(paths.llms);

  const todo = resume ? sites.filter((s) => !(s.site_id in typed)) : sites;

  console.log(`\nLane 1: Lighthouse ${version}${preset ? ` (--preset=${preset})` : ""}`);
  console.log(`  Batch   : ${batch}`);
  console.log(`  Sites   : ${todo.length}${resume ? ` to resume (${sites.length - todo.length} already measured)` : ""}`);
  console.log(`  Repeats : ${repeats} per site, sequential, ${RUN_TIMEOUT_MS / 1000} s timeout`);
  console.log(`  Binary  : ${repoRelative(install.bin)}`);
  console.log(`  Chrome  : ${chromeVersion} (${chromePath})`);
  console.log(`  Output  : ${repoRelative(paths.typed)} and ${repoRelative(paths.lhr)}/`);
  console.log(`${"─".repeat(60)}`);

  if (dryRun) {
    todo.forEach((s, i) => console.log(`  [${i + 1}/${todo.length}] ${s.site_id.padEnd(14)} ${s.start_url}`));
    console.log(`\n--dry-run: no Lighthouse run, nothing written.\n`);
    return;
  }

  mkdirSync(paths.lhr, { recursive: true });
  const ctx: RunContext = { batch, version, preset, bin: install.bin, chromePath };

  for (let i = 0; i < todo.length; i++) {
    const site = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${site.site_id.padEnd(14)} `);

    const records: RepeatRecord[] = [];
    for (let r = 1; r <= repeats; r++) {
      const record = await runRepeat(site, r, ctx);
      records.push(record);
      process.stdout.write(
        record.valid ? `r${r}=${record.extract!.lh_total} ` : `r${r}=${record.error_class} `
      );
    }

    const valid = records.filter((r) => r.valid);
    const selection = selectMedianRepeat(
      valid.map((r) => ({ repeat: r.repeat, lh_total: r.extract!.lh_total, fetch_time: r.run!.fetch_time })),
      minValid
    );

    audits[site.site_id] = { site_id: site.site_id, start_url: site.start_url, repeats: records };

    const probeFrom = records.find((r) => r.run)?.run ?? null;
    llms[site.site_id] = await probeLlmsTxt(
      probeFrom?.final_displayed_url ?? site.start_url,
      probeFrom?.network_user_agent ?? null
    );

    if (selection) {
      const median = records.find((r) => r.repeat === selection.lh_repeat)!;
      const extracted = { ...median.extract!, run: median.run!, audits: median.audits! };
      const row = buildPanelRow(site.site_id, batch, extracted, selection, {
        valid: valid.length,
        attempted: records.length,
      });
      panel[site.site_id] = row;
      typed[site.site_id] = toLighthouseResult(row);
      delete failures[site.site_id];
      console.log(
        `→ r${row.lh_repeat} lh_total=${row.lh_total} [${row.lh_total_min}-${row.lh_total_max}] ` +
          `fraction ${row.lh_passed}/${row.lh_passable} cls=${row.lh_cls_score} ` +
          `llms=${row.lh_llms_txt_status} webmcp=${row.lh_webmcp_applied ? `applied(${row.lh_webmcp_tool_count})` : "n/a"}` +
          (row.lh_ard_schema_status ? ` ard=${row.lh_ard_schema_status}` : "") +
          ` get=${llms[site.site_id].status ?? "error"}`
      );
    } else {
      failures[site.site_id] = {
        site_id: site.site_id,
        status: "not_measured",
        valid_repeats: valid.length,
        attempted_repeats: records.length,
        repeats: records.map((r) => ({ repeat: r.repeat, error_class: r.error_class, reason: r.invalid_reason })),
        recorded_at: new Date().toISOString(),
      };
      console.log(`→ NOT MEASURED (${valid.length} valid of ${records.length})`);
    }

    // Written after every site, so an interrupted batch keeps everything already measured.
    saveJson(paths.typed, typed);
    saveJson(paths.panel, panel);
    saveJson(paths.audits, audits);
    saveJson(paths.llms, llms);
    if (Object.keys(failures).length > 0) saveJson(paths.failures, failures);
    else if (existsSync(paths.failures)) unlinkSync(paths.failures);
  }

  const measured = Object.values(panel).sort((a, b) => a.lh_total - b.lh_total);
  const notMeasured = sites.filter((s) => !(s.site_id in typed)).map((s) => s.site_id);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Measured ${measured.length} of ${sites.length}.`);
  if (measured.length > 0) {
    console.log(`\n  mean  spread   fraction  site_id`);
    for (const r of measured) {
      console.log(
        `  ${String(r.lh_total).padStart(4)}  ${`${r.lh_total_min}-${r.lh_total_max}`.padEnd(8)} ` +
          `${`${r.lh_passed}/${r.lh_passable}`.padEnd(9)} ${r.site_id}`
      );
    }
  }
  if (notMeasured.length > 0) console.log(`\n  Not measured (${notMeasured.length}): ${notMeasured.join(", ")}`);
  console.log(`\n  Rows → ${repoRelative(paths.typed)}`);
}

main().catch((err) => {
  if (err instanceof InstrumentMismatch) {
    console.error(`\n✗ Instrument mismatch, batch stopped: ${err.message}\n`);
    process.exit(3);
  }
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
