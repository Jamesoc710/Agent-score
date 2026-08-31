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

/** Percent with no false precision, or an en dash when there is nothing to report. */
export function formatPercent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

/**
 * A success-rate difference in percentage points, signed: "+41.4", "−9.7", "0.0".
 *
 * One decimal, because the underlying rates come from 5 trials a site and a second decimal
 * would be precision the measurement does not have.
 */
export function formatPoints(gap: number): string {
  const value = gap * 100;
  // -0.0 reads as a negative finding that is not there.
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
}

/** "[−0.1, +71.7]" in percentage points. */
export function formatPointsInterval(interval: { lo: number; hi: number }): string {
  return `[${formatPoints(interval.lo)}, ${formatPoints(interval.hi)}]`;
}

/**
 * A p-value at the precision it was actually estimated to.
 *
 * Three decimals, and never "0.000": a Monte-Carlo p is bounded below by 1/(iterations+1), and
 * printing zero would claim a certainty no finite number of permutations can support.
 */
export function formatP(p: number): string {
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

/** Scientific notation for the one p-value on the site that needs it: "5.0 × 10⁻⁸". */
export function formatSmallP(p: number): string {
  if (p >= 0.001) return p.toFixed(3);
  const exponent = Math.floor(Math.log10(p));
  const mantissa = (p / 10 ** exponent).toFixed(1);
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const digits = Math.abs(exponent)
    .toString()
    .split("")
    .map((d) => superscripts[Number(d)])
    .join("");
  return `${mantissa} × 10⁻${digits}`;
}
