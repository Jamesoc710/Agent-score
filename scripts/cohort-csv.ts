import { readFileSync } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import type { Site, SiteTier } from "../lib/types";

// Reader for data/cohort.csv, the canonical 28-site cohort. Validates on the way in so CSV
// drift surfaces here with a row number instead of as a Postgres CHECK violation.
//
// Used by the seed script and Lane 1. Lane 2 reads the same file through the Python
// mirror, scripts/cohort_csv.py — keep the two readers in sync.

const TIERS: readonly SiteTier[] = [
  "anchor",
  "middle",
  "government",
  "small_business",
  "off_diagonal",
  "blocker",
];

export const COHORT_CSV_PATH = path.join(process.cwd(), "data", "cohort.csv");

export function readCohort(csvPath: string = COHORT_CSV_PATH): Site[] {
  const records = parse(readFileSync(csvPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const file = path.basename(csvPath);
  const seen = new Set<string>();

  return records.map((row, i) => {
    const where = `${file} row ${i + 2}`; // +2: header plus 1-based rows

    const site_id = required(row, "site_id", where);
    if (seen.has(site_id)) throw new Error(`${where}: duplicate site_id "${site_id}"`);
    seen.add(site_id);

    const tier = required(row, "tier", where);
    if (!TIERS.includes(tier as SiteTier)) {
      throw new Error(`${where}: tier "${tier}" is not one of ${TIERS.join(", ")}`);
    }

    return {
      site_id,
      name: required(row, "name", where),
      tier: tier as SiteTier,
      start_url: required(row, "start_url", where),
      question: required(row, "question", where),
      answer_substring: required(row, "answer_substring", where),
      match_rule: row.match_rule ?? "",
      flag: row.flag ?? "",
      answer_note: row.answer_note ?? "",
    };
  });
}

function required(row: Record<string, string>, column: string, where: string): string {
  const value = (row[column] ?? "").trim();
  if (!value) throw new Error(`${where}: missing required column "${column}"`);
  return value;
}
