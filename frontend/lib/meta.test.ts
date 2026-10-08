import { describe, expect, it } from "vitest";
import { profileMetadata } from "./meta";
import type { PlayerProfile } from "./types";

// A profile page is one of thousands of near-identical numeric pages; it must
// never ask to be indexed (the AdSense "low value content" verdict), while its
// title, canonical and sharing cards stay exactly as they were.
describe("profileMetadata", () => {
  const profile = {
    player: { steamId64: "76561198000000001", personaName: "Churro", avatarUrl: "https://a/b.jpg" },
    career: { matches: 12, rating: 1.1, kd: 1.3 },
  } as unknown as PlayerProfile;

  it("tells search engines not to index the page but still to follow its links", () => {
    expect(profileMetadata(profile).robots).toEqual({ index: false, follow: true });
  });

  it("keeps the title, canonical and sharing card", () => {
    const m = profileMetadata(profile);
    expect(m.title).toBe("Churro — CSRun");
    expect(m.alternates?.canonical).toBe("/profiles/76561198000000001");
    expect(m.openGraph?.images).toEqual(["https://a/b.jpg"]);
  });
});
