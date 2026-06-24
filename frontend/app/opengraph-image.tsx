import { ImageResponse } from "next/og";

// Social unfurl card for the site root + any page without its own OG image.
export const alt = "CS2 Tracker — every rank in one place";
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
          backgroundColor: "#0a0c12",
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
              alignItems: "center",
              justifyContent: "center",
              width: "84px",
              height: "84px",
              borderRadius: "18px",
              background: "linear-gradient(135deg, #5b9dff, #18d6b0)",
              color: "#0a0c12",
              fontSize: "44px",
              fontWeight: 900,
              marginRight: "24px",
            }}
          >
            CS
          </div>
          <div style={{ fontSize: "44px", fontWeight: 800 }}>CS2 Tracker</div>
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
