import { ImageResponse } from "next/og";

// Browser-tab favicon: the brand "CS" gradient lockup from the header.
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
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          background: "linear-gradient(135deg, #5b9dff, #18d6b0)",
          color: "#0a0c12",
          fontSize: 19,
          fontWeight: 900,
          letterSpacing: -1,
        }}
      >
        CS
      </div>
    ),
    size,
  );
}
