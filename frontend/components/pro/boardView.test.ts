import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESULTS_WINDOW_HOURS,
  endedAgo,
  mapsLine,
  parseBoardView,
  seriesResult,
  sortFinished,
  withBoardView,
} from "./boardView";
import type { MatchState } from "./types";

const H = 3_600_000;
const NOW = Date.parse("2026-10-08T18:00:00Z");

const vitality = { gridId: "t1", name: "Team Vitality", shortName: "Vitality" };
const faze = { gridId: "t2", name: "FaZe Clan", shortName: "FaZe" };

function finished(id: string, endedHoursAgo: number, extra: Partial<MatchState> = {}): MatchState {
  return {
    seriesId: id,
    status: "finished",
    teams: [vitality, faze],
    seriesScore: { t1: 2, t2: 0 },
    seriesWinner: "t1",
    liveUpdatedAt: new Date(NOW - endedHoursAgo * H).toISOString(),
    ...extra,
  };
}

describe("the view in the URL", () => {
  it("is the board unless the query says results", () => {
    expect(parseBoardView("")).toBe("board");
    expect(parseBoardView("?")).toBe("board");
    expect(parseBoardView("?view=results")).toBe("results");
    expect(parseBoardView("view=results")).toBe("results");
    // a mistyped or unknown value never blanks the page
    expect(parseBoardView("?view=finished")).toBe("board");
    expect(parseBoardView("?view=")).toBe("board");
  });

  it("writes ?view=results and removes it again, keeping other parameters", () => {
    expect(withBoardView("", "results")).toBe("?view=results");
    expect(withBoardView("?view=results", "board")).toBe("");
    expect(withBoardView("?utm_source=x", "results")).toBe("?utm_source=x&view=results");
    expect(withBoardView("?utm_source=x&view=results", "board")).toBe("?utm_source=x");
  });

  it("round-trips", () => {
    for (const view of ["board", "results"] as const) {
      expect(parseBoardView(withBoardView("?a=1", view))).toBe(view);
    }
  });
});

describe("the results list", () => {
  it("keeps only finished series with both teams, newest first", () => {
    const matches: MatchState[] = [
      finished("old", 30),
      { seriesId: "live", status: "live", teams: [vitality, faze] },
      finished("new", 1),
      { seriesId: "up", status: "upcoming", teams: [vitality, faze] },
      // a forfeit with one team named has nothing to show
      finished("lonely", 2, { teams: [vitality] }),
      finished("mid", 12),
    ];
    expect(sortFinished(matches).map((m) => m.seriesId)).toEqual(["new", "mid", "old"]);
  });

  it("falls back to the scheduled start when the feed never stamped an update", () => {
    const m = finished("x", 0, {
      liveUpdatedAt: undefined,
      startScheduled: new Date(NOW - 5 * H).toISOString(),
    });
    expect(endedAgo(m, NOW)).toBe("5h ago");
    expect(sortFinished([finished("y", 1), m])[1].seriesId).toBe("x");
  });

  it("says how long ago a series ended in hours, then days", () => {
    expect(endedAgo(finished("a", 0.2), NOW)).toBe("just now");
    expect(endedAgo(finished("b", 0.7), NOW)).toBe("1h ago");
    expect(endedAgo(finished("c", 3), NOW)).toBe("3h ago");
    expect(endedAgo(finished("d", 23.4), NOW)).toBe("23h ago");
    expect(endedAgo(finished("e", 47), NOW)).toBe("2d ago");
    expect(endedAgo({ seriesId: "f", status: "finished" }, NOW)).toBe("");
  });
});

describe("the result of a series", () => {
  it("takes the feed's winner when it named one", () => {
    const r = seriesResult(finished("a", 1));
    expect(r.sa).toBe(2);
    expect(r.sb).toBe(0);
    expect(r.winner?.gridId).toBe("t1");
  });

  it("falls back to the map score, and to nobody for a tie", () => {
    const byScore = seriesResult(finished("b", 1, { seriesWinner: undefined, seriesScore: { t1: 1, t2: 2 } }));
    expect(byScore.winner?.gridId).toBe("t2");
    const tie = seriesResult(finished("c", 1, { seriesWinner: undefined, seriesScore: { t1: 1, t2: 1 } }));
    expect(tie.winner).toBeNull();
    const unscored = seriesResult(finished("d", 1, { seriesWinner: undefined, seriesScore: undefined }));
    expect(unscored.winner).toBeNull();
    expect(unscored.sa).toBe(0);
  });

  it("ignores a winner id that is neither team rather than crowning the wrong one", () => {
    const r = seriesResult(finished("e", 1, { seriesWinner: "t9", seriesScore: { t1: 0, t2: 2 } }));
    expect(r.winner?.gridId).toBe("t2");
  });

  it("lists the maps played with scores in the teams' order", () => {
    const m = finished("f", 1, {
      maps: [
        { sequence: 1, mapName: "Ancient", finished: true, scoreByTeam: { t1: 13, t2: 11 } },
        { sequence: 2, mapName: "Anubis", finished: true, scoreByTeam: { t1: 16, t2: 14 } },
        { sequence: 3, mapName: "Dust2" },
      ],
    });
    expect(mapsLine(m)).toBe("Ancient 13–11 · Anubis 16–14");
    expect(mapsLine(finished("g", 1))).toBe("");
  });
});

describe("the window the UI promises", () => {
  it("is the backend's prune window for finished series", () => {
    // backend/internal/grid/poller.go keeps a finished series until 48h after
    // Central last listed it; the heading and empty state say this number.
    const poller = readFileSync(join(process.cwd(), "..", "backend", "internal", "grid", "poller.go"), "utf8");
    expect(poller).toMatch(new RegExp(`case "finished":\\s*\\n\\s*if now\\.Sub\\(e\\.lastSeenCentral\\) > ${RESULTS_WINDOW_HOURS}\\*time\\.Hour`));
  });
});
