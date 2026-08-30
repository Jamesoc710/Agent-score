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
}

/** Keep the fitted line inside the plotted 0–100% range. */
function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: CorrelationPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-ink">{d.name}</p>
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

function CustomDot(props: { cx?: number; cy?: number; payload?: CorrelationPoint }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;
  const rate = payload.success_rate;
  // Redundant with the y position, which is the channel that actually carries the value.
  const tone = rate >= 0.7 ? "good" : rate >= 0.4 ? "mid" : "bad";
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fillOpacity={0.85}
        strokeWidth={1.5}
        className={`chart-dot chart-dot-${tone}`}
      />
      <text x={cx + 9} y={cy + 4} fontSize={11} className="chart-dot-label">
        {payload.name}
      </text>
    </g>
  );
}

export default function CorrelationChart({ points, fit }: Props) {
  // Guard the empty/partial-data case (e.g. Lane 1 hasn't run yet) so Math.min/max over an
  // empty array can't produce an Infinity axis domain and NaN stats.
  if (points.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center px-4 text-center text-sm text-ink-muted sm:h-[420px]">
        No correlation data yet — run Lane 1 (Lighthouse) and Lane 2 (agent) to populate the scatter.
      </div>
    );
  }

  // Build trend line from min to max x
  const xs = points.map((p) => p.lh_total);
  const xMin = Math.max(0, Math.min(...xs) - 5);
  const xMax = Math.min(100, Math.max(...xs) + 5);
  const trendData = fit
    ? [
        { lh_total: xMin, success_rate: clamp(fit.slope * xMin + fit.intercept) },
        { lh_total: xMax, success_rate: clamp(fit.slope * xMax + fit.intercept) },
      ]
    : [];

  const scatterData = points.map((p) => ({
    ...p,
    // Recharts ScatterChart needs x/y keys
    lh_total: p.lh_total,
    success_rate: p.success_rate,
  }));

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
        <ScatterChart margin={{ top: 16, right: 24, bottom: 40, left: 8 }}>
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
            width={44}
          >
            <Label
              value="Agent Success Rate"
              angle={-90}
              position="insideLeft"
              style={{ fontSize: 12 }}
            />
          </YAxis>
          <Tooltip content={<CustomTooltip />} />
          {/* Trend line */}
          <Scatter
            data={trendData}
            line={{ strokeDasharray: "4 4", strokeWidth: 1.5, className: "chart-trend" }}
            shape={() => <g />}
          />
          {/* Data points */}
          <Scatter data={scatterData} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
