/**
 * Lane 1 — Lighthouse static scorer
 *
 * Lighthouse 13.3.0 — agentic-browsing category, verified 2026-05-30 against stripe.com.
 *
 * Verified audit IDs (confirmed from real LHR JSON):
 *   category  : "agentic-browsing"
 *   audits    : "agent-accessibility-tree", "cumulative-layout-shift",
 *               "llms-txt", "webmcp-registered-tools"
 *   lh_total  : Math.round(categories["agentic-browsing"].score * 100)
 *   sub-audits: 1 if score === 1 (strict pass), 0 otherwise — matches lib/types.ts
 *
 * Usage:
 *   npx tsx scripts/lane1-lighthouse.ts                       # all cohort sites
 *   npx tsx scripts/lane1-lighthouse.ts stripe vercel         # named site IDs only
 *   npx tsx scripts/lane1-lighthouse.ts --batch v1            # label the batch
 *
 * Output: data/lighthouse-<batch>.json only. This lane does not talk to the database —
 * load a batch with `npx tsx scripts/import-results.ts --batch <batch>`.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import path from "path";
import cohortRaw from "./cohort.json";
import { lighthouseArtifactPath } from "./artifacts";
import { flagValue, positionals } from "./args";
import { ACTIVE_BATCH } from "../lib/dataset";
import type { LighthouseResult } from "../lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CohortEntry {
  site_id: string;
  name: string;
  url: string;
  answer_substring: string;
  answer_note: string;
  expected_lh: string;
  category: string;
  manual_pass: string;
  task_hint?: string;
}

const cohort = cohortRaw as CohortEntry[];

// ---------------------------------------------------------------------------
// Lighthouse runner
// ---------------------------------------------------------------------------

async function runLighthouse(url: string): Promise<LighthouseResult | null> {
  const tmpFile = path.join(process.cwd(), `.lh-tmp-${process.pid}.json`);

  try {
    const cmd = [
      "npx lighthouse",
      `"${url}"`,
      "--output=json",
      `--output-path="${tmpFile}"`,
      "--quiet",
      "--only-categories=agentic-browsing",
      "--chrome-flags='--headless --no-sandbox --disable-gpu'",
    ].join(" ");

    execSync(cmd, { stdio: "pipe", timeout: 180_000 });

    const raw = JSON.parse(readFileSync(tmpFile, "utf-8"));

    // lh_total = the agentic-browsing category score. Never fabricate a substitute.
    const agenticCategory = raw.categories?.["agentic-browsing"];
    if (!agenticCategory || typeof agenticCategory.score !== "number") {
      const available = Object.keys(raw.categories ?? {}).join(", ") || "(none)";
      throw new Error(
        `No "agentic-browsing" category in Lighthouse output. ` +
        `Available: [${available}]. Confirm lighthouse >= 13.3 is installed.`
      );
    }
    const lh_total = Math.round(agenticCategory.score * 100);

    const audits = raw.audits ?? {};
    const auditPass = (id: string): number => {
      const audit = audits[id];
      if (!audit || audit.score === null) return 0;
      return audit.score === 1 ? 1 : 0;
    };

    // Log if an expected audit id is absent (catches future Lighthouse renames).
    const expectedIds = [
      "agent-accessibility-tree",
      "cumulative-layout-shift",
      "llms-txt",
      "webmcp-registered-tools",
    ];
    const absent = expectedIds.filter((id) => !(id in audits));
    if (absent.length) {
      console.warn(`  ⚠ Audit ids not found in LHR: ${absent.join(", ")}`);
    }

    return {
      site_id: "",     // filled in by caller
      batch_label: "", // filled in by caller
      lh_total,
      lh_accessibility_tree: auditPass("agent-accessibility-tree"),
      lh_layout_stability:   auditPass("cumulative-layout-shift"),
      lh_llms_txt:           auditPass("llms-txt"),
      lh_webmcp:             auditPass("webmcp-registered-tools"),
      run_at: new Date().toISOString(),
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Distinguish access failures from Lighthouse crashes so callers can label them correctly.
    if (msg.includes("NO_FCP") || msg.includes("FAILED_DOCUMENT_REQUEST")) {
      console.error(`  ✗ Access failure (site blocked Lighthouse): ${msg.slice(0, 120)}`);
    } else {
      console.error(`  ✗ Lighthouse error: ${msg.slice(0, 120)}`);
    }
    return null;
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Persistence — local artifact only; scripts/import-results.ts loads it into Supabase
// ---------------------------------------------------------------------------

function loadLocalResults(artifactPath: string): Record<string, LighthouseResult> {
  if (!existsSync(artifactPath)) return {};
  try {
    return JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch {
    return {};
  }
}

// Written after every site, so an interrupted batch keeps everything already measured.
function saveResult(
  artifactPath: string,
  result: LighthouseResult,
  local: Record<string, LighthouseResult>
): void {
  local[result.site_id] = result;
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify(local, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const batch = flagValue("--batch", ACTIVE_BATCH);
  const requested = positionals();
  const targetIds = requested.length > 0 ? new Set(requested) : null;
  const sites = targetIds
    ? cohort.filter((s) => targetIds.has(s.site_id))
    : cohort;

  if (sites.length === 0) {
    console.error("No matching sites found. Check site IDs.");
    process.exit(1);
  }

  const artifactPath = lighthouseArtifactPath(batch);

  console.log(`\nLane 1 — Lighthouse static scorer`);
  console.log(`  Sites  : ${sites.length}`);
  console.log(`  Batch  : ${batch}`);
  console.log(`  Output : ${path.relative(process.cwd(), artifactPath)}`);
  console.log(`${"─".repeat(52)}`);

  const local = loadLocalResults(artifactPath);
  const summary: { site_id: string; lh_total: number | null; status: string }[] = [];

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    process.stdout.write(`[${i + 1}/${sites.length}] ${site.site_id.padEnd(14)} ${site.url} … `);

    const lh = await runLighthouse(site.url);
    if (!lh) {
      summary.push({ site_id: site.site_id, lh_total: null, status: "FAILED" });
      console.log("FAILED");
      continue;
    }

    lh.site_id = site.site_id;
    lh.batch_label = batch;

    try {
      saveResult(artifactPath, lh, local);
      summary.push({ site_id: site.site_id, lh_total: lh.lh_total, status: "saved" });
      console.log(
        `lh_total=${String(lh.lh_total).padStart(3)}%  ` +
        `a11y=${lh.lh_accessibility_tree}  cls=${lh.lh_layout_stability}  llms=${lh.lh_llms_txt}  webmcp=${lh.lh_webmcp}`
      );
    } catch (err) {
      console.error(`  Write failed: ${(err as Error).message}`);
      summary.push({ site_id: site.site_id, lh_total: lh.lh_total, status: "WRITE_FAILED" });
    }
  }

  // X-axis spread check (the never-cut gate)
  const scored = summary.filter((r) => r.lh_total !== null).map((r) => r.lh_total as number).sort((a, b) => a - b);
  const failed = summary.filter((r) => r.lh_total === null);

  console.log(`\n${"─".repeat(52)}`);
  console.log(`X-AXIS SPREAD CHECK`);
  if (scored.length > 0) {
    const min = scored[0], max = scored[scored.length - 1];
    const mean = (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1);
    const spread = max - min;
    console.log(`  n=${scored.length}  min=${min}%  max=${max}%  mean=${mean}%  spread=${spread}pts`);
    if (spread < 30) {
      console.log(`  ⚠ BORING BLOB: spread only ${spread}pts. Swap in lower-scoring sites.`);
    } else {
      console.log(`  ✓ Spread OK (${spread}pts ≥ 30pt threshold).`);
    }
    // Sort and print the table
    const rows = summary
      .filter((r) => r.lh_total !== null)
      .sort((a, b) => (a.lh_total as number) - (b.lh_total as number));
    console.log(`\n  lh_total  site_id`);
    rows.forEach((r) => console.log(`  ${String(r.lh_total) + "%"}`.padEnd(10) + r.site_id));
  }
  if (failed.length) {
    console.log(`\n  Failed (${failed.length}): ${failed.map((r) => r.site_id).join(", ")}`);
  }
  console.log(`\n  Results → ${path.relative(process.cwd(), artifactPath)}`);
  console.log(`  Load into Supabase: npx tsx scripts/import-results.ts --batch ${batch}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
