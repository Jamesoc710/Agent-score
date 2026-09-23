import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITION } from "./edition-data";
import { INSTRUMENT_SUMMARY_PATH, PENDING_RULE_D } from "./instrument";

// The pending list is the one typed site list on the published surface, and it is typed because
// it is a prediction (design S2-4 section 5). These tests keep it from outliving the control and
// from leaking into anything that is a measurement.

const ROOT = join(__dirname, "..");

describe("the rule-(d) prediction list", () => {
  it("empties once the control's summary is committed", () => {
    if (existsSync(join(ROOT, INSTRUMENT_SUMMARY_PATH))) {
      expect(
        PENDING_RULE_D,
        `${INSTRUMENT_SUMMARY_PATH} exists: replace the prediction with the control's dated result`
      ).toEqual([]);
    } else {
      expect(PENDING_RULE_D.length).toBeGreaterThan(0);
    }
  });

  it("is what the snapshot publishes as pending", () => {
    expect(EDITION.pending.map((p) => p.site_id)).toEqual(PENDING_RULE_D.map((p) => p.site_id).sort());
  });

  it("puts no pending site under the provenance mark or into the sensitivity", () => {
    for (const { site_id } of PENDING_RULE_D) {
      expect(EDITION.sites.find((s) => s.site_id === site_id)?.provenance ?? null).toBeNull();
      expect(EDITION.stats.sensitivity.excluded).not.toContain(site_id);
      expect(EDITION.exclusions.map((e) => e.site_id)).not.toContain(site_id);
    }
  });
});
