import { ImageResponse } from "next/og";
import { FINDING_IDS, goodhartFigures, type GoodhartSide } from "@/lib/findings";

// The share card for one finding. Like the site-wide card it never reads the database: its
// figures come from the committed exhibit fold, the same artifact the card on the page reads.
// Colours are the dark-theme tokens as literals, as in app/opengraph-image.tsx. The outcome
// glyphs are drawn as shapes: the image renderer has no font carrying ● and ○.

export const alt = "An AgentRank finding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return FINDING_IDS.map((id) => ({ id }));
}

export default function FindingImage({ params }: { params: { id: string } }) {
  const figures = params.id === "goodhart" ? goodhartFigures() : null;

  const glyph = (outcome: GoodhartSide["outcomes"][number], i: number) => (
    <div
      key={i}
      style={{
        display: "flex",
        width: outcome === "excluded" ? 22 : 26,
        height: outcome === "excluded" ? 3 : 26,
        borderRadius: outcome === "excluded" ? 0 : 13,
        backgroundColor: outcome === "success" || outcome === "excluded" ? "#f0eee7" : "transparent",
        border: outcome === "failure" ? "3px solid #a09c91" : "none",
      }}
    />
  );

  const row = (side: GoodhartSide) => (
    <div style={{ display: "flex", alignItems: "center", gap: "28px", marginTop: "18px" }}>
      <div style={{ display: "flex", width: "420px", fontSize: 28, color: "#c5c1b7", fontFamily: "sans-serif" }}>
        {side.name}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>{side.outcomes.map(glyph)}</div>
      <div style={{ display: "flex", fontSize: 30, color: "#f0eee7", fontFamily: "monospace" }}>
        {`${side.successes} of ${side.measured}`}
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          backgroundColor: "#181714",
          color: "#f0eee7",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 24, color: "#a09c91", fontFamily: "sans-serif" }}>
          AgentRank · finding
        </div>
        {/* One explicit column: the image renderer lays fragment children out as a row. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 500, marginTop: 18, lineHeight: 1.15 }}>
            {figures?.title ?? "AgentRank"}
          </div>
          {figures && (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 36 }}>
              {row(figures.control)}
              {row(figures.gated)}
            </div>
          )}
          {figures && (
            <div style={{ display: "flex", fontSize: 26, color: "#a09c91", marginTop: 36, fontFamily: "sans-serif" }}>
              {`Lighthouse category mean, both pages: ${figures.sharedMean ?? "not the same"} · batch ${figures.batch} · authored pages, not cohort data`}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
