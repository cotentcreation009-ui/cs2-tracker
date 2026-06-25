import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StatRun",
    short_name: "StatRun",
    description:
      "Look up any CS2 player: Leetify rating, FACEIT level, ranks and Steam identity.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c12",
    theme_color: "#0a0c12",
    icons: [{ src: "/icon", sizes: "32x32", type: "image/png" }],
  };
}
