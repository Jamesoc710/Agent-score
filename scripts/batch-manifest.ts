/**
 * The Lane 1 half of scripts/run-batch.sh that is easier in TypeScript: the label rule, the
 * environment record and the manifest (design S2-6 §2, §3 and §6; S2-7 §2).
 *
 *   check   resolve a label, refuse one that exists (S2-6 §2), print key=value lines
 *   start   write data/env-<batch>.txt and the manifest with finished_at null
 *   finish  merge the lane's results, the health card and the artifact digests into it
 *
 * Usage (run-batch.sh calls these; they are not a launch path of their own):
 *   npx tsx scripts/batch-manifest.ts check  --batch <label> --vantage <kind> --date <yyyymmdd> ...
 *   npx tsx scripts/batch-manifest.ts start  --batch <label> --vantage <kind> --date <yyyymmdd> ...
 *   npx tsx scripts/batch-manifest.ts finish --batch <label> --lane-exit <code>
 */

import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  envPath,
  healthPath,
  lhrDir,
  lighthouseArtifactPath,
  lighthouseAuditsPath,
  lighthouseFailuresPath,
  lighthousePanelPath,
  llmsTxtSidecarPath,
  manifestPath,
} from "./artifacts";
import { flagValue, hasFlag } from "./args";
import { defaultCsvPath, readCohort } from "./cohort-csv";
import {
  CHROME_FLAGS,
  CHROMIUM_BUILD,
  assertLighthouseInstalled,
  chromeBinaryVersion,
  lighthouseArgs,
  pinnedLighthouseVersion,
  repoRelative,
  resolveChromePath,
  sha256File,
  sha256Hex,
  type Lane1Preset,
} from "./lane1-env";
import { refuseExistingLabel, resolveLabel, type ResolvedLabel, type Vantage } from "./lane1-label";
import { manifestProblems, MANIFEST_SCHEMA_VERSION } from "./manifest";
import type { SiteAudits } from "./lane1-lighthouse";

const VENV_PYTHON = path.join(process.cwd(), ".venv", "bin", "python");
const THREE_REPEATS = 3;
const LANE1_NOT_APPLICABLE = "Lane 1 batch: no agent, harness or answer key is involved";

function die(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readOptions() {
  const batch = flagValue("--batch", "");
  if (!batch) die("--batch is required. There is no default batch for a launcher.");
  const vantage = flagValue("--vantage", "") as Vantage | "";
  if (vantage !== "residential" && vantage !== "datacenter") {
    die("--vantage residential|datacenter is required.");
  }
  const runDate = flagValue("--date", "");
  if (!/^\d{8}$/.test(runDate)) die("--date <yyyymmdd> (the run's UTC start date) is required.");
  const versionFlag = flagValue("--lighthouse-version", "");
  const presetFlag = flagValue("--preset", "");
  if (presetFlag !== "" && presetFlag !== "desktop") die(`--preset takes "desktop" only.`);
  const repeats = Number(flagValue("--repeats", String(THREE_REPEATS)));
  const sites = flagValue("--sites", "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    batch,
    vantage,
    runDate,
    versionFlag: versionFlag || undefined,
    presetFlag: presetFlag === "desktop" ? ("desktop" as Lane1Preset) : undefined,
    repeats,
    sites,
    resume: hasFlag("--resume"),
    dryRun: hasFlag("--dry-run"),
  };
}

type Options = ReturnType<typeof readOptions>;

function resolve(opts: Options): ResolvedLabel {
  const label = resolveLabel({
    batch: opts.batch,
    vantage: opts.vantage as Vantage,
    runDate: opts.runDate,
    pinnedVersion: pinnedLighthouseVersion(),
    lighthouseVersion: opts.versionFlag,
    preset: opts.presetFlag,
  });
  if (label.kind === "dated") {
    if (opts.repeats !== THREE_REPEATS) die(`"${opts.batch}": a dated batch runs ${THREE_REPEATS} repeats per site.`);
  } else if (!Number.isInteger(opts.repeats) || opts.repeats < 1) {
    die("--repeats must be a positive integer.");
  }
  return label;
}

function labelArtifacts(batch: string): string[] {
  return [
    lighthouseArtifactPath(batch),
    lighthouseFailuresPath(batch),
    lighthousePanelPath(batch),
    lighthouseAuditsPath(batch),
    llmsTxtSidecarPath(batch),
    lhrDir(batch),
    manifestPath(batch),
    envPath(batch),
    healthPath(batch),
  ];
}

function readJsonIfExists(file: string): Record<string, unknown> | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function check(opts: Options): void {
  let label: ResolvedLabel;
  try {
    label = resolve(opts);
  } catch (err) {
    die((err as Error).message);
  }
  const existing = labelArtifacts(opts.batch).filter((p) => existsSync(p)).map(repoRelative);
  const refusal = refuseExistingLabel(
    opts.batch,
    { existing, manifest: readJsonIfExists(manifestPath(opts.batch)) },
    { resume: opts.resume, runDate: opts.runDate }
  );
  if (refusal) die(refusal);

  const cohortIds = readCohort().map((s) => s.site_id);
  const unknown = opts.sites.filter((id) => !cohortIds.includes(id));
  if (unknown.length > 0) die(`Not in the cohort: ${unknown.join(", ")}`);
  // A dated batch is judged against the whole cohort (HC4), whatever --sites narrowed it to.
  const expected = label.kind === "dated" || opts.sites.length === 0 ? cohortIds.length : opts.sites.length;

  console.log(`lighthouse_version=${label.lighthouse_version}`);
  console.log(`preset=${label.preset ?? ""}`);
  console.log(`kind=${label.kind}`);
  console.log(`expected_sites=${expected}`);
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

async function lookupVantage(kind: Vantage) {
  const source = "ipinfo.io";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://ipinfo.io/json", { signal: controller.signal });
    clearTimeout(timer);
    const body = (await res.json()) as { ip?: string; org?: string; country?: string };
    const asn = body.org?.match(/^AS\d+/)?.[0] ?? null;
    return {
      kind,
      asn,
      ...(asn === null ? { asn_null_reason: `lookup returned no ASN (org "${body.org ?? ""}")` } : {}),
      as_org: body.org ?? null,
      ...(body.org ? {} : { as_org_null_reason: "lookup returned no org" }),
      country: body.country ?? null,
      ...(body.country ? {} : { country_null_reason: "lookup returned no country" }),
      source,
      public_ip_sha256: body.ip ? sha256Hex(body.ip) : null,
      ...(body.ip ? {} : { public_ip_sha256_null_reason: "lookup returned no ip" }),
    };
  } catch (err) {
    const reason = `lookup failed: ${(err as Error).message}`;
    return {
      kind,
      asn: null,
      asn_null_reason: reason,
      as_org: null,
      as_org_null_reason: reason,
      country: null,
      country_null_reason: reason,
      source,
      public_ip_sha256: null,
      public_ip_sha256_null_reason: reason,
    };
  }
}

function pythonEnvironment(): { version: string; freeze: string } | null {
  if (!existsSync(VENV_PYTHON)) return null;
  const version = execFileSync(VENV_PYTHON, ["--version"], { encoding: "utf8" }).trim();
  const freeze = execFileSync(VENV_PYTHON, ["-m", "pip", "freeze"], { encoding: "utf8" });
  return { version, freeze };
}

async function start(opts: Options): Promise<void> {
  let label: ResolvedLabel;
  try {
    label = resolve(opts);
  } catch (err) {
    die((err as Error).message);
  }
  const file = manifestPath(opts.batch);

  if (opts.resume) {
    const manifest = readJsonIfExists(file);
    if (!manifest) die(`--resume: no manifest for "${opts.batch}".`);
    const resumed = Array.isArray(manifest.resumed_at) ? manifest.resumed_at : [];
    manifest.resumed_at = [...resumed, new Date().toISOString()];
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  Manifest: resumed ${repoRelative(file)}`);
    return;
  }

  const install = assertLighthouseInstalled(label.lighthouse_version);
  const chromePath = resolveChromePath();
  const chromeVersion = chromeBinaryVersion(chromePath);
  const nodeVersion = process.version;
  const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
  const python = pythonEnvironment();
  const playwright = python?.freeze.match(/^playwright==(\S+)$/m)?.[1] ?? null;
  const lockfileSha = sha256File(install.lockfile);
  const cohortCsv = defaultCsvPath();
  const sitesRequested = opts.sites.length > 0 ? opts.sites : readCohort().map((s) => s.site_id);
  const dirtyPaths = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const startedAt = new Date().toISOString();

  const envLines = [
    `# AgentRank batch environment: ${opts.batch}`,
    `recorded_at: ${startedAt}`,
    `os: ${os.type()} ${os.release()} ${os.arch()}`,
    `node: ${nodeVersion}`,
    `npm: ${npmVersion}`,
    `lighthouse: ${install.installed_version} (${install.project_dir})`,
    `lighthouse_lockfile_sha256: ${lockfileSha}`,
    `chrome_path: ${chromePath}`,
    `chrome_version: ${chromeVersion}`,
    `python: ${python?.version ?? "not found (.venv/bin/python)"}`,
    `# pip freeze (.venv)`,
    (python?.freeze ?? "").trim(),
    "",
  ];
  const envText = envLines.join("\n");

  const vantage = await lookupVantage(opts.vantage as Vantage);

  const manifest: Record<string, unknown> = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    batch_label: opts.batch,
    label_kind: label.kind,
    line: "L3-lighthouse",
    lane: "lighthouse",
    repo_git_sha: git(["rev-parse", "HEAD"]),
    repo_dirty: dirtyPaths.length > 0,
    repo_dirty_paths: dirtyPaths,
    harness_id: null,
    harness_id_null_reason: LANE1_NOT_APPLICABLE,
    harness_git_sha: null,
    harness_git_sha_null_reason: LANE1_NOT_APPLICABLE,
    agent_ids: [],
    cohort_csv_path: repoRelative(cohortCsv),
    cohort_csv_sha256: sha256File(cohortCsv),
    cohort_csv_commit: git(["log", "-1", "--format=%H", "--", repoRelative(cohortCsv)]),
    answer_key_tag: null,
    answer_key_tag_null_reason: `${LANE1_NOT_APPLICABLE}; Lane 1 reads start_url only`,
    key_preflight: null,
    key_preflight_null_reason: "the answer-key preflight governs behavioral batches; not in P4's slice (S2-6 §13)",
    human_pass: null,
    human_pass_null_reason: "the human pass governs behavioral batches; not in P4's slice (S2-6 §13)",
    instrument_preflight: null,
    instrument_preflight_null_reason: "the instrument preflight governs Lane 2 harnesses; not in P4's slice (S2-6 §13)",
    registration_commit: null,
    registration_commit_null_reason: "no registration block governs a Lane 1 batch (S2-6 §3)",
    identity_probe_canary: null,
    identity_probe_canary_null_reason: "the canary runs on paid behavioral batch days only (D19)",
    health_card: null,
    health_card_null_reason: "written when the batch finishes",
    started_at: startedAt,
    resumed_at: [],
    finished_at: null,
    finished_at_null_reason: "batch in progress, or interrupted before it finished",
    wall_seconds: null,
    wall_seconds_null_reason: "written when the batch finishes",
    machine: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpu_model: os.cpus()[0]?.model ?? "unknown",
      logical_cpus: os.cpus().length,
      memory_bytes: os.totalmem(),
    },
    import_status: null,
    import_status_null_reason: "not imported; James imports with the printed command",
    artifacts: [],

    playwright_version: playwright,
    ...(playwright ? {} : { playwright_version_null_reason: "no playwright in .venv's pip freeze" }),
    chromium_version: chromeVersion,
    chromium_build: CHROMIUM_BUILD,
    node_version: nodeVersion,
    npm_version: npmVersion,
    lighthouse_version: install.installed_version,
    lighthouse_install: {
      project_dir: install.project_dir,
      lockfile: repoRelative(install.lockfile),
      lockfile_sha256: lockfileSha,
    },
    lighthouse_versions_reported: [],
    lighthouse_preset: label.preset,
    ...(label.preset === null
      ? { lighthouse_preset_null_reason: "no --preset: Lighthouse's default mobile emulation and simulated throttling, as v1 ran" }
      : {}),
    lighthouse_args: lighthouseArgs("<start_url>", "data/lhr/<batch>/<site_id>.<r>.json", label.preset),
    lighthouse_chrome_version: chromeVersion,
    lighthouse_chrome_path: chromePath,
    lighthouse_host_user_agents: [],
    python_version: python?.version ?? null,
    ...(python ? {} : { python_version_null_reason: "no .venv/bin/python" }),
    python_packages_sha256: python ? sha256Hex(python.freeze) : null,
    ...(python ? {} : { python_packages_sha256_null_reason: "no .venv/bin/python" }),
    env_file: { path: repoRelative(envPath(opts.batch)), sha256: sha256Hex(envText) },
    launch_args: CHROME_FLAGS,
    headless: true,
    viewport: null,
    viewport_null_reason: "set by Lighthouse's emulation; recorded per run as screen_emulation in the audits extract",
    user_agent_configured: null,
    user_agent_configured_null_reason: "Lighthouse's own emulatedUserAgent; recorded per run as network_user_agent",
    user_agent_sent: null,
    user_agent_sent_null_reason: "recorded per run in the audits extract, not per batch",
    sec_ch_ua_sent: null,
    sec_ch_ua_sent_null_reason: "Lane 1 does not capture request headers",
    navigator_webdriver: null,
    navigator_webdriver_null_reason: "Lane 1 does not probe the page's navigator",
    platform: null,
    platform_null_reason: "Lane 1 does not probe the page's navigator",
    identity_id: null,
    identity_id_null_reason: "Lane 1 declares no registered identity; it presents Lighthouse's defaults",
    vantage,
    concurrency: 1,
    model_config: {},
    trials_per_site: opts.repeats,
    sites_requested: sitesRequested,
    sites_completed: [],
    sites_not_measured: [],
  };

  const problems = manifestProblems(manifest, opts.batch);
  if (problems.length > 0) die(`manifest would be invalid: ${problems.join("; ")}`);

  if (opts.dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  writeFileSync(envPath(opts.batch), envText);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  Manifest: ${repoRelative(file)} (started ${startedAt})`);
  console.log(`  Env     : ${repoRelative(envPath(opts.batch))}`);
}

// ---------------------------------------------------------------------------
// finish
// ---------------------------------------------------------------------------

function batchArtifacts(batch: string): string[] {
  const files = [
    lighthouseArtifactPath(batch),
    lighthousePanelPath(batch),
    lighthouseAuditsPath(batch),
    lighthouseFailuresPath(batch),
    llmsTxtSidecarPath(batch),
    envPath(batch),
    healthPath(batch),
  ].filter((f) => existsSync(f));
  const dir = lhrDir(batch);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      // reconstruction.json is derived later by lane1-reconstruct.ts, not written by the lane.
      if (name.endsWith(".json") && name !== "reconstruction.json") files.push(path.join(dir, name));
    }
  }
  return files;
}

function finish(): void {
  const batch = flagValue("--batch", "");
  if (!batch) die("--batch is required.");
  const laneExit = Number(flagValue("--lane-exit", "NaN"));
  if (!Number.isInteger(laneExit)) die("--lane-exit <code> is required.");

  const file = manifestPath(batch);
  const manifest = readJsonIfExists(file);
  if (!manifest) die(`no manifest for "${batch}"; run start first.`);

  const audits = (readJsonIfExists(lighthouseAuditsPath(batch)) ?? {}) as Record<string, SiteAudits>;
  const typed = readJsonIfExists(lighthouseArtifactPath(batch)) ?? {};
  const runs = Object.values(audits).flatMap((s) => s.repeats).filter((r) => r.run);
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => typeof v === "string"))].sort();

  manifest.lighthouse_versions_reported = distinct(runs.map((r) => r.run!.lighthouse_version));
  manifest.lighthouse_host_user_agents = distinct(runs.map((r) => r.run!.host_user_agent));
  const requested = (manifest.sites_requested as string[]) ?? [];
  manifest.sites_completed = requested.filter((id) => id in typed);
  manifest.sites_not_measured = requested.filter((id) => !(id in typed));

  const health = readJsonIfExists(healthPath(batch));
  manifest.health_card = health;
  if (health) delete manifest.health_card_null_reason;
  else manifest.health_card_null_reason = "the health card did not run";

  const now = new Date();
  if (laneExit === 0) {
    manifest.finished_at = now.toISOString();
    delete manifest.finished_at_null_reason;
    manifest.wall_seconds = Math.round((now.getTime() - Date.parse(String(manifest.started_at))) / 1000);
    delete manifest.wall_seconds_null_reason;
  } else {
    manifest.finished_at = null;
    manifest.finished_at_null_reason = `the lane exited ${laneExit}; resume the same UTC day with --resume`;
    manifest.wall_seconds = null;
    manifest.wall_seconds_null_reason = "the batch did not finish";
  }
  manifest.lane_exit_code = laneExit;

  manifest.artifacts = batchArtifacts(batch).map((f) => ({ path: repoRelative(f), sha256: sha256File(f) }));

  const problems = manifestProblems(manifest, batch);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  if (problems.length > 0) die(`manifest written but invalid: ${problems.join("; ")}`);
  console.log(`  Manifest: ${repoRelative(file)} (${(manifest.artifacts as unknown[]).length} artifacts digested)`);
}

// ---------------------------------------------------------------------------

async function main() {
  const command = process.argv[2];
  if (command === "check") return check(readOptions());
  if (command === "start") return start(readOptions());
  if (command === "finish") return finish();
  die(`usage: batch-manifest.ts check|start|finish --batch <label> ...`);
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
