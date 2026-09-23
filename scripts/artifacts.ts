import path from "path";

// Local artifact paths. Both lanes write here first and only here: the DB is loaded from
// these files by scripts/import-results.ts, so an interrupted or offline run never loses
// data and a batch can be re-imported without re-running anything.
//
// The batch label is in the filename so a smoke batch and a published batch cannot overwrite
// each other. lane2-agent.py mirrors this convention in Python.

export const DATA_DIR = path.join(process.cwd(), "data");

export function lighthouseArtifactPath(batch: string): string {
  return path.join(DATA_DIR, `lighthouse-${batch}.json`);
}

export function agentRunsArtifactPath(batch: string): string {
  return path.join(DATA_DIR, `agent-runs-${batch}.jsonl`);
}

// The batch manifest (design S2-6 §3): which code, browser, vantage and machine produced a
// batch. The importer refuses a batch without one outside the legacy set.
export function manifestPath(batch: string): string {
  return path.join(DATA_DIR, `manifest-${batch}.json`);
}

// Lane 1 companions of lighthouse-<batch>.json (design S2-7 §2 "Artifacts"). The typed row
// file stays importable as LighthouseResult only; everything the v2 panel adds lives beside it.
export function lighthouseFailuresPath(batch: string): string {
  return path.join(DATA_DIR, `lighthouse-${batch}.failures.json`);
}

export function lighthouseAuditsPath(batch: string): string {
  return path.join(DATA_DIR, `lighthouse-${batch}.audits.json`);
}

export function lighthousePanelPath(batch: string): string {
  return path.join(DATA_DIR, `lighthouse-${batch}.panel.json`);
}

export function llmsTxtSidecarPath(batch: string): string {
  return path.join(DATA_DIR, `lighthouse-${batch}.llms-txt.json`);
}

export function lhrDir(batch: string): string {
  return path.join(DATA_DIR, "lhr", batch);
}

export function lhrPath(batch: string, siteId: string, repeat: number): string {
  return path.join(lhrDir(batch), `${siteId}.${repeat}.json`);
}

export function reconstructionPath(batch: string): string {
  return path.join(lhrDir(batch), "reconstruction.json");
}

export function envPath(batch: string): string {
  return path.join(DATA_DIR, `env-${batch}.txt`);
}

export function healthPath(batch: string): string {
  return path.join(DATA_DIR, `health-${batch}.json`);
}

export function scannersPath(date: string): string {
  return path.join(DATA_DIR, `scanners-${date}.json`);
}
