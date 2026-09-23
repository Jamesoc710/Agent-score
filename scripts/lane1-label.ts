// Lane 1 batch labels (design S2-7 §2 "Labels", S2-6 §2). Pure: no I/O.
//
// A published Lane 1 label carries its UTC date and is never re-used:
//   lh-v2-<yyyymmdd>[-<version>][-desktop][-dc]
// The bare dated label is the pinned version on the emulated-phone default; a version suffix
// names a companion Lighthouse, `-desktop` the desktop preset, and `-dc` (always last) a
// datacenter vantage. `smoke-<name>` labels are scratch: they exercise the pipeline, are never
// imported, and take their version and preset from flags.

import type { Lane1Preset } from "./lane1-env";

const DATED = /^lh-v2-(\d{8})(?:-(\d+\.\d+\.\d+))?(-desktop)?(-dc)?$/;
const SCRATCH = /^smoke-[a-z0-9][a-z0-9.-]*$/;

export type Vantage = "residential" | "datacenter";

export interface ResolvedLabel {
  batch: string;
  kind: "dated" | "scratch";
  /** yyyymmdd for a dated label; null for scratch. */
  date: string | null;
  lighthouse_version: string;
  preset: Lane1Preset;
}

export interface LabelRequest {
  batch: string;
  vantage: Vantage;
  /** The run's start date in UTC, yyyymmdd. */
  runDate: string;
  pinnedVersion: string;
  /** Explicit flags; on a dated label they must agree with what the label says. */
  lighthouseVersion?: string;
  preset?: Lane1Preset;
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

export function resolveLabel(req: LabelRequest): ResolvedLabel {
  const { batch, vantage, runDate, pinnedVersion } = req;

  if (SCRATCH.test(batch)) {
    return {
      batch,
      kind: "scratch",
      date: null,
      lighthouse_version: req.lighthouseVersion ?? pinnedVersion,
      preset: req.preset ?? null,
    };
  }

  const m = batch.match(DATED);
  if (!m) {
    throw new Error(
      `"${batch}" is not a Lane 1 label. Use lh-v2-<yyyymmdd>[-<version>][-desktop][-dc] ` +
        `(UTC date) or smoke-<name> for a scratch run.`
    );
  }
  const [, date, versionSuffix, desktop, dc] = m;

  if (!isRealDate(date)) throw new Error(`"${batch}": ${date} is not a calendar date.`);
  if (date !== runDate) {
    throw new Error(`"${batch}": a Lane 1 label carries its run's UTC start date, which is ${runDate}.`);
  }
  if (versionSuffix === pinnedVersion) {
    throw new Error(
      `"${batch}": ${pinnedVersion} is the pinned version, which the bare label lh-v2-${date} already names.`
    );
  }
  if ((dc !== undefined) !== (vantage === "datacenter")) {
    throw new Error(`"${batch}": the -dc suffix and --vantage datacenter go together, and only together.`);
  }

  const lighthouse_version = versionSuffix ?? pinnedVersion;
  const preset: Lane1Preset = desktop ? "desktop" : null;
  if (req.lighthouseVersion !== undefined && req.lighthouseVersion !== lighthouse_version) {
    throw new Error(`"${batch}" names Lighthouse ${lighthouse_version}; --lighthouse-version says ${req.lighthouseVersion}.`);
  }
  if (req.preset !== undefined && req.preset !== preset) {
    throw new Error(`"${batch}" names preset ${preset ?? "none"}; --preset says ${req.preset ?? "none"}.`);
  }

  return { batch, kind: "dated", date, lighthouse_version, preset };
}

/** The four P4 labels of one day, all under one date (S2-7 §2 "Version"). */
export function p4Labels(base: string, companions: string[] = ["13.4.1", "13.5.0"]): string[] {
  return [base, ...companions.map((v) => `${base}-${v}`), `${base}-desktop`];
}

function isRealDate(yyyymmdd: string): boolean {
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export interface ExistingState {
  /** Repo-relative paths of this label's artifacts that already exist. */
  existing: string[];
  manifest: { started_at?: unknown; finished_at?: unknown } | null;
}

/**
 * A label holds exactly one run. Refuse when any artifact exists, except `--resume` on an
 * interrupted batch of the same day: a manifest with a null finished_at and a started_at on
 * the run date (S2-6 §2).
 */
export function refuseExistingLabel(
  batch: string,
  state: ExistingState,
  opts: { resume: boolean; runDate: string }
): string | null {
  if (state.existing.length === 0) {
    return opts.resume ? `--resume given, but "${batch}" has no artifacts to resume.` : null;
  }
  if (!opts.resume) {
    return `"${batch}" already exists (${state.existing.join(", ")}). A Lane 1 label is never re-used.`;
  }
  const m = state.manifest;
  if (!m) return `--resume needs "${batch}"'s manifest, and there is none.`;
  if (m.finished_at !== null) return `--resume: "${batch}" finished at ${String(m.finished_at)}; it is not interrupted.`;
  const started = typeof m.started_at === "string" ? utcDate(new Date(m.started_at)) : null;
  if (started !== opts.runDate) {
    return `--resume: "${batch}" started on ${started ?? "an unknown date"}, not ${opts.runDate}. A resume never adds a second day.`;
  }
  return null;
}
