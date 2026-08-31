import type { SiteTier } from "@/lib/types";

// Cohort-design context for a site. Rendered wherever a bare number would otherwise
// mislead — "Amazon 0%" without its blocker flag reads as a broken benchmark instead
// of an expected finding.
//
// The tier is categorical, not ordinal: it separates kinds of site, it does not rank them.
// The label always spells the tier out, which is the channel that carries the meaning, so the
// chips are one neutral style rather than six hues: six categorical colours in a table column
// read as a legend the reader has to learn, and there was never anything to learn.

const TIER_LABELS: Record<SiteTier, string> = {
  anchor: "anchor",
  middle: "middle",
  government: "government",
  small_business: "small business",
  off_diagonal: "off-diagonal",
  blocker: "blocker",
};

export function TierBadge({ tier }: { tier: SiteTier }) {
  return <span className="chip chip-neutral">{TIER_LABELS[tier]}</span>;
}

export function FlagBadge({ flag }: { flag: string }) {
  if (!flag) return null;
  return (
    <span className="inline-block rounded bg-notice px-1.5 py-0.5 text-xs text-notice-body">
      {flag}
    </span>
  );
}
