import type { SiteTier } from "@/lib/types";

// Cohort-design context for a site. Rendered wherever a bare number would otherwise
// mislead — "Amazon 0%" without its blocker flag reads as a broken benchmark instead
// of an expected finding.
//
// The tier hues are categorical, not ordinal: they separate kinds of site, they do not rank
// them. They come from the shared `.chip-*` family in globals.css so each one is defined once
// per theme, and the label always spells the tier out — colour is never the only channel.

const TIER_STYLES: Record<SiteTier, { label: string; className: string }> = {
  anchor: { label: "anchor", className: "chip-sky" },
  middle: { label: "middle", className: "chip-slate" },
  government: { label: "government", className: "chip-indigo" },
  small_business: { label: "small business", className: "chip-teal" },
  off_diagonal: { label: "off-diagonal", className: "chip-violet" },
  blocker: { label: "blocker", className: "chip-rose" },
};

export function TierBadge({ tier }: { tier: SiteTier }) {
  const { label, className } = TIER_STYLES[tier];
  return <span className={`chip ${className}`}>{label}</span>;
}

export function FlagBadge({ flag }: { flag: string }) {
  if (!flag) return null;
  return (
    <span className="inline-block rounded bg-notice px-1.5 py-0.5 text-xs text-notice-body">
      {flag}
    </span>
  );
}
