// The site's signature graphic: a published interval, drawn.
//
// AgentRank publishes an interval on nearly every headline number and used to render all of
// them as bracketed text. A reader should be able to *see* that our intervals are wide and
// that they cross zero: that is the honest presentation of a study whose result is two nulls
// and a power bound.
//
// Plain nested divs, no SVG and no client JavaScript: these are server components, and the
// position of every element is a percentage of a declared domain.
//
// THE LOAD-BEARING RULE: when `interval` is null the component renders NOTHING, not an empty
// track. An empty track reads as a zero-width interval, which is a claim; the absence of a
// measurement has to render as the absence of a graphic, and the caller prints the words
// ("unfalsifiable at this split", "not reportable") in the space instead.
//
// Every bar is `aria-hidden`: the numbers it draws are always printed as text beside it, so it
// is a redundant encoding, which is also why colour is never the only channel here.

export interface Domain {
  min: number;
  max: number;
}

export interface Interval {
  lo: number;
  hi: number;
}

interface Props {
  /** The full scale the track represents. Printed as ticks wherever the bar is `md`. */
  domain: Domain;
  /** The published interval, or null when the statistic is not computable. */
  interval: Interval | null;
  /** The point estimate, drawn as a tick inside the box. */
  point: number | null;
  /** Draw a vertical rule at 0, so a reader can see which intervals cross it. */
  zero?: boolean;
  /** Dashed vertical rules, e.g. the family-wise critical value. Labelled once per figure. */
  refLines?: number[];
  /** sm = table rows, md = a headline figure. */
  height?: "sm" | "md";
  className?: string;
}

/** Position within the domain as a percentage, clamped so nothing escapes the track. */
function position(value: number, domain: Domain): number {
  const span = domain.max - domain.min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - domain.min) / span) * 100));
}

export default function IntervalBar({
  domain,
  interval,
  point,
  zero = false,
  refLines = [],
  height = "sm",
  className = "",
}: Props) {
  if (interval === null) return null;

  const lo = position(Math.min(interval.lo, interval.hi), domain);
  const hi = position(Math.max(interval.lo, interval.hi), domain);
  const rowHeight = height === "md" ? "h-4" : "h-3";
  const trackHeight = height === "md" ? "h-1.5" : "h-1";
  const boxHeight = height === "md" ? "h-2.5" : "h-2";

  return (
    <div aria-hidden="true" className={`relative w-full ${rowHeight} ${className}`}>
      {/* Track: always the whole declared domain, so widths are comparable between figures. */}
      <div
        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-surface-2 ring-1 ring-inset ring-line-soft ${trackHeight}`}
      />

      {refLines.map((at) => (
        <div
          key={at}
          className="absolute inset-y-0 border-l border-dashed border-ink-muted/35"
          style={{ left: `${position(at, domain)}%` }}
        />
      ))}

      {zero && (
        <div
          // Heavier than the dashed reference rules: zero is the line the reader is asked to
          // check every interval against, so it has to read as the anchor and not as one more
          // tick. Both sit behind the interval box.
          className="absolute inset-y-0 w-px bg-ink-muted/60"
          style={{ left: `${position(0, domain)}%` }}
        />
      )}

      {/* The interval itself. Neutral ink, never green: colouring an interval that spans zero
          would dress a non-finding as a result. */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-[2px] bg-ink-muted/70 ${boxHeight}`}
        style={{ left: `${lo}%`, width: `${Math.max(hi - lo, 0.4)}%` }}
      />

      {point !== null && (
        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-[1px] bg-ink"
          style={{ left: `${position(point, domain)}%` }}
        />
      )}
    </div>
  );
}

/** The domain ticks under an `md` bar, so the scale is never implicit. */
export function IntervalTicks({
  labels,
  className = "",
}: {
  labels: string[];
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative mt-1 h-3 font-mono text-[11px] leading-3 text-ink-muted ${className}`}
    >
      {labels.map((label, i) => {
        const at = labels.length === 1 ? 50 : (i / (labels.length - 1)) * 100;
        const anchor =
          i === 0
            ? { left: "0%" }
            : i === labels.length - 1
              ? { right: "0%" }
              : { left: `${at}%`, transform: "translateX(-50%)" };
        return (
          <span key={label} className="absolute top-0 tabular-nums" style={anchor}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The power scale: the one figure on the site that is not an interval.
 *
 * Three markers on a track whose right end is the largest gap this cohort can physically
 * produce. The 80%-power threshold stands past the end of that track, which is the honest
 * picture and the whole argument: the effect the study would need is off the end of what the
 * cohort could ever have shown it.
 *
 * Values come from the analysis object; the sentence the figure illustrates sits directly
 * beneath it and is unchanged.
 */
export function PowerScale({
  criticalValue,
  maxAttainableGap,
  threshold80,
  domainMax = 80,
}: {
  /** Points, already rounded by the caller to the precision the surrounding copy prints. */
  criticalValue: number;
  maxAttainableGap: number;
  threshold80: number;
  domainMax?: number;
}) {
  const domain = { min: 0, max: domainMax };
  const markers = [
    { value: threshold80, label: "needed for 80% power" },
    { value: maxAttainableGap, label: "largest gap possible" },
    { value: criticalValue, label: "critical value" },
  ];
  const trackEnd = position(maxAttainableGap, domain);

  return (
    <div aria-hidden="true" className="mt-4 w-full select-none">
      <div className="relative h-[3.25rem]">
        {markers.map((marker, row) => {
          const at = position(marker.value, domain);
          const top = row * 1.125;
          // Labels sit above the track on their own line each, with a hairline connector down
          // to the tick, so three markers within 20 points of each other stay readable at
          // 375px. Anything past the middle of the scale is anchored from the right so its
          // text runs inwards rather than off the edge.
          const fromRight = at > 45;
          return (
            <div key={marker.label}>
              <span
                className="absolute whitespace-nowrap font-mono text-[11px] leading-[1.125rem] tabular-nums text-emphasis-muted"
                style={
                  fromRight
                    ? { right: `${100 - at}%`, top: `${top}rem`, paddingRight: "0.375rem" }
                    : { left: `${at}%`, top: `${top}rem`, paddingLeft: "0.375rem" }
                }
              >
                {Math.round(marker.value)} {marker.label}
              </span>
              <span
                className="absolute w-px bg-emphasis-muted/50"
                style={{
                  left: `${at}%`,
                  top: `${top + 1.125}rem`,
                  height: `${3.25 - (top + 1.125)}rem`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="relative h-3">
        {/* The track stops at the ceiling. The 80%-power marker has no track under it. */}
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            width: `${trackEnd}%`,
            backgroundColor: "rgb(var(--c-emphasis-line))",
          }}
        />
        {markers.map((marker) => (
          <span
            key={marker.label}
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-[1px] bg-emphasis-ink"
            style={{ left: `${position(marker.value, domain)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
