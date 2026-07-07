import { describe, it, expect } from "vitest";
import { teamScore, roundWinnerTeam, teamAStarters } from "./score";
import type { ReplayRound } from "./types";

// minimal round factory — the scorer only reads winner/ct/t
function rnd(n: number, winner: "CT" | "T" | "", ct: number[], t: number[]): ReplayRound {
  return { n, winner, ct, t } as unknown as ReplayRound;
}

describe("teamScore", () => {
  it("counts by TEAM across a halftime side swap, not by side", () => {
    const A = [0, 1, 2, 3, 4]; // start CT
    const B = [5, 6, 7, 8, 9]; // start T
    const rounds: ReplayRound[] = [];
    // first half (A=CT, B=T): A wins 9, B wins 3
    for (let i = 0; i < 9; i++) rounds.push(rnd(rounds.length + 1, "CT", A, B));
    for (let i = 0; i < 3; i++) rounds.push(rnd(rounds.length + 1, "T", A, B));
    // second half — sides swap (A=T, B=CT): A wins 4 (reaching 13), B wins 2
    for (let i = 0; i < 4; i++) rounds.push(rnd(rounds.length + 1, "T", B, A));
    for (let i = 0; i < 2; i++) rounds.push(rnd(rounds.length + 1, "CT", B, A));

    // team score is 13:5 — a regulation win at 13
    expect(teamScore(rounds)).toEqual({ a: 13, b: 5 });
    // the naive by-side count is the bug we're fixing — it would read 11:7
    expect(rounds.filter((r) => r.winner === "CT").length).toBe(11);
    expect(rounds.filter((r) => r.winner === "T").length).toBe(7);
  });

  it("maps each round's winning side to the team holding it", () => {
    const teamA = teamAStarters([rnd(1, "CT", [0, 1], [2, 3])]);
    // A on CT, CT won -> A
    expect(roundWinnerTeam(rnd(1, "CT", [0, 1], [2, 3]), teamA)).toBe("A");
    // sides swapped, T won -> A (A is now on T)
    expect(roundWinnerTeam(rnd(2, "T", [2, 3], [0, 1]), teamA)).toBe("A");
    // sides swapped, CT won -> B
    expect(roundWinnerTeam(rnd(3, "CT", [2, 3], [0, 1]), teamA)).toBe("B");
    // no winner -> null
    expect(roundWinnerTeam(rnd(4, "", [0, 1], [2, 3]), teamA)).toBeNull();
  });

  it("falls back to raw side counts when the starting roster is unknown", () => {
    expect(teamScore([rnd(1, "CT", [], []), rnd(2, "T", [], [])])).toEqual({ a: 1, b: 1 });
  });
});
