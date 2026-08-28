import { describe, it, expect } from "vitest";

// The allowlist in this proxy is easy to forget when adding a backend route:
// the backend can serve a panel perfectly and the site still 404s, because the
// client never reaches the backend directly. This pins the set.
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("player panel proxy", () => {
  const src = readFileSync(
    join(process.cwd(), "app/api/players/[steamid]/[panel]/route.ts"),
    "utf8",
  );

  it("allows every panel the app fetches", () => {
    for (const panel of ["faceit", "leetify", "steam-stats", "steam-extras", "bridge"]) {
      expect(src).toContain(`"${panel}"`);
    }
  });

  it("still rejects anything not named", () => {
    expect(src).toContain('return Response.json({ error: "unknown panel" }, { status: 404 })');
  });
});
