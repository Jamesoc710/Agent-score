// The importer's two refusals, kept apart from import-results.ts so they can be tested without
// a database (design S2-6 §3 and §7, S2-7 §2 "Labels").
//
// 1. No manifest, no import: a batch with an artifact needs a valid manifest. `--no-manifest`
//    is an escape for the three batches that predate manifests and for no other label.
// 2. A Lane 1 label holds exactly one run: the upsert on (site_id, batch_label) would lay a
//    second run over the first row by row, so a label that already has rows in
//    lighthouse_results is refused. `--reimport` re-imports the identical artifact only, which
//    it proves by the artifact's sha256 against the manifest's `artifacts` list.

import { readManifest, type Manifest, type ManifestRead } from "./manifest";

export const LEGACY_NO_MANIFEST_LABELS: ReadonlySet<string> = new Set(["v1", "pilot", "goodhart"]);

export type Guard = { ok: true } | { ok: false; problems: string[] };

export interface ManifestCheckInput {
  batch: string;
  noManifest: boolean;
  hasLighthouseArtifact: boolean;
  hasRunsArtifact: boolean;
  /** Distinct agent_id values in the batch's JSONL. */
  runAgentIds: string[];
  read?: (batch: string) => ManifestRead;
}

export function checkManifestPrecondition(input: ManifestCheckInput): Guard {
  const { batch, noManifest } = input;
  if (noManifest) {
    return LEGACY_NO_MANIFEST_LABELS.has(batch)
      ? { ok: true }
      : {
          ok: false,
          problems: [
            `--no-manifest is only for the batches that predate manifests (${[...LEGACY_NO_MANIFEST_LABELS].join(", ")}); ` +
              `"${batch}" needs data/manifest-${batch}.json.`,
          ],
        };
  }
  if (!input.hasLighthouseArtifact && !input.hasRunsArtifact) return { ok: true };

  const read = (input.read ?? readManifest)(batch);
  if (!read.ok) return { ok: false, problems: read.problems };

  const listed = new Set(read.manifest.agent_ids);
  const missing = input.runAgentIds.filter((id) => !listed.has(id));
  if (missing.length > 0) {
    return { ok: false, problems: [`agent_ids in the JSONL but not in the manifest: ${missing.join(", ")}`] };
  }
  return { ok: true };
}

export interface LabelCheckInput {
  batch: string;
  /** Rows lighthouse_results already holds for this batch_label. */
  existingRows: number;
  reimport: boolean;
  /** Repo-relative path of the Lane 1 artifact, as the manifest lists it. */
  artifactPath: string;
  artifactSha256: string;
  /** Null when there is no manifest (a legacy batch imported with --no-manifest). */
  manifest: Manifest | null;
}

export function checkLighthouseLabel(input: LabelCheckInput): Guard {
  if (input.existingRows === 0) return { ok: true };
  const already = `lighthouse_results already holds ${input.existingRows} rows for "${input.batch}".`;
  if (!input.reimport) {
    return {
      ok: false,
      problems: [
        `${already} A Lane 1 label holds one run; a new run needs a new dated label. ` +
          `--reimport re-imports the identical artifact only.`,
      ],
    };
  }
  if (!input.manifest) {
    return { ok: false, problems: [`${already} --reimport needs the manifest's digest to prove the artifact is identical, and there is no manifest.`] };
  }
  const listed = input.manifest.artifacts.find((a) => a.path === input.artifactPath);
  if (!listed) {
    return { ok: false, problems: [`${already} The manifest lists no digest for ${input.artifactPath}.`] };
  }
  if (listed.sha256 !== input.artifactSha256) {
    return {
      ok: false,
      problems: [
        `${already} ${input.artifactPath} has sha256 ${input.artifactSha256}, but the manifest recorded ${listed.sha256}: ` +
          `this is not the artifact that was imported.`,
      ],
    };
  }
  return { ok: true };
}

/** Counts rows of `table` where `column` equals `value`; the importer builds it on its Supabase client. */
export type CountQuery = (
  table: string,
  column: string,
  value: string
) => PromiseLike<{ count: number | null; error: { message: string } | null }>;

export async function lighthouseRowCount(count: CountQuery, batch: string): Promise<number> {
  const { count: rows, error } = await count("lighthouse_results", "batch_label", batch);
  if (error) throw new Error(`Could not count lighthouse_results for "${batch}": ${error.message}`);
  return rows ?? 0;
}
