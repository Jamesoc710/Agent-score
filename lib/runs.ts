import type { Run } from "./types";

/**
 * The pre-registered denominator rule, in one place because two readers now need it.
 *
 * docs/METHODOLOGY.md, failure modes: an "error" row is excluded from success-rate
 * denominators ONLY if the run never reached the site (goto failed, so step_count is 0).
 * Errors after the site was reached stay in the denominator as failures. A site whose every
 * trial never connected therefore has no behavioral measurement at all, which is a different
 * statement from a 0% success rate, and the pages say so.
 *
 * It lives here rather than in lib/queries.ts because lib/exhibit.ts needs the identical rule
 * and queries.ts cannot be imported outside React (it memoizes its batch read with
 * react/cache). queries.ts re-exports it, so every existing import site is unchanged.
 */
export function measuredRuns(runs: Run[]): Run[] {
  return runs.filter((r) => !(r.failure_mode === "error" && r.step_count === 0));
}
