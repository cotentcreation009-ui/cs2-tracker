import { describe, expect, it } from "vitest";
import { rankEventGroups, ranksByGrid, type EventGroup } from "./eventRank";
import type { SpotlightTeam } from "./ProSpotlight";
import type { MatchState } from "./types";

const standings: SpotlightTeam[] = [
  { standing: 1, points: 2031, name: "Spirit", gridId: "spirit" },
  { standing: 2, points: 1900, name: "MOUZ", gridId: "mouz" },
  { standing: 7, points: 1200, name: "FURIA", gridId: "furia" },
  { standing: 19, points: 700, name: "B8", gridId: "b8" },
  { standing: 20, points: 650, name: "Nowhere" }, // no GRID id: cannot be matched to a series
];

function match(id: string, start: string, a: string, b: string, event: string): MatchState {
  return {
    seriesId: id,
    status: "upcoming",
    startScheduled: start,
    tournamentName: event,
    teams: [
      { gridId: a, name: a },
      { gridId: b, name: b },
    ],
  };
}

const groups: EventGroup[] = [
  {
    label: "CCT South America",
    items: [match("1", "2026-09-28T12:00:00Z", "fla", "dama", "CCT South America"), match("2", "2026-09-28T15:00:00Z", "quint", "pela", "CCT South America")],
  },
  {
    label: "ESL Pro League",
    items: [match("3", "2026-09-29T10:00:00Z", "mouz", "b8", "ESL Pro League"), match("4", "2026-09-29T13:00:00Z", "furia", "x", "ESL Pro League")],
  },
  {
    label: "IEM Cologne",
    items: [match("5", "2026-09-30T18:00:00Z", "spirit", "y", "IEM Cologne")],
  },
  {
    label: "Unscheduled cup",
    items: [{ seriesId: "6", status: "upcoming", tournamentName: "Unscheduled cup", teams: [{ gridId: "z", name: "z" }, { gridId: "w", name: "w" }] }],
  },
];

describe("ordering the schedule by who is playing", () => {
  it("puts the event with the best-placed team first, then the one with more top-20 teams, then the soonest", () => {
    const out = rankEventGroups(groups, standings, "top");
    expect(out.map((g) => g.label)).toEqual(["IEM Cologne", "ESL Pro League", "CCT South America", "Unscheduled cup"]);
    expect(out[0]!.best).toBe(1);
    expect(out[1]!.ranked.map((t) => `#${t.standing} ${t.name}`)).toEqual(["#2 mouz", "#7 furia", "#19 b8"]);
    expect(out[2]!.ranked).toEqual([]);
    expect(out[2]!.best).toBe(Infinity);
    expect(out[3]!.soonest).toBe(Infinity);
  });

  it("orders by start time when asked, with the unscheduled last", () => {
    const out = rankEventGroups(groups, standings, "soon");
    expect(out.map((g) => g.label)).toEqual(["CCT South America", "ESL Pro League", "IEM Cologne", "Unscheduled cup"]);
  });

  it("falls back to start order when there are no standings at all", () => {
    const out = rankEventGroups(groups, undefined, "top");
    expect(out.map((g) => g.label)).toEqual(["CCT South America", "ESL Pro League", "IEM Cologne", "Unscheduled cup"]);
    expect(out.every((g) => g.ranked.length === 0)).toBe(true);
  });

  it("keeps a group's matches and metadata, and lists each ranked team once", () => {
    const twice: EventGroup = {
      label: "Double",
      logo: "l.png",
      items: [match("7", "2026-10-01T10:00:00Z", "spirit", "q", "Double"), match("8", "2026-10-01T12:00:00Z", "spirit", "r", "Double")],
    };
    const [g] = rankEventGroups([twice], standings, "top");
    expect(g!.items.length).toBe(2);
    expect(g!.logo).toBe("l.png");
    expect(g!.ranked.length).toBe(1);
    expect(ranksByGrid(standings)).toEqual({ spirit: 1, mouz: 2, furia: 7, b8: 19 });
  });
});
