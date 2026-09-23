/**
 * Reconstruct v1's Lane 1 from a dated 13.3.0 batch (design S2-7 §5).
 *
 *   npx tsx scripts/lane1-reconstruct.ts --batch lh-v2-<yyyymmdd>
 *
 * Reads data/lighthouse-v1.json (never writes it), the batch's panel (for each site's median
 * repeat), that repeat's retained LHR and the llms.txt sidecar. Writes
 * data/lhr/<batch>/reconstruction.json: per site the v1 values, the lh-v2 values under v1's
 * rule, match or differ, the reasons, the observed denominator and the v1-consistent set.
 * The reconstruction only means something on the scorer that produced v1, so it refuses a
 * batch whose reports are not Lighthouse 13.3.0.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  DATA_DIR,
  lhrPath,
  lighthousePanelPath,
  llmsTxtSidecarPath,
  reconstructionPath,
} from "./artifacts";
import { flagValue } from "./args";
import { readCohort } from "./cohort-csv";
import { repoRelative, sha256File } from "./lane1-env";
import type { LighthousePanelRow, Lhr } from "./lane1-extract";
import type { LlmsTxtProbe } from "./lane1-lighthouse";
import { reconstructSite, summarize } from "./reconstruction";
import type { LighthouseResult } from "../lib/types";

const V1_ARTIFACT = path.join(DATA_DIR, "lighthouse-v1.json");
const V1_LIGHTHOUSE = "13.3.0";

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function main() {
  const batch = flagValue("--batch", "");
  if (!batch) throw new Error("--batch <label> is required (the dated 13.3.0 batch).");

  const panelFile = lighthousePanelPath(batch);
  if (!existsSync(panelFile)) throw new Error(`No panel for "${batch}" at ${repoRelative(panelFile)}.`);
  const panel = readJson<Record<string, LighthousePanelRow>>(panelFile);
  const llms = existsSync(llmsTxtSidecarPath(batch))
    ? readJson<Record<string, LlmsTxtProbe>>(llmsTxtSidecarPath(batch))
    : {};
  const v1 = readJson<Record<string, LighthouseResult>>(V1_ARTIFACT);

  // Every cohort site v1 measured, in cohort order.
  const siteIds = readCohort().map((s) => s.site_id).filter((id) => id in v1);

  const sites = siteIds.map((siteId) => {
    const row = panel[siteId];
    const get = llms[siteId];
    const evidence = get
      ? { llms_get_status: get.status, llms_get_content_type: get.content_type, llms_get_bytes: get.bytes, llms_get_error: get.error }
      : {};
    if (!row) return reconstructSite(siteId, v1[siteId], null, evidence);
    const file = lhrPath(batch, siteId, row.lh_repeat);
    const lhr = readJson<Lhr>(file);
    if (lhr.lighthouseVersion !== V1_LIGHTHOUSE) {
      throw new Error(`${repoRelative(file)} is Lighthouse ${lhr.lighthouseVersion}; the reconstruction runs on ${V1_LIGHTHOUSE}, v1's scorer.`);
    }
    return reconstructSite(siteId, v1[siteId], { lhr, path: repoRelative(file) }, evidence);
  });

  const report = {
    batch_label: batch,
    v1_artifact: repoRelative(V1_ARTIFACT),
    v1_artifact_sha256: sha256File(V1_ARTIFACT),
    rule: "lh-v2 median repeat extracted in v1 mode: lh_total = round(category score * 100); a flag is 1 only on score === 1, null read as 0",
    reasons_enum: ["llms_status_changed", "cls_moved", "webmcp_applicability", "unexplained"],
    summary: summarize(sites),
    sites: Object.fromEntries(sites.map((s) => [s.site_id, s])),
  };

  const out = reconstructionPath(batch);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

  const s = report.summary;
  console.log(`\nReconstruction of v1 from ${batch}`);
  console.log(`  ${s.flags_reproduced} of ${s.flags_compared} flags reproduce; ${s.match} sites match, ${s.differ} differ`);
  for (const site of sites.filter((x) => x.status === "differ")) {
    const diffs = site.differences.map((d) => `${d.field} ${d.v1}→${d.v2}`).join(", ");
    console.log(`  ${site.site_id.padEnd(14)} ${diffs}  [${site.reasons.join(", ")}]`);
  }
  if (s.not_measured.length > 0) console.log(`  not measured: ${s.not_measured.join(", ")}`);
  if (s.unexplained.length > 0) console.log(`  UNEXPLAINED (name these or explain them): ${s.unexplained.join(", ")}`);
  console.log(`\n  → ${repoRelative(out)}\n`);
}

try {
  main();
} catch (err) {
  console.error(`\n✗ ${(err as Error).message}\n`);
  process.exit(1);
}
