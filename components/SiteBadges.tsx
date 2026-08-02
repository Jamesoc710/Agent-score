import type { SiteTier } from "@/lib/types";

// Cohort-design context for a site. Rendered wherever a bare number would otherwise
// mislead — "Amazon 0%" without its blocker flag reads as a broken benchmark instead
// of an expected finding.

const TIER_STYLES: Record<SiteTier, { label: string; className: string }> = {
  anchor: { label: "anchor", className: "bg-sky-50 text-sky-700" },
  middle: { label: "middle", className: "bg-slate-100 text-slate-600" },
  government: { label: "government", className: "bg-indigo-50 text-indigo-700" },
  small_business: { label: "small business", className: "bg-teal-50 text-teal-700" },
  off_diagonal: { label: "off-diagonal", className: "bg-violet-50 text-violet-700" },
  blocker: { label: "blocker", className: "bg-rose-50 text-rose-700" },
};

export function TierBadge({ tier }: { tier: SiteTier }) {
  const { label, className } = TIER_STYLES[tier];
  return (
    <span className={`inline-block text-xs rounded px-1.5 py-0.5 whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

export function FlagBadge({ flag }: { flag: string }) {
  if (!flag) return null;
  return (
    <span className="inline-block text-xs rounded px-1.5 py-0.5 bg-amber-50 text-amber-700">
      {flag}
    </span>
  );
}
