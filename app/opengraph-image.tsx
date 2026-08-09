import { ImageResponse } from "next/og";

// Static OG card — must never read the database (share crawlers hit it constantly and
// it should not assert any measurement, per the no-invented-numbers rule).

export const runtime = "edge";
export const alt = "AgentRank — behavioral agent-readiness scoring for websites";
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
          backgroundColor: "#0f172a",
          color: "#f8fafc",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "48px" }}>
          <div style={{ width: 28, height: 44, backgroundColor: "#0ea5e9", borderRadius: 6, opacity: 0.5 }} />
          <div style={{ width: 28, height: 68, backgroundColor: "#0ea5e9", borderRadius: 6, opacity: 0.75 }} />
          <div style={{ width: 28, height: 96, backgroundColor: "#0ea5e9", borderRadius: 6 }} />
        </div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: "-0.02em" }}>
          <span style={{ color: "#38bdf8" }}>Agent</span>
          <span>Rank</span>
        </div>
        <div style={{ fontSize: 40, color: "#94a3b8", marginTop: 20 }}>
          Is the web ready for agents?
        </div>
        <div style={{ fontSize: 26, color: "#64748b", marginTop: 44, maxWidth: 900 }}>
          A fixed browser agent, one task shape, pre-registered answers — behavioral
          agent-readiness scores for real websites, correlated with Lighthouse.
        </div>
      </div>
    ),
    { ...size }
  );
}
