import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Nothing in the component tree renders under vitest, so the homepage's two
// load-bearing promises are pinned at the source: it never asks Leetify for
// anything (the old featured strip was 2,076 Leetify requests a day — 37% of
// the site's Leetify traffic — for five hard-coded accounts), and the hero no
// longer clips the search dropdown.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const HOME_TREE = [
  "app/page.tsx",
  "components/FaceitTopPlayers.tsx",
  "components/FaceitTopPlayersTabs.tsx",
  "components/Leaderboard.tsx",
  "components/RecentlyViewed.tsx",
  "components/SectionHeading.tsx",
  "components/faceitTop.ts",
];

describe("homepage", () => {
  it("makes no Leetify or per-player profile request per render", () => {
    for (const file of HOME_TREE) {
      const src = read(file);
      for (const banned of [
        "getLeetify",
        "getLeetifyState",
        "getProfile",
        "FeaturedPlayers",
        "/leetify",
      ]) {
        expect(src, `${file} must not reference ${banned}`).not.toContain(banned);
      }
    }
    expect(existsSync(join(process.cwd(), "components/FeaturedPlayers.tsx"))).toBe(false);
  });

  it("lets the search dropdown overlay the page", () => {
    const page = read("app/page.tsx");
    const hero = page.match(/<section\s+className="([^"]*)"\s+style=\{\{ boxShadow/);
    expect(hero, "the hero section with the glow").not.toBeNull();
    expect(hero![1]).toContain("z-10");
    expect(hero![1]).not.toContain("overflow-hidden");
  });

  it("asks the board for a real floor", () => {
    const page = read("app/page.tsx");
    expect(page).toContain("BOARD_MIN_DEMOS = 5");
    expect(page).toContain("BOARD_WINDOW_DAYS = 90");
    expect(page).toContain("min: BOARD_MIN_DEMOS");
  });

  it("keeps the SEO surface the content layer depends on", () => {
    const page = read("app/page.tsx");
    expect(page).toContain('alternates: { canonical: "/" }');
    expect(page).toContain("faqSchema(siteUrl, \"/\", HOME_FAQ)");
    expect(page).toContain(
      "Treat it as a prompt to look closer — a starting point, not proof.",
    );
    expect(page).toContain("Check any Counter-Strike 2 player in seconds");
  });

  it("keeps the SearchBar's shared geometry (the header uses it too)", () => {
    const bar = read("components/SearchBar.tsx");
    expect(bar).toContain('className="relative w-full"');
    expect(bar).toContain("absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl");
    expect(bar).toContain("boxRef.current?.contains(e.relatedTarget as Node)");
    expect(bar).toContain("routeForQuery(value)");
  });
});
