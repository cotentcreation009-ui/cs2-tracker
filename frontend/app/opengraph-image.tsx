import { ImageResponse } from "next/og";

// Social unfurl card for the site root + any page without its own OG image.
export const alt = "StatRun — every rank in one place";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#04060e",
          padding: "80px",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: "28px" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: 8,
              width: "84px",
              height: "84px",
              borderRadius: "18px",
              background: "linear-gradient(135deg, #38d6ff, #8a7dff)",
              paddingBottom: 18,
              marginRight: "24px",
            }}
          >
            <div style={{ width: 11, height: 22, borderRadius: 5, background: "#07131b" }} />
            <div style={{ width: 11, height: 36, borderRadius: 5, background: "#07131b" }} />
            <div style={{ width: 11, height: 50, borderRadius: 5, background: "#07131b" }} />
          </div>
          <div style={{ fontSize: "44px", fontWeight: 800 }}>StatRun</div>
        </div>
        <div style={{ display: "flex", fontSize: "76px", fontWeight: 800 }}>
          Every CS2 rank in one place.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "34px",
            color: "#9aa4b2",
            marginTop: "28px",
            maxWidth: "960px",
          }}
        >
          Premier, FACEIT, Leetify &amp; Steam stats for any player — from a
          single SteamID.
        </div>
      </div>
    ),
    size,
  );
}
