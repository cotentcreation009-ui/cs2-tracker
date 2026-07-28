import type { MatchState, ProMap } from "./types";
import { pointState } from "./format";

// "MAP POINT — SPARTA" / "MATCH POINT — SPARTA" urgency pill for a live map:
// the leader is one round from taking the map (or the whole series). Shown on
// the board card and the detail page's live map row.
export function PointPill({ match, map }: { match: MatchState; map?: ProMap }) {
  const pt = pointState(match, map);
  if (!pt) return null;
  const team = match.teams?.find((t) => t.gridId === pt.teamId);
  const name = team?.shortName || team?.name || "";
  const label = pt.kind === "match" ? "Match point" : "Map point";
  return (
    <span
      className="pill animate-pulse border-[#ff4655]/50 bg-[#ff4655]/12 text-[10px] font-bold uppercase tracking-wider text-[#ff8891] motion-reduce:animate-none"
      title={
        pt.kind === "match"
          ? `${name || "The leader"} is one round from winning the series`
          : `${name || "The leader"} is one round from taking this map`
      }
    >
      {label}
      {name ? ` — ${name}` : ""}
    </span>
  );
}
