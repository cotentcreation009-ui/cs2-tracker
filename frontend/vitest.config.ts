import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal vitest setup for pure-logic unit tests (e.g. the CheatMeter
// calibration probes). Mirrors the tsconfig "@/*" → "./*" path alias.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    // .test.tsx: a component rendered to static markup with react-dom/server —
    // still node, no DOM; it pins what a row SAYS for a fixture, not layout.
    include: ["lib/**/*.test.ts", "components/**/*.test.{ts,tsx}", "app/**/*.test.ts"],
  },
});
