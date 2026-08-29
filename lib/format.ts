import type { DatasetSummary } from "./types";

// Formatting for numbers the site publishes. One place decides how a measurement is worded,
// because the rule the whole project rests on is that a number never appears without the
// denominator and the dates it came from.

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  // Runs are stamped in UTC; formatting in the server's local zone would drift the published
  // run window by a day depending on where the page rendered.
  timeZone: "UTC",
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", DATE_FORMAT);
}

/** "19 Aug 2026" for a single-day run, "19–20 Aug 2026" style range otherwise. */
export function formatRunWindow(window: DatasetSummary["run_window"]): string | null {
  if (!window) return null;
  const first = formatDate(window.first);
  const last = formatDate(window.last);
  return first === last ? first : `${first} – ${last}`;
}

/** Percent with no false precision, or an em dash when there is nothing to report. */
export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
