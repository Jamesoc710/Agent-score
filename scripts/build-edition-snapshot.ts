/**
 * Derive data/edition-<batch>.json, the edition snapshot, from the batch's committed artifacts.
 *
 * Every crawled or shared surface (the sitemap, the JSON-LD, the citation block, /data/v1.json,
 * the site-page caveat blocks, the /correlation sensitivity line) reads this file rather than the
 * database, so a paused database cannot take them down and a crawler never touches it. The fold
 * is lib/edition.ts#deriveEdition, with the same statistics functions the pages use, and the
 * result must agree with scripts/tests/stats-vectors.json at every cited path or nothing is
 * written.
 *
 * The output is checked, not trusted: lib/edition.test.ts re-derives it from the same artifacts
 * and fails if the committed file has drifted.
 *
 * Usage:
 *   npx tsx scripts/build-edition-snapshot.ts
 *   npx tsx scripts/build-edition-snapshot.ts --batch v1 --check
 *
 * --check writes nothing and exits non-zero if the committed file is stale.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { flagValue, hasFlag } from "./args";
import { checkAgainstVectors, deriveEdition } from "../lib/edition";
import { loadEditionInputs } from "../lib/edition-inputs";

const REPO_ROOT = path.join(__dirname, "..");

function main() {
  const batch = flagValue("--batch", "v1");
  const check = hasFlag("--check");
  const output = path.join(REPO_ROOT, "data", `edition-${batch}.json`);

  const { inputs, gitResolved } = loadEditionInputs(batch);
  if (!gitResolved) {
    console.error("git or its answer-key tags are unavailable; the answer-key tag and Lighthouse version cannot be read.");
    process.exit(1);
  }
  if (inputs.runs.length === 0) {
    console.error(`No trials in data/agent-runs-${batch}.jsonl. Nothing to derive.`);
    process.exit(1);
  }

  const snapshot = deriveEdition(inputs);
  const problems = checkAgainstVectors(snapshot, inputs.vectors);
  if (problems.length > 0) {
    console.error("The snapshot disagrees with scripts/tests/stats-vectors.json:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const serialized = JSON.stringify(snapshot, null, 2) + "\n";
  const relative = path.relative(REPO_ROOT, output);

  if (check) {
    const current = existsSync(output) ? readFileSync(output, "utf8") : "";
    if (current !== serialized) {
      console.error(`${relative} is stale. Re-run without --check to regenerate.`);
      process.exit(1);
    }
    console.log(`${relative} is up to date.`);
    return;
  }

  writeFileSync(output, serialized);
  const pending = snapshot.pending.map((p) => `${p.site_id} (registered ${p.registered_on ?? "not yet"})`);
  console.log(
    `Wrote ${relative}: ${snapshot.sites.length} sites, ${snapshot.agents.length} agents, ` +
      `rule (b) ${snapshot.stats.sensitivity.excluded.join(", ") || "none"}, ` +
      `rule (d) pending ${pending.join(", ") || "none"}.`
  );
}

main();
