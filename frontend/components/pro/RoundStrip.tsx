import type { ProRound, ProTeam } from "./types";
import { CT_HEX, T_HEX } from "./format";

// Round-by-round strip: one dot per finished round, coloured by the side that
// won it (CT blue / T gold). Hover shows the round number + winning team/side.
export function RoundStrip({
  rounds,
  teams,
  size = "sm",
}: {
  rounds?: ProRound[];
  teams?: ProTeam[];
  size?: "sm" | "md";
}) {
  const played = (rounds ?? []).filter((r) => r.finished || r.winnerSide);
  if (played.length === 0) return null;
  const dim = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  const nameOf = (id?: string) =>
    teams?.find((t) => t.gridId === id)?.shortName ??
    teams?.find((t) => t.gridId === id)?.name ??
    "";

  return (
    <div className="flex flex-wrap gap-1" aria-hidden>
      {played.map((r) => {
        const side = (r.winnerSide || "").toUpperCase();
        const bg = side === "CT" ? CT_HEX : side === "T" ? T_HEX : undefined;
        const who = nameOf(r.winnerTeam);
        return (
          <span
            key={r.number}
            style={bg ? { backgroundColor: bg } : undefined}
            className={`${dim} rounded-full ${bg ? "" : "bg-line2"}`}
            title={`Round ${r.number}${who ? ` · ${who}` : ""}${side ? ` (${side})` : ""}`}
          />
        );
      })}
    </div>
  );
}
