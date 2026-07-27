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
