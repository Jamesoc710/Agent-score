/**
 * Load a batch's local lane artifacts into Supabase.
 *
 * The lanes never talk to the database; they write local artifacts and this script imports
 * them. One writer, one credential, and a batch can be re-imported at any time.
 *
 *   data/lighthouse-<batch>.json   { site_id: LighthouseResult }   (Lane 1)
 *   data/agent-runs-<batch>.jsonl  one Run per line                 (Lane 2)
 *
 * Usage:
 *   npm run import                              # batch from ACTIVE_BATCH, default "dev"
 *   npx tsx scripts/import-results.ts --batch v1
 *   npx tsx scripts/import-results.ts --batch v1 --dry-run
 *   npx tsx scripts/import-results.ts --runs-only | --lighthouse-only
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. `sites` must be seeded first (npm run seed:sites) —
 * both result tables have a foreign key to it.
 *
 * Note: data/lighthouse-results.json is a pre-migration artifact from the retired draft
 * cohort. It is not imported; Lane 1 is re-run against the canonical cohort in Phase 3.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { getServiceClient } from "./supabase-admin";
import { agentRunsArtifactPath, lighthouseArtifactPath } from "./artifacts";
import { flagValue, hasFlag } from "./args";
import { ACTIVE_BATCH } from "../lib/dataset";
import type { LighthouseResult, Run } from "../lib/types";

const CHUNK = 200;

async function main() {
  const batch = flagValue("--batch", ACTIVE_BATCH);
  const dryRun = hasFlag("--dry-run");
  const runsOnly = hasFlag("--runs-only");
  const lighthouseOnly = hasFlag("--lighthouse-only");

  console.log(`\nImporting batch "${batch}"${dryRun ? " (dry run)" : ""}`);

  const lighthouse = lighthouseOnly || !runsOnly ? loadLighthouse(batch) : [];
  const runs = runsOnly || !lighthouseOnly ? loadRuns(batch) : [];

  if (lighthouse.length === 0 && runs.length === 0) {
    console.log("  Nothing to import.\n");
    return;
  }

  const db = getServiceClient();

  const { data: siteRows, error: siteError } = await db.from("sites").select("site_id");
  if (siteError) throw new Error(`Could not read sites: ${siteError.message}`);
  const known = new Set((siteRows as { site_id: string }[] ?? []).map((s) => s.site_id));

  if (known.size === 0) {
    throw new Error("`sites` is empty. Run `npm run seed:sites` first — both result tables reference it.");
  }

  // Report unknown site_ids up front rather than letting Postgres reject the batch with a
  // foreign-key error — e.g. an artifact written before a site was added to (or renamed
  // in) data/cohort.csv and reseeded.
  const orphans = [
    ...new Set([...lighthouse, ...runs].map((r) => r.site_id).filter((id) => !known.has(id))),
  ];
  if (orphans.length > 0) {
    console.error(
      `\n✗ These site_ids are not in \`sites\`: ${orphans.join(", ")}\n` +
        `  They are missing from data/cohort.csv (or the artifact predates a rename). ` +
        `Run \`npm run seed:sites\` after cohort changes. Nothing was imported.`
    );
    process.exit(1);
  }

  console.log(`  Lighthouse rows : ${lighthouse.length}`);
  console.log(`  Agent run rows  : ${runs.length}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  if (lighthouse.length > 0) {
    await upsertAll(db, "lighthouse_results", lighthouse, "site_id,batch_label");
  }
  if (runs.length > 0) {
    await upsertAll(db, "agent_runs", runs, "site_id,agent_id,batch_label,trial_number");
  }

  console.log(`\n✓ Imported batch "${batch}".\n`);
}

function loadLighthouse(batch: string): LighthouseResult[] {
  const file = lighthouseArtifactPath(batch);
  if (!existsSync(file)) {
    console.log(`  (no ${path.basename(file)})`);
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, LighthouseResult>;
  return Object.entries(parsed).map(([site_id, row]) => ({
    ...row,
    site_id,
    batch_label: row.batch_label ?? batch,
  }));
}

function loadRuns(batch: string): Run[] {
  const file = agentRunsArtifactPath(batch);
  if (!existsSync(file)) {
    console.log(`  (no ${path.basename(file)})`);
    return [];
  }

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
        throw new Error(`${path.basename(file)} line ${i + 1} is not valid JSON: ${(err as Error).message}`);
      }
      // The artifact is an append log, so a re-run of the same trial appears twice. Last
      // write wins, matching what the upsert would do anyway.
      runs.set(`${run.site_id}|${run.agent_id}|${run.batch_label}|${run.trial_number}`, run);
    });

  return [...runs.values()];
}

async function upsertAll(
  db: ReturnType<typeof getServiceClient>,
  table: string,
  rows: object[],
  onConflict: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await db.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`${table} upsert failed at row ${i}: ${error.message}`);
    console.log(`  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
