import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultRow } from "./ResultRow";
import type { MatchState } from "./types";

// The row rendered to static markup (react-dom/server, no DOM): what a
// finished series SAYS — the final score with the winner emphasised, the
// event, when it ended, the per-map line, the expander, the VOD pill and the
// link to the result page — pinned for one fixture.

const H = 3_600_000;
const NOW = Date.parse("2026-10-08T18:00:00Z");

const fixture: MatchState = {
  seriesId: "2846001",
  status: "finished",
  bestOf: 3,
  formatShort: "Bo3",
  tournamentName: "IEM Rio 2026",
  tournamentLogoUrl: "https://cdn.example/iem.png",
  teams: [
    { gridId: "t1", name: "Team Vitality", shortName: "Vitality", logoUrl: "https://cdn.example/vit.png", colorPrimary: "#f5c242" },
    { gridId: "t2", name: "FaZe Clan", shortName: "FaZe", logoUrl: "https://cdn.example/faze.png", colorPrimary: "#e4002b" },
  ],
  seriesScore: { t1: 2, t2: 1 },
  seriesWinner: "t1",
  liveUpdatedAt: new Date(NOW - 3 * H).toISOString(),
  streamUrl: "https://www.twitch.tv/search?term=IEM%20Rio%202026",
  maps: [
    { sequence: 1, mapName: "Ancient", started: true, finished: true, scoreByTeam: { t1: 13, t2: 11 }, winnerTeam: "t1" },
    { sequence: 2, mapName: "Anubis", started: true, finished: true, scoreByTeam: { t1: 9, t2: 13 }, winnerTeam: "t2" },
    { sequence: 3, mapName: "Dust2", started: true, finished: true, scoreByTeam: { t1: 16, t2: 14 }, winnerTeam: "t1" },
  ],
};

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("ResultRow", () => {
  const html = renderToStaticMarkup(<ResultRow match={fixture} now={NOW} onToggle={() => {}} />);
  const body = text(html);

  it("shows both teams, the final map score and who won", () => {
    expect(body).toContain("Vitality");
    expect(body).toContain("FaZe");
    expect(html).toContain('data-winner="a"');
    expect(body).toContain("Vitality won 2–1");
    // the winner's name and score are bold ink, the loser's dimmed
    expect(html).toMatch(/font-bold text-ink[^>]*>Vitality</);
    expect(html).toMatch(/font-medium text-faint[^>]*>FaZe</);
  });

  it("says when it finished, under which event, in what format", () => {
    expect(body).toContain("Finished 3h ago");
    expect(body).toContain("IEM Rio 2026");
    expect(body).toContain("Bo3");
  });

  it("lists every map's score and offers the expander", () => {
    expect(body).toContain("Ancient 13–11 · Anubis 9–13 · Dust2 16–14");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="result-details-2846001"');
    expect(body).toContain("Maps & scoreboard");
  });

  it("opens the per-map table when expanded", () => {
    const open = renderToStaticMarkup(<ResultRow match={fixture} now={NOW} expanded onToggle={() => {}} />);
    expect(open).toContain('id="result-details-2846001"');
    expect(open).toContain('aria-expanded="true"');
    expect(text(open)).toContain("Maps in this series");
  });

  it("links to the result page and the event's VODs", () => {
    expect(html).toContain('href="/pro-matches/2846001"');
    expect(html).toContain('aria-label="Vitality 2–1 FaZe — full result"');
    expect(html).toContain('href="https://www.twitch.tv/search?term=IEM%20Rio%202026"');
    expect(body).toContain("VOD");
    expect(body).not.toContain("Find stream");
  });

  it("has no footer at all when the feed has neither maps nor a stream", () => {
    const bare = renderToStaticMarkup(
      <ResultRow match={{ ...fixture, streamUrl: undefined, maps: undefined }} now={NOW} onToggle={() => {}} />,
    );
    expect(bare).not.toContain("twitch.tv");
    expect(bare).not.toContain("aria-expanded");
    expect(text(bare)).not.toContain("Maps & scoreboard");
    // the score, event and time still read as before
    expect(text(bare)).toContain("Vitality won 2–1");
    expect(text(bare)).toContain("Finished 3h ago");
  });
});
