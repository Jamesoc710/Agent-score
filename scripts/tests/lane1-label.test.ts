import { describe, expect, it } from "vitest";
import { p4Labels, refuseExistingLabel, resolveLabel, utcDate, type LabelRequest } from "../lane1-label";

// The Lane 1 label rule (design S2-7 §2 "Labels", S2-6 §2): dated, never re-used.

const base: Omit<LabelRequest, "batch"> = { vantage: "residential", runDate: "20260923", pinnedVersion: "13.3.0" };

describe("resolveLabel", () => {
  it("reads the version and preset from a dated label", () => {
    expect(resolveLabel({ ...base, batch: "lh-v2-20260923" })).toEqual({
      batch: "lh-v2-20260923",
      kind: "dated",
      date: "20260923",
      lighthouse_version: "13.3.0",
      preset: null,
    });
    expect(resolveLabel({ ...base, batch: "lh-v2-20260923-13.5.0" }).lighthouse_version).toBe("13.5.0");
    expect(resolveLabel({ ...base, batch: "lh-v2-20260923-desktop" })).toMatchObject({ lighthouse_version: "13.3.0", preset: "desktop" });
    expect(resolveLabel({ ...base, batch: "lh-v2-20260923-13.5.0-desktop" })).toMatchObject({ lighthouse_version: "13.5.0", preset: "desktop" });
  });

  it("requires the run's UTC date and a real calendar date", () => {
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260922" })).toThrow(/UTC start date/);
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260931", runDate: "20260931" })).toThrow(/calendar date/);
    expect(() => resolveLabel({ ...base, batch: "lh-v2" })).toThrow(/not a Lane 1 label/);
    expect(() => resolveLabel({ ...base, batch: "v1" })).toThrow(/not a Lane 1 label/);
  });

  it("refuses the pinned version as a suffix, and a -dc label off the datacenter vantage", () => {
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260923-13.3.0" })).toThrow(/pinned version/);
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260923-dc" })).toThrow(/-dc/);
    expect(() => resolveLabel({ ...base, vantage: "datacenter", batch: "lh-v2-20260923" })).toThrow(/-dc/);
    expect(resolveLabel({ ...base, vantage: "datacenter", batch: "lh-v2-20260923-dc" }).kind).toBe("dated");
  });

  it("refuses flags that disagree with the label", () => {
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260923", lighthouseVersion: "13.5.0" })).toThrow(/names Lighthouse 13.3.0/);
    expect(() => resolveLabel({ ...base, batch: "lh-v2-20260923", preset: "desktop" })).toThrow(/preset/);
    expect(resolveLabel({ ...base, batch: "lh-v2-20260923-13.4.1", lighthouseVersion: "13.4.1" }).lighthouse_version).toBe("13.4.1");
  });

  it("takes a scratch label's version and preset from the flags", () => {
    expect(resolveLabel({ ...base, batch: "smoke-p4-13.5.0", lighthouseVersion: "13.5.0" })).toMatchObject({
      kind: "scratch",
      date: null,
      lighthouse_version: "13.5.0",
      preset: null,
    });
    expect(resolveLabel({ ...base, batch: "smoke-p4" }).lighthouse_version).toBe("13.3.0");
  });

  it("names the four P4 batches of one day", () => {
    expect(p4Labels("lh-v2-20260923")).toEqual([
      "lh-v2-20260923",
      "lh-v2-20260923-13.4.1",
      "lh-v2-20260923-13.5.0",
      "lh-v2-20260923-desktop",
    ]);
    expect(utcDate(new Date("2026-09-23T23:59:59Z"))).toBe("20260923");
  });
});

describe("refuseExistingLabel", () => {
  const opts = { resume: false, runDate: "20260923" };

  it("allows a fresh label and refuses one with any artifact", () => {
    expect(refuseExistingLabel("lh-v2-20260923", { existing: [], manifest: null }, opts)).toBeNull();
    expect(refuseExistingLabel("lh-v2-20260923", { existing: ["data/lhr/lh-v2-20260923"], manifest: null }, opts)).toMatch(/never re-used/);
  });

  it("resumes only an interrupted batch of the same UTC day", () => {
    const resume = { resume: true, runDate: "20260923" };
    const existing = ["data/lighthouse-lh-v2-20260923.json"];
    expect(refuseExistingLabel("x", { existing, manifest: { started_at: "2026-09-23T09:00:00Z", finished_at: null } }, resume)).toBeNull();
    expect(refuseExistingLabel("x", { existing, manifest: { started_at: "2026-09-23T09:00:00Z", finished_at: "2026-09-23T10:00:00Z" } }, resume)).toMatch(/not interrupted/);
    expect(refuseExistingLabel("x", { existing, manifest: { started_at: "2026-09-22T23:00:00Z", finished_at: null } }, resume)).toMatch(/second day/);
    expect(refuseExistingLabel("x", { existing, manifest: null }, resume)).toMatch(/manifest/);
    expect(refuseExistingLabel("x", { existing: [], manifest: null }, resume)).toMatch(/no artifacts/);
  });
});
