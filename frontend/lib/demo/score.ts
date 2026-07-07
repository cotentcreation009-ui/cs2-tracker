// Team-based scoring for a demo. A round's `winner` is a SIDE ("CT"/"T"), but
// the two teams SWAP sides at halftime (and again every overtime half), so
// counting rounds by side does NOT give the match score — e.g. a 13:11 game can
// look like 17:7 if one side was strong. These helpers map each round's winning
// side to the stable TEAM that held it, so the score is correct.
//
// CS scoring reference: a regulation game is won at 13 rounds (MR12). Overtime
// only happens from 12:12; OT teams also swap sides each OT half, and this team
// mapping stays correct through all of it because it re-checks each round's
// roster rather than assuming a fixed side.

import type { ReplayRound } from "./types";

/** Player indices that started the match on CT — "Team A" (the rest are Team B). */
export function teamAStarters(rounds: ReplayRound[]): Set<number> {
  return new Set(rounds[0]?.ct ?? []);
}

/**
 * Which team won a round: "A" (started CT) or "B" (started T), or null when the
 * round has no winner / teams can't be resolved. Re-checks the round's roster so
 * it's correct after every side swap.
 */
export function roundWinnerTeam(r: ReplayRound, teamA: Set<number>): "A" | "B" | null {
  if (r.winner !== "CT" && r.winner !== "T") return null;
  if (teamA.size === 0) return null;
  const aOnCT = (r.ct ?? []).some((i) => teamA.has(i));
  const aWon = aOnCT ? r.winner === "CT" : r.winner === "T";
  return aWon ? "A" : "B";
}

/**
 * Final score by TEAM (not by side): a = team that started CT, b = started T.
 * Falls back to a raw side count only when the starting roster is unknown.
 */
export function teamScore(rounds: ReplayRound[]): { a: number; b: number } {
  const teamA = teamAStarters(rounds);
  if (teamA.size === 0) {
    return {
      a: rounds.filter((r) => r.winner === "CT").length,
      b: rounds.filter((r) => r.winner === "T").length,
    };
  }
  let a = 0;
  let b = 0;
  for (const r of rounds) {
    const t = roundWinnerTeam(r, teamA);
    if (t === "A") a++;
    else if (t === "B") b++;
  }
  return { a, b };
}
