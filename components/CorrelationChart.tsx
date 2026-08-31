"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from "recharts";
import { CorrelationPoint } from "@/lib/types";

interface Props {
  points: CorrelationPoint[];
  /** Least-squares fit, or null when there is nothing (or nothing varying) to fit. */
  fit: { slope: number; intercept: number } | null;
  /**
   * Authored points overlaid on the measured cohort, drawn as outlined diamonds.
   *
   * Used by /correlation/exhibit for the two Goodhart pages. They are a separate Recharts
   * series fed by a separate prop, and no statistic on this site ever sees them: rho, the
   * bootstrap interval, the fitted line and n are all computed upstream from `points` alone.
   * When this is non-empty the cohort dots are drawn small, muted and unlabelled, so the
   * overlay reads as an annotation on the cohort rather than as more cohort data.
   */
  authored?: CorrelationPoint[];
}

/** Keep the fitted line inside the plotted 0–100% range. */
function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: CorrelationPoint & { authored?: boolean } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-ink">{d.name}</p>
      {d.authored && (
        <p className="mb-1 text-xs text-ink-muted">Authored exhibit, not cohort data</p>
      )}
      <p className="text-ink-muted">
        Lighthouse: <span className="font-mono tabular-nums text-ink-body">{d.lh_total}</span>
      </p>
      <p className="text-ink-muted">
        Success rate:{" "}
        <span className="font-mono tabular-nums text-ink-body">
          {Math.round(d.success_rate * 100)}%
        </span>
      </p>
    </div>
  );
}

interface LabelRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A deterministic label-collision pass for the scatter.
 *
 * 28 site names on a 28-point cloud overprint badly in the top-right cluster, where the
 * high-Lighthouse sites pile up. This walks the points in a fixed order (by `site_id`,
 * ascending — never by value, so which label survives is not a function of the result) and
 * drops any label whose box would overlap one already placed. Every point keeps its tooltip,
 * which is the complete channel; the labels are a convenience on top of it.
 *
 * Recharts calls the shape once per datum per render pass, in data order. Seeing the first
 * site again means a new pass has started, so the accumulator clears itself and the layout
 * recomputes correctly when the container is resized.
 */
function createLabelLayout(firstSiteId: string | undefined) {
  const placed: LabelRect[] = [];
  return function place(siteId: string, rect: LabelRect): boolean {
    if (siteId === firstSiteId) placed.length = 0;
    const overlaps = placed.some(
      (r) => rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0
    );
    if (overlaps) return false;
    placed.push(rect);
    return true;
  };
}

/** Mean advance for a mixed-case name in the 11px UI face; reserves space, never positions. */
const LABEL_CHAR_WIDTH = 5.6;
const LABEL_HEIGHT = 13;
/** Clearance from the dot to its label. */
const LABEL_GAP = 9;

function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: CorrelationPoint;
  muted?: boolean;
  place?: (siteId: string, rect: LabelRect) => boolean;
}) {
  const { cx, cy, payload, muted, place } = props;
  if (!cx || !cy || !payload) return null;
  // Backdrop mode: the cohort is context for an overlay, so it keeps its positions and loses
  // its labels. 28 names plus two annotated ones is unreadable ink.
  if (muted) {
    return <circle cx={cx} cy={cy} r={4} className="chart-dot chart-dot-muted" strokeWidth={1} />;
  }
  // Sites scoring near 100 sit against the right edge, where a label drawn rightwards is
  // clipped by the plot area. Flip it to the left of the dot instead of paying for the
  // clearance with a permanently wide right margin, which would cost plot width at 375px.
  //
  // A label blocked on its preferred side tries the other side before it is dropped: the
  // cohort clusters into a handful of success rates, so most collisions are two names in the
  // same row and the second one fits perfectly well pointing the other way.
  const width = payload.name.length * LABEL_CHAR_WIDTH;
  const preferFlip = payload.lh_total > 62;
  const box = (flip: boolean) => ({
    x0: flip ? cx - LABEL_GAP - width : cx + LABEL_GAP,
    x1: flip ? cx - LABEL_GAP : cx + LABEL_GAP + width,
    y0: cy + 4 - LABEL_HEIGHT + 3,
    y1: cy + 4 + 3,
  });
  let flip = preferFlip;
  let showLabel = true;
  if (place) {
    showLabel = place(payload.site_id, box(preferFlip));
    if (!showLabel) {
      // The retry must not re-clear the accumulator, so it is keyed off the same site id only
      // on the first attempt; `place` clears on the first datum, which this is not.
      flip = !preferFlip;
      showLabel = place("", box(flip));
    }
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fillOpacity={0.85} strokeWidth={1.5} className="chart-dot" />
      {showLabel && (
        <text
          x={flip ? cx - LABEL_GAP : cx + LABEL_GAP}
          y={cy + 4}
          fontSize={11}
          textAnchor={flip ? "end" : "start"}
          className="chart-dot-label"
        >
          {payload.name}
        </text>
      )}
    </g>
  );
}

/**
 * An authored point: an outlined diamond, so it is a different mark and not just a different
 * colour. The label is always drawn, including below `sm` where the cohort labels are dropped,
 * because on this chart there are exactly two of them and they are the subject.
 */
function AuthoredMark(props: { cx?: number; cy?: number; payload?: CorrelationPoint }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;
  const r = 7;
  const flip = payload.lh_total > 62;
  return (
    <g>
      <path
        d={`M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`}
        strokeWidth={2}
        className="chart-mark-authored"
      />
      <text
        x={flip ? cx - 12 : cx + 12}
        y={cy + 4}
        fontSize={11}
        textAnchor={flip ? "end" : "start"}
        className="chart-mark-authored-label"
      >
        {payload.name}
      </text>
    </g>
  );
}

export default function CorrelationChart({ points, fit, authored = [] }: Props) {
  const hasAuthored = authored.length > 0;

  // Guard the empty/partial-data case (e.g. Lane 1 hasn't run yet) so Math.min/max over an
  // empty array can't produce an Infinity axis domain and NaN stats.
  if (points.length === 0 && !hasAuthored) {
    return (
      <div className="flex h-[320px] items-center justify-center px-4 text-center text-sm text-ink-muted sm:h-[420px]">
        No correlation data yet: run Lane 1 (Lighthouse) and Lane 2 (agent) to populate the scatter.
      </div>
    );
  }

  // Build trend line from min to max x. Only the cohort's own points set its extent: the
  // authored overlay must not stretch, shorten or otherwise touch the fitted line.
  const xs = points.length > 0 ? points.map((p) => p.lh_total) : [0, 100];
  const xMin = Math.max(0, Math.min(...xs) - 5);
  const xMax = Math.min(100, Math.max(...xs) + 5);
  const trendData = fit
    ? [
        { lh_total: xMin, success_rate: clamp(fit.slope * xMin + fit.intercept) },
        { lh_total: xMax, success_rate: clamp(fit.slope * xMax + fit.intercept) },
      ]
    : [];

  // Sorted by site id so the label-collision pass below walks the points in an order that
  // does not depend on the measurement. Recharts reads x/y off these keys.
  const scatterData = [...points]
    .sort((a, b) => (a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0))
    .map((p) => ({
      ...p,
      lh_total: p.lh_total,
      success_rate: p.success_rate,
    }));
  const place = createLabelLayout(scatterData[0]?.site_id);

  return (
    // Every colour below comes from the same CSS custom properties as the rest of the site,
    // applied by author rules in globals.css that outrank Recharts' own presentation
    // attributes. The chart therefore themes itself on first paint with no client-side theme
    // detection, and cannot flash a light chart on a dark page.
    //
    // Height is set on the wrapper rather than on ResponsiveContainer so it can respond: at
    // 375px a 420px-tall plot with 28 labels is unreadable, and the labels are dropped by a
    // media query in globals.css.
    <div className="chart h-[340px] w-full sm:h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 24, bottom: 40, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="lh_total"
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 12 }}
            tickLine={false}
          >
            <Label
              value="Lighthouse Agentic Browsing Score (0–100)"
              offset={-12}
              position="insideBottom"
              style={{ fontSize: 12 }}
            />
          </XAxis>
          <YAxis
            dataKey="success_rate"
            type="number"
            domain={[0, 1]}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 12 }}
            tickLine={false}
            // Wide enough that the rotated axis title gets its own gutter instead of
            // overprinting the "100%" tick.
            width={62}
          >
            <Label
              value="Agent Success Rate"
              angle={-90}
              position="insideLeft"
              offset={0}
              style={{ fontSize: 12, textAnchor: "middle" }}
            />
          </YAxis>
          <Tooltip content={<CustomTooltip />} />
          {/* Trend line */}
          <Scatter
            data={trendData}
            line={{ strokeDasharray: "4 4", strokeWidth: 1.5, className: "chart-trend" }}
            shape={() => <g />}
          />
          {/* Measured cohort points. Animation off: the label-collision pass reads the final
              positions, and animating them would make labels flicker in and out. */}
          <Scatter
            data={scatterData}
            isAnimationActive={false}
            shape={<CustomDot muted={hasAuthored} place={place} />}
          />
          {/* Authored overlay, kept a separate series so no statistic can pick it up */}
          {hasAuthored && (
            <Scatter
              data={authored.map((p) => ({ ...p, authored: true }))}
              shape={<AuthoredMark />}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
