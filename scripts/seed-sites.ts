/**
 * Seed the `sites` table from data/cohort.csv — the canonical 28-site cohort.
 *
 * `sites` is pre-registered config: it must exist before any lane runs, because the
 * leaderboard maps over it and both result tables reference it. Rows are upserted, so this
 * is safe to re-run after editing the CSV.
 *
 * Usage:
 *   npm run seed:sites
 *   npx tsx scripts/seed-sites.ts --dry-run     # print what would change, write nothing
 *   npx tsx scripts/seed-sites.ts --force       # allow answer-key edits on sites with runs
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (see scripts/supabase-admin.ts).
 */

import { readCohort } from "./cohort-csv";
import { getServiceClient } from "./supabase-admin";
import type { Site } from "../lib/types";

// Columns whose value is part of the pre-registration. Changing one of these after a site has
// runs invalidates those runs (docs/METHODOLOGY.md), so it takes --force.
const PREREGISTERED_COLUMNS = ["start_url", "question", "answer_substring", "match_rule"] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  const cohort = readCohort();
  console.log(`\nSeeding \`sites\` from data/cohort.csv — ${cohort.length} rows`);

  const tiers = new Map<string, number>();
  cohort.forEach((s) => tiers.set(s.tier, (tiers.get(s.tier) ?? 0) + 1));
  console.log(
    `  Tiers  : ${[...tiers].map(([t, n]) => `${t}=${n}`).join("  ")}`
  );

  const db = getServiceClient();

  const { data: existingRows, error: readError } = await db.from("sites").select("*");
  if (readError) throw new Error(`Could not read existing sites: ${readError.message}`);
  const existing = new Map((existingRows as Site[] ?? []).map((s) => [s.site_id, s]));

  const { data: runRows, error: runError } = await db.from("agent_runs").select("site_id");
  if (runError) throw new Error(`Could not read agent_runs: ${runError.message}`);
  const sitesWithRuns = new Set((runRows as { site_id: string }[] ?? []).map((r) => r.site_id));

  // Refuse to silently rewrite an answer key underneath existing runs.
  const violations: string[] = [];
  for (const site of cohort) {
    const before = existing.get(site.site_id);
    if (!before || !sitesWithRuns.has(site.site_id)) continue;
    for (const column of PREREGISTERED_COLUMNS) {
      if (before[column] !== site[column]) {
        violations.push(`  ${site.site_id}.${column}: "${before[column]}" -> "${site[column]}"`);
      }
    }
  }

  if (violations.length > 0 && !force) {
    console.error(
      `\n✗ Refusing to seed. These sites already have agent runs, and the CSV changes a ` +
        `pre-registered value:\n${violations.join("\n")}\n\n` +
        `Changing an answer key after runs exist invalidates those runs ` +
        `(docs/METHODOLOGY.md). Fork the dataset instead (new batch_label), or pass --force ` +
        `if you know the runs are being discarded.`
    );
    process.exit(1);
  }
  if (violations.length > 0) {
    console.warn(`\n⚠ --force: overwriting pre-registered values on sites with runs:\n${violations.join("\n")}`);
  }

  const added = cohort.filter((s) => !existing.has(s.site_id)).map((s) => s.site_id);
  console.log(`  New    : ${added.length ? added.join(", ") : "(none)"}`);
  console.log(`  Existing in DB but not in CSV: ${
    [...existing.keys()].filter((id) => !cohort.some((s) => s.site_id === id)).join(", ") || "(none)"
  }`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.\n");
    return;
  }

  const { error } = await db.from("sites").upsert(cohort, { onConflict: "site_id" });
  if (error) throw new Error(`Upsert failed: ${error.message}`);

  console.log(`\n✓ ${cohort.length} sites upserted.\n`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
