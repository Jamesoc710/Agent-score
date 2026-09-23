import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_NO_MANIFEST_LABELS,
  checkLighthouseLabel,
  checkManifestPrecondition,
  lighthouseRowCount,
  type CountQuery,
} from "../import-guards";
import { findBareNulls, manifestProblems, type Manifest, type ManifestRead } from "../manifest";

// The importer's refusals (design S2-6 §3 and §7, S2-7 §2). No test here reaches a database:
// the one query the guards need is passed in, and here it is a fake.

vi.mock("../supabase-admin", () => ({
  getServiceClient: () => {
    throw new Error("a test reached the service client");
  },
}));

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  schema_version: 1,
  batch_label: "lh-v2-20260923",
  agent_ids: [],
  artifacts: [{ path: "data/lighthouse-lh-v2-20260923.json", sha256: "abc" }],
  started_at: "2026-09-23T09:00:00.000Z",
  finished_at: "2026-09-23T10:00:00.000Z",
  ...over,
});

const ok = (m: Manifest): ManifestRead => ({ ok: true, manifest: m });

describe("the manifest precondition", () => {
  const input = {
    batch: "lh-v2-20260923",
    noManifest: false,
    hasLighthouseArtifact: true,
    hasRunsArtifact: false,
    runAgentIds: [],
  };

  it("confines --no-manifest to the three legacy batches", () => {
    expect([...LEGACY_NO_MANIFEST_LABELS].sort()).toEqual(["goodhart", "pilot", "v1"]);
    for (const batch of ["v1", "pilot", "goodhart"]) {
      expect(checkManifestPrecondition({ ...input, batch, noManifest: true }).ok).toBe(true);
    }
    for (const batch of ["lh-v2-20260923", "dev", "v2-retest", "V1", "smoke-p4"]) {
      const guard = checkManifestPrecondition({ ...input, batch, noManifest: true });
      expect(guard.ok).toBe(false);
    }
  });

  it("refuses a batch with an artifact and no valid manifest", () => {
    const missing = checkManifestPrecondition({ ...input, read: () => ({ ok: false, problems: ["no manifest"] }) });
    expect(missing).toEqual({ ok: false, problems: ["no manifest"] });
    expect(checkManifestPrecondition({ ...input, read: () => ok(manifest()) }).ok).toBe(true);
  });

  it("does not ask for a manifest when there is nothing to import", () => {
    const read = vi.fn();
    expect(checkManifestPrecondition({ ...input, hasLighthouseArtifact: false, read }).ok).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it("requires the manifest to list every agent in the JSONL", () => {
    const guard = checkManifestPrecondition({
      ...input,
      hasRunsArtifact: true,
      runAgentIds: ["gemini-3.5-flash-lite", "gemini-3.6-flash"],
      read: () => ok(manifest({ agent_ids: ["gemini-3.5-flash-lite"] })),
    });
    expect(guard.ok).toBe(false);
  });
});

describe("what a valid manifest is", () => {
  it("finds a bare null, and accepts a null with its reason", () => {
    expect(findBareNulls({ a: null, b: { c: null, c_null_reason: "none" }, d: [null] })).toEqual(["a", "d[0]"]);
    expect(manifestProblems(manifest(), "lh-v2-20260923")).toEqual([]);
    expect(manifestProblems(manifest({ finished_at: null }), "lh-v2-20260923")).toEqual([
      "bare nulls (no <field>_null_reason): finished_at",
    ]);
    expect(manifestProblems(manifest(), "other")[0]).toMatch(/batch_label/);
    expect(manifestProblems(manifest({ schema_version: 2 }), "lh-v2-20260923")[0]).toMatch(/schema_version/);
  });
});

describe("a Lane 1 label holds one run", () => {
  const input = {
    batch: "lh-v2-20260923",
    existingRows: 0,
    reimport: false,
    artifactPath: "data/lighthouse-lh-v2-20260923.json",
    artifactSha256: "abc",
    manifest: manifest(),
  };

  it("imports a label with no rows", () => {
    expect(checkLighthouseLabel(input).ok).toBe(true);
  });

  it("refuses a label that already has rows", () => {
    const guard = checkLighthouseLabel({ ...input, existingRows: 28 });
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.problems[0]).toMatch(/already holds 28 rows/);
  });

  it("re-imports under --reimport only the artifact whose digest the manifest recorded", () => {
    expect(checkLighthouseLabel({ ...input, existingRows: 28, reimport: true }).ok).toBe(true);
    expect(checkLighthouseLabel({ ...input, existingRows: 28, reimport: true, artifactSha256: "def" }).ok).toBe(false);
    expect(checkLighthouseLabel({ ...input, existingRows: 28, reimport: true, manifest: null }).ok).toBe(false);
    expect(
      checkLighthouseLabel({ ...input, existingRows: 28, reimport: true, manifest: manifest({ artifacts: [] }) }).ok
    ).toBe(false);
  });

  it("counts existing rows through the query it is given", async () => {
    const calls: string[][] = [];
    const count: CountQuery = async (table, column, value) => {
      calls.push([table, column, value]);
      return { count: 28, error: null };
    };
    expect(await lighthouseRowCount(count, "lh-v2-20260923")).toBe(28);
    expect(calls).toEqual([["lighthouse_results", "batch_label", "lh-v2-20260923"]]);
    await expect(lighthouseRowCount(async () => ({ count: null, error: { message: "denied" } }), "x")).rejects.toThrow(/denied/);
    expect(await lighthouseRowCount(async () => ({ count: null, error: null }), "x")).toBe(0);
  });
});
