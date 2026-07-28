import { Fragment } from "react";
import type { ProRound, ProTeam } from "./types";
import { sideHex, teamBarColors } from "./format";

// Round-by-round strip — the story of a CS2 map. Each dot is one finished
// round, filled with the WINNING TEAM's colour and ringed with the side colour
// (CT blue / T gold); thin dividers mark halftime (after round 12), regulation
// end (24) and each MR3 overtime half so momentum swings read at a glance.
// Falls back to plain side-coloured dots when a team has no usable colour.
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
  const teamOf = (id?: string) => teams?.find((t) => t.gridId === id);
  // pairwise-resolved identity colors — same guarantee as the estimate bar,
  // so two near-identical brand ambers never render as one team
  const t1 = teams?.[0];
  const t2 = teams?.[1];
  const [h1, h2] = teamBarColors(t1?.colorPrimary, t2?.colorPrimary);
  const hexOf = (id?: string) =>
    id && id === t1?.gridId ? h1 : id && id === t2?.gridId ? h2 : null;

  // halftime after 12, regulation after 24, then every 3 rounds (MR3 OT halves)
  const isBreak = (n: number) => n === 12 || n === 24 || (n > 24 && (n - 24) % 3 === 0);

  return (
    <div className="flex flex-wrap items-center gap-1" role="img" aria-label={`Round history: ${played.length} rounds played`}>
      {played.map((r, i) => {
        const side = (r.winnerSide || "").toUpperCase();
        const sHex = sideHex(side);
        const team = teamOf(r.winnerTeam);
        const tHex = hexOf(r.winnerTeam);
        const fill = tHex ?? sHex ?? undefined;
        const who = team?.shortName ?? team?.name ?? "";
        return (
          <Fragment key={r.number}>
            <span
              style={fill ? { backgroundColor: fill, boxShadow: tHex && sHex ? `0 0 0 1px ${sHex}` : undefined } : undefined}
              className={`${dim} rounded-full ${fill ? "" : "bg-line2"}`}
              title={`Round ${r.number}${who ? ` · ${who}` : ""}${side ? ` (${side})` : ""}`}
            />
            {isBreak(r.number) && i < played.length - 1 ? (
              <span
                aria-hidden
                className={`${size === "md" ? "h-3" : "h-2.5"} w-px shrink-0 bg-line2/80`}
                title={r.number === 12 ? "Halftime" : r.number === 24 ? "Overtime" : "OT half"}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
