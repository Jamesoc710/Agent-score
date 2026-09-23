import { existsSync, readFileSync } from "fs";
import { manifestPath } from "./artifacts";

// The batch manifest (design S2-6 §3), schema_version 1. This module owns what a valid one is,
// for both its writer (scripts/batch-manifest.ts) and its reader (scripts/import-results.ts).
// scripts/health-card.py's HC12 applies the same bare-null rule in Python.

export const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestArtifact {
  path: string;
  sha256: string;
}

export interface Manifest {
  schema_version: number;
  batch_label: string;
  agent_ids: string[];
  artifacts: ManifestArtifact[];
  started_at: string;
  finished_at: string | null;
  [field: string]: unknown;
}

/**
 * Every null must carry a sibling `<field>_null_reason`: "we did not record it" and "there was
 * nothing to record" are different facts. Returns the dotted paths of the bare nulls.
 */
export function findBareNulls(value: unknown, at = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (item === null) out.push(`${at}[${i}]`);
      else out.push(...findBareNulls(item, `${at}[${i}]`));
    });
    return out;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(obj)) {
      const where = at ? `${at}.${key}` : key;
      if (child === null) {
        const reason = obj[`${key}_null_reason`];
        if (typeof reason !== "string" || reason.trim() === "") out.push(where);
      } else {
        out.push(...findBareNulls(child, where));
      }
    }
  }
  return out;
}

/** Problems that make a manifest unusable for `batch`; empty when it is valid. */
export function manifestProblems(manifest: unknown, batch: string): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["the manifest is not a JSON object"];
  }
  const m = manifest as Record<string, unknown>;
  const problems: string[] = [];
  if (m.schema_version !== MANIFEST_SCHEMA_VERSION) {
    problems.push(`schema_version is ${JSON.stringify(m.schema_version)}, expected ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (m.batch_label !== batch) {
    problems.push(`batch_label is ${JSON.stringify(m.batch_label)}, expected "${batch}"`);
  }
  if (!Array.isArray(m.agent_ids) || !m.agent_ids.every((a) => typeof a === "string")) {
    problems.push("agent_ids is not an array of strings");
  }
  if (
    !Array.isArray(m.artifacts) ||
    !m.artifacts.every(
      (a) => a && typeof a === "object" && typeof a.path === "string" && typeof a.sha256 === "string"
    )
  ) {
    problems.push("artifacts is not an array of {path, sha256}");
  }
  if (typeof m.started_at !== "string") problems.push("started_at is missing");
  const bare = findBareNulls(m);
  if (bare.length > 0) problems.push(`bare nulls (no <field>_null_reason): ${bare.join(", ")}`);
  return problems;
}

export type ManifestRead =
  | { ok: true; manifest: Manifest }
  | { ok: false; problems: string[] };

export function readManifest(batch: string, file: string = manifestPath(batch)): ManifestRead {
  if (!existsSync(file)) return { ok: false, problems: [`no manifest at ${file}`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { ok: false, problems: [`the manifest does not parse: ${(err as Error).message}`] };
  }
  const problems = manifestProblems(parsed, batch);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, manifest: parsed as Manifest };
}
