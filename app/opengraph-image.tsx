import { ImageResponse } from "next/og";
import { EDITION_TITLE } from "@/lib/edition";

// Static OG card — must never read the database (share crawlers hit it constantly and
// it should not assert any measurement, per the no-invented-numbers rule).
//
// Colours are the dark-theme tokens as literals: the edge runtime has no stylesheet, and a
// share card that drifted from the site would be a second brand.

export const runtime = "edge";
export const alt = `AgentRank: ${EDITION_TITLE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#181714",
          color: "#f0eee7",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "48px" }}>
          <div style={{ width: 28, height: 44, backgroundColor: "#48b252", borderRadius: 6, opacity: 0.5 }} />
          <div style={{ width: 28, height: 68, backgroundColor: "#48b252", borderRadius: 6, opacity: 0.75 }} />
          <div style={{ width: 28, height: 96, backgroundColor: "#48b252", borderRadius: 6 }} />
        </div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 500, letterSpacing: "-0.01em" }}>
          <span>AgentRank</span>
        </div>
        <div style={{ fontSize: 40, color: "#c5c1b7", marginTop: 20 }}>
          {EDITION_TITLE}
        </div>
        <div
          style={{
            fontSize: 26,
            color: "#a09c91",
            marginTop: 44,
            maxWidth: 900,
            fontFamily: "sans-serif",
          }}
        >
          One frozen agent, one fixed task shape, answers registered before any run: a
          behavioral rate per site, beside the Lighthouse category mean.
        </div>
      </div>
    ),
    { ...size }
  );
}
