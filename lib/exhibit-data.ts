import type { ExhibitDataset } from "./exhibit";
import published from "../data/exhibit-goodhart.json";

/**
 * The measured Goodhart exhibit, read from the committed derivation of its lane artifacts.
 *
 * Split from lib/exhibit.ts so that scripts/build-exhibit-summary.ts, which produces this
 * file's input, can import the fold without importing its own output.
 *
 * Unlike every other dataset on this site this one is not agent-scoped or batch-scoped at read
 * time: there is exactly one exhibit batch and both its agents are always shown, because the
 * pair's whole claim is that the same thing happens to both of them.
 *
 * The cast is narrow by construction rather than by trust: lib/exhibit.test.ts re-derives this
 * exact object from data/exhibit-cohort.csv, data/lighthouse-goodhart.json and
 * data/agent-runs-goodhart.jsonl and fails if it has drifted.
 */
export const EXHIBIT = published as unknown as ExhibitDataset;
