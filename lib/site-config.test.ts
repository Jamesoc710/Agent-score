import { describe, expect, it } from "vitest";
import { EDITION } from "./edition-data";
import { CONTACT_ADDRESS, RELEASE_TAG, SITE_URL, SUBMIT_SITE_URL, repoFileUrl } from "./site-config";

describe("site config", () => {
  it("points the submission control at the Issue Form, with no server-side write", () => {
    expect(SUBMIT_SITE_URL).toMatch(/\/issues\/new\?template=submit-site\.yml&title=/);
  });

  it("links artifacts at the release tag once it exists, else at main", () => {
    expect(repoFileUrl("data/cohort.csv")).toContain(`/blob/${RELEASE_TAG ?? "main"}/data/cohort.csv`);
  });

  it("uses the Vercel host, since no domain was bought (D5)", () => {
    expect(SITE_URL).toBe("https://agent-score-weld.vercel.app");
  });
});

// Opt-in: `PRE_MERGE=1 npm run test:unit`. Ordinary runs stay green while James has not yet
// chosen these; the corrections PR does not merge until this block passes.
describe.runIf(process.env.PRE_MERGE === "1")("pre-merge", () => {
  it("has a contact address", () => {
    expect(
      CONTACT_ADDRESS,
      "contact address unset: set CONTACT_ADDRESS in lib/site-config.ts (James's choice, S2-4 q7)"
    ).not.toBeNull();
  });

  it("dates the instrument control's registration on every pending note", () => {
    for (const p of EDITION.pending) {
      expect(p.registered_on, `${p.site_id}: no registration date found in docs/METHODOLOGY.md`).not.toBeNull();
    }
  });
});
