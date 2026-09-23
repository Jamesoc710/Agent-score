import type { EditionSnapshot } from "./edition";
import published from "../data/edition-v1.json";

/**
 * The published edition, read from its committed snapshot (data/edition-v1.json).
 *
 * Split from lib/edition.ts so that scripts/build-edition-snapshot.ts, which produces the file,
 * can import the fold without importing its own output. The cast is narrow by construction:
 * lib/edition.test.ts re-derives this exact object from the batch's artifacts and fails if the
 * committed file has drifted.
 *
 * Crawled and shared surfaces (sitemap, robots, JSON-LD, /data, /data/v1.json, the citation
 * block) read only this, never lib/queries.ts, so they cannot fail when the database does.
 */
export const EDITION = published as unknown as EditionSnapshot;

/**
 * Whether a live page's batch is the edition's batch.
 *
 * The data pages read the database, which a re-import can move while the snapshot stays put.
 * When the two disagree the page names both and withholds every snapshot figure rather than
 * printing two editions side by side (design S2-4 section 8, the batch-mismatch guard).
 */
export function editionMatches(batchLabel: string): boolean {
  return batchLabel === EDITION.batch_label;
}

/** The snapshot's row for a site, or null for an id outside the edition. */
export function editionSite(siteId: string) {
  return EDITION.sites.find((s) => s.site_id === siteId) ?? null;
}
