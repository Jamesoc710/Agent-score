import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readCohort } from "../scripts/cohort-csv";
import { PUBLISHED_AGENTS } from "./dataset";
import type { ArtifactRecord, EditionInputs, PanelRow, RemeasurementBatchInput } from "./edition";
import { INSTRUMENT_SUMMARY_PATH, PENDING_RULE_D } from "./instrument";
import type { LighthouseResult, Run } from "./types";

// Reads the artifacts the edition snapshot folds, for scripts/build-edition-snapshot.ts and for
// lib/edition.test.ts, so the two cannot load them differently. Node only: it reads files and
// asks git, so nothing under app/ may import it (the pages read lib/edition-data.ts).

const ROOT = join(__dirname, "..");

export interface LoadedInputs {
  inputs: EditionInputs;
  /** False when git or its tags were unavailable, so the git-derived fields are null. */
  gitResolved: boolean;
}

export function loadEditionInputs(batch: string): LoadedInputs {
  const answerKeyTag = currentAnswerKeyTag();
  const lighthouseVersion = answerKeyTag ? lighthouseVersionAt(answerKeyTag) : null;
  const remeasurement = loadRemeasurement();

  return {
    gitResolved: answerKeyTag !== null && lighthouseVersion !== null,
    inputs: {
      batch_label: batch,
      cohort: readCohort(join(ROOT, "data", "cohort.csv")),
      runs: loadRuns(join(ROOT, "data", `agent-runs-${batch}.jsonl`)),
      lighthouse: loadLighthouse(join(ROOT, "data", `lighthouse-${batch}.json`), batch),
      vectors: readJson("scripts/tests/stats-vectors.json"),
      agents: PUBLISHED_AGENTS.map((a) => ({ id: a.id, label: a.label })),
      protocol: harnessProtocol(),
      answer_key_tag: answerKeyTag,
      lighthouse_version: lighthouseVersion,
      remeasurement,
      pending: PENDING_RULE_D,
      instrument_summary_exists: existsSync(join(ROOT, INSTRUMENT_SUMMARY_PATH)),
      methodology: readFileSync(join(ROOT, "docs", "METHODOLOGY.md"), "utf8"),
      artifacts: artifacts(batch, remeasurement),
    },
  };
}

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, relative), "utf8"));
}

/** The artifact is an append log: a re-run trial appears twice and the later row counts. */
function loadRuns(file: string): Run[] {
  const runs = new Map<string, Run>();
  readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const run = JSON.parse(line) as Run;
      runs.set(`${run.site_id}|${run.agent_id}|${run.batch_label}|${run.trial_number}`, run);
    });
  return [...runs.values()];
}

function loadLighthouse(file: string, batch: string): LighthouseResult[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, LighthouseResult>;
  return Object.entries(parsed).map(([site_id, row]) => ({
    ...row,
    site_id,
    batch_label: row.batch_label ?? batch,
  }));
}

/** The frozen loop's step cap and clock, read from the loop itself rather than restated. */
function harnessProtocol(): EditionInputs["protocol"] {
  const source = "scripts/lane2-agent.py";
  const text = readFileSync(join(ROOT, source), "utf8");
  const read = (name: string) => {
    const match = text.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m"));
    if (!match) throw new Error(`${source} no longer declares ${name}.`);
    return Number(match[1]);
  };
  return { max_steps: read("MAX_STEPS"), clock_seconds: read("TIMEOUT_SECONDS"), source };
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The newest answer-key tag whose data/cohort.csv is byte-identical to the working file. */
function currentAnswerKeyTag(): string | null {
  const tags = git(["tag", "--list", "answer-key-*", "--sort=-version:refname"]);
  const current = git(["hash-object", "data/cohort.csv"]);
  if (!tags || !current) return null;
  for (const tag of tags.split("\n").filter(Boolean)) {
    if (git(["rev-parse", `${tag}:data/cohort.csv`]) === current) return tag;
  }
  return null;
}

/** v1 kept no Lighthouse report, so its version is the one the lockfile pinned at the key tag. */
function lighthouseVersionAt(tag: string): { version: string; source: string } | null {
  const lock = git(["show", `${tag}:package-lock.json`]);
  if (!lock) return null;
  const version = (JSON.parse(lock) as { packages?: Record<string, { version?: string }> }).packages?.[
    "node_modules/lighthouse"
  ]?.version;
  return version ? { version, source: `package-lock.json at ${tag}; v1 retained no report` } : null;
}

/** The most recent day's dated Lane 1 batches, the pinned-version batch first. */
function loadRemeasurement(): RemeasurementBatchInput[] {
  const labels = readdirSync(join(ROOT, "data"))
    .map((f) => f.match(/^lighthouse-(lh-v2-(\d{8})(?:-[\w.]+)?)\.panel\.json$/))
    .filter((m): m is RegExpMatchArray => m !== null);
  if (labels.length === 0) return [];
  const latest = labels.map((m) => m[2]).sort().pop()!;
  return labels
    .filter((m) => m[2] === latest)
    .map((m) => m[1])
    .sort((a, b) => (a === `lh-v2-${latest}` ? -1 : b === `lh-v2-${latest}` ? 1 : a < b ? -1 : 1))
    .map((label) => {
      const panel = readJson(`data/lighthouse-${label}.panel.json`) as Record<string, PanelRow>;
      const audits = readJson(`data/lighthouse-${label}.audits.json`) as Record<
        string,
        { repeats?: { run?: { weights?: { id: string }[]; form_factor?: string } }[] }
      >;
      const ids = new Set<string>();
      const factors = new Set<string>();
      for (const site of Object.values(audits)) {
        for (const repeat of site.repeats ?? []) {
          repeat.run?.weights?.forEach((w) => ids.add(w.id));
          if (repeat.run?.form_factor) factors.add(repeat.run.form_factor);
        }
      }
      return {
        label,
        panel,
        audit_ids: [...ids],
        form_factor: factors.size === 1 ? [...factors][0] : null,
      };
    });
}

function artifacts(batch: string, remeasurement: RemeasurementBatchInput[]): ArtifactRecord[] {
  const out: ArtifactRecord[] = [];
  const file = (path: string, role: string) => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return;
    const bytes = readFileSync(full);
    out.push({ path, role, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  const dir = (path: string, role: string) => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return;
    const names = readdirSync(full).filter((n) => statSync(join(full, n)).isFile());
    out.push({
      path: `${path}/`,
      role,
      bytes: names.reduce((sum, n) => sum + statSync(join(full, n)).size, 0),
      sha256: null,
      files: names.length,
    });
  };

  file("data/cohort.csv", "the cohort and its registered answer keys");
  file(`data/agent-runs-${batch}.jsonl`, `every batch ${batch} trial, with its transcript`);
  file(`data/lighthouse-${batch}.json`, `the batch ${batch} Lane 1 rows: category mean and four flags`);
  file("scripts/tests/stats-vectors.json", "every published statistic, computed in Python and pinned");

  for (const { label } of remeasurement) {
    file(`data/lighthouse-${label}.json`, `Lane 1 rows, ${label}`);
    file(`data/lighthouse-${label}.panel.json`, `per-site panel: fraction, CLS score, llms.txt status, WebMCP; ${label}`);
    file(`data/lighthouse-${label}.audits.json`, `every audit of every repeat, ${label}`);
    file(`data/lighthouse-${label}.llms-txt.json`, `a plain GET of /llms.txt per site, ${label}`);
    file(`data/manifest-${label}.json`, `batch manifest: code, browser, vantage; ${label}`);
    file(`data/health-${label}.json`, `batch health card, ${label}`);
    dir(`data/lhr/${label}`, `raw Lighthouse reports, three repeats per site; ${label}`);
  }
  const day = remeasurement[0]?.label.match(/(\d{8})/)?.[1];
  if (day) file(`data/scanners-${day}.json`, "ora.ai and Cloudflare scans of the cohort, the same day");

  file("data/exhibit-cohort.csv", "the Goodhart exhibit's registered pair (not cohort data)");
  file("data/agent-runs-goodhart.jsonl", "every Goodhart exhibit trial, with its transcript");
  file("data/lighthouse-goodhart.json", "the Goodhart exhibit's Lane 1 rows");
  file("data/exhibit-goodhart.json", "the Goodhart exhibit's committed fold");
  return out;
}
