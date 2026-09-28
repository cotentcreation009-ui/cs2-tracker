// Ordering the schedule's events by who is playing in them.
//
// The upcoming feed is mostly tier-3 qualifiers, because that is most of the
// calendar; listing events by their earliest match put a South American group
// stage above the Major. The ranking the site already trusts — Valve's
// Regional Standings, the spotlight's top 20 — says which events matter: an
// event is ranked by the best-placed team playing in it, then by how many
// top-20 teams it has, then by when it starts. Events with no ranked team
// follow, soonest first. Nothing is estimated: a team either is in the
// standings the backend serves or it is not.

import type { SpotlightTeam } from "./ProSpotlight";
import type { MatchState } from "./types";

export type EventGroup = { label: string; logo?: string; items: MatchState[] };

export type EventOrder = "top" | "soon";

export interface RankedTeam {
  gridId: string;
  name: string;
  standing: number;
  logoUrl?: string;
  color?: string;
}

export interface RankedEventGroup extends EventGroup {
  /** The top-20 teams playing in this event, best standing first. */
  ranked: RankedTeam[];
  /** The best standing among them; Infinity when none of the top 20 plays here. */
  best: number;
  /** Earliest scheduled start, ms since the epoch; Infinity when nothing is scheduled. */
  soonest: number;
}

function startMs(m: MatchState): number {
  const t = m.startScheduled ? Date.parse(m.startScheduled) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

/** Compares numbers that may both be Infinity without producing NaN. */
function cmp(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** gridId → standing, for the rank pills beside team names. */
export function ranksByGrid(standings?: SpotlightTeam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of standings ?? []) {
    if (t.gridId && t.standing > 0) out[t.gridId] = t.standing;
  }
  return out;
}

export function rankEventGroups(
  groups: EventGroup[],
  standings: SpotlightTeam[] | undefined,
  order: EventOrder,
): RankedEventGroup[] {
  const byGrid = new Map<string, SpotlightTeam>();
  for (const t of standings ?? []) {
    if (t.gridId && t.standing > 0) byGrid.set(t.gridId, t);
  }

  const ranked: RankedEventGroup[] = groups.map((g) => {
    const seen = new Map<string, RankedTeam>();
    let soonest = Infinity;
    for (const m of g.items) {
      soonest = Math.min(soonest, startMs(m));
      for (const t of m.teams ?? []) {
        const s = byGrid.get(t.gridId);
        if (!s || seen.has(t.gridId)) continue;
        seen.set(t.gridId, {
          gridId: t.gridId,
          name: t.shortName || t.name || s.name,
          standing: s.standing,
          logoUrl: t.logoUrl || s.logoUrl,
          color: t.colorPrimary || s.color,
        });
      }
    }
    const list = [...seen.values()].sort((a, b) => a.standing - b.standing);
    return { ...g, ranked: list, best: list[0]?.standing ?? Infinity, soonest };
  });

  const bySoon = (a: RankedEventGroup, b: RankedEventGroup) =>
    cmp(a.soonest, b.soonest) || a.label.localeCompare(b.label);
  if (order === "soon") return ranked.sort(bySoon);
  return ranked.sort(
    (a, b) => cmp(a.best, b.best) || b.ranked.length - a.ranked.length || bySoon(a, b),
  );
}
