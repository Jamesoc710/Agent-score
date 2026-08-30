/**
 * Derive data/exhibit-goodhart.json from the Goodhart exhibit's lane artifacts.
 *
 * The exhibit is never imported into Supabase (see lib/exhibit.ts for why), so the page reads
 * a committed derivation instead. JSONL and CSV are not importable modules and reading files
 * at request time is not reliable inside a serverless bundle, so the fold happens here, once,
 * and the result is committed.
 *
 * The output is checked, not trusted: lib/exhibit.test.ts re-derives it from the same three
 * artifacts and fails if the committed file has drifted.
 *
 * Usage:
 *   npx tsx scripts/build-exhibit-summary.ts
 *   npx tsx scripts/build-exhibit-summary.ts --batch goodhart --check
 *
 * --check writes nothing and exits non-zero if the committed file is stale.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { readCohort } from "./cohort-csv";
import { agentRunsArtifactPath, lighthouseArtifactPath } from "./artifacts";
import { flagValue, hasFlag } from "./args";
import { EXHIBIT_BATCH, deriveExhibit } from "../lib/exhibit";
import type { LighthouseResult, Run } from "../lib/types";

const REPO_ROOT = path.join(__dirname, "..");
const EXHIBIT_CSV = path.join(REPO_ROOT, "data", "exhibit-cohort.csv");
const OUTPUT = path.join(REPO_ROOT, "data", "exhibit-goodhart.json");

function main() {
  const batch = flagValue("--batch", EXHIBIT_BATCH);
  const check = hasFlag("--check");

  const sites = readCohort(EXHIBIT_CSV);
  const lighthouse = loadLighthouse(batch);
  const runs = loadRuns(batch);

  if (runs.length === 0) {
    console.error(`No trials in ${path.basename(agentRunsArtifactPath(batch))}. Nothing to derive.`);
    process.exit(1);
  }

  const dataset = deriveExhibit(sites, lighthouse, runs, batch);
  const serialized = JSON.stringify(dataset, null, 2) + "\n";

  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
    if (current !== serialized) {
      console.error(
        `${path.relative(REPO_ROOT, OUTPUT)} is stale. Re-run without --check to regenerate.`
      );
      process.exit(1);
    }
    console.log(`${path.relative(REPO_ROOT, OUTPUT)} is up to date.`);
    return;
  }

  writeFileSync(OUTPUT, serialized);
  console.log(
    `Wrote ${path.relative(REPO_ROOT, OUTPUT)}: ${dataset.pages.length} pages, ` +
      `${dataset.agent_ids.length} agents, ${runs.length} trials, batch "${batch}".`
  );
}

function loadLighthouse(batch: string): LighthouseResult[] {
  const file = lighthouseArtifactPath(batch);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, LighthouseResult>;
  return Object.entries(parsed).map(([site_id, row]) => ({
    ...row,
    site_id,
    batch_label: row.batch_label ?? batch,
  }));
}

function loadRuns(batch: string): Run[] {
  const file = agentRunsArtifactPath(batch);
  if (!existsSync(file)) return [];
  // Same last-write-wins dedupe scripts/import-results.ts applies: the artifact is an append
  // log, so a re-run of a trial appears twice and the later row is the one that counts.
  const runs = new Map<string, Run>();
  readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      let run: Run;
      try {
        run = JSON.parse(line) as Run;
      } catch (err) {
        throw new Error(
          `${path.basename(file)} line ${i + 1} is not valid JSON: ${(err as Error).message}`
        );
      }
      runs.set(`${run.site_id}|${run.agent_id}|${run.batch_label}|${run.trial_number}`, run);
    });
  return [...runs.values()];
}

main();
