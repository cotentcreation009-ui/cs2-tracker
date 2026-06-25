import { ImageResponse } from "next/og";

// Browser-tab favicon: the StatRun ascending-bars mark on the brand gradient.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 3,
          paddingBottom: 7,
          borderRadius: 7,
          background: "linear-gradient(135deg, #38d6ff, #8a7dff)",
        }}
      >
        <div style={{ width: 4, height: 8, borderRadius: 2, background: "#07131b" }} />
        <div style={{ width: 4, height: 13, borderRadius: 2, background: "#07131b" }} />
        <div style={{ width: 4, height: 18, borderRadius: 2, background: "#07131b" }} />
      </div>
    ),
    size,
  );
}
