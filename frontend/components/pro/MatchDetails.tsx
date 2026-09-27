import type { MatchState, ProMap, ProMapTeam, ProTeam } from "./types";
import { liveMap, sideHex } from "./format";

// The inline expansion of a live card: every map of the series with its
// score, sides and state, then the scoreboard of the map in play (or the last
// one that has one) — each player's kills, assists, deaths and net worth, and
// each team's money. All of it is what the series feed already carries per
// map; nothing here is fetched or derived beyond sorting.

const money = (n?: number) => (n == null ? "" : `$${n.toLocaleString("en-US")}`);

export function MatchDetails({ match, id }: { match: MatchState; id: string }) {
  const a = match.teams?.[0];
  const b = match.teams?.[1];
  const maps = match.maps ?? [];
  const focus =
    liveMap(match) ??
    [...maps].reverse().find((m) => m.teams?.some((t) => t.players?.length));
  const boards = focus?.teams?.filter((t) => t.players?.length) ?? [];
  // Keep the card's left/right order on the scoreboards.
  const ordered = [a, b]
    .map((t) => boards.find((x) => x.gridId === t?.gridId))
    .filter((x): x is ProMapTeam => !!x);

  return (
    <div id={id} className="@container relative z-10 mt-2 space-y-3 border-t border-line/50 pt-2">
      <table className="w-full text-[11px]">
        <caption className="sr-only">Maps in this series</caption>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-faint">
            <th scope="col" className="pb-1 font-semibold">Map</th>
            <th scope="col" className="pb-1 text-right font-semibold">
              {a?.shortName || a?.name || "Team 1"}
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">
              {b?.shortName || b?.name || "Team 2"}
            </th>
            <th scope="col" className="pb-1 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {maps.map((m) => (
            <MapRow key={m.sequence} map={m} a={a} b={b} current={m === focus && !m.finished} />
          ))}
        </tbody>
      </table>

      {focus && ordered.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
            Scoreboard · {focus.mapName || `Map ${focus.sequence}`}
            {focus.finished ? " · final" : ""}
          </p>
          <div className="grid gap-2 @md:grid-cols-2">
            {ordered.map((t) => (
              <TeamBoard key={t.gridId} team={t} meta={t.gridId === a?.gridId ? a : b} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MapRow({
  map: m,
  a,
  b,
  current,
}: {
  map: ProMap;
  a?: ProTeam;
  b?: ProTeam;
  current: boolean;
}) {
  const sa = a ? (m.scoreByTeam?.[a.gridId] ?? 0) : 0;
  const sb = b ? (m.scoreByTeam?.[b.gridId] ?? 0) : 0;
  const live = !!m.started && !m.finished;
  const aSide = live && a ? sideHex(m.sideByTeam?.[a.gridId]) : null;
  const bSide = live && b ? sideHex(m.sideByTeam?.[b.gridId]) : null;
  const aWon = !!m.finished && (m.winnerTeam ? m.winnerTeam === a?.gridId : sa > sb);
  const bWon = !!m.finished && (m.winnerTeam ? m.winnerTeam === b?.gridId : sb > sa);
  const status = m.finished
    ? "Final"
    : m.started
      ? `Live${m.currentRound ? ` · Rd ${m.currentRound}` : ""}`
      : "Up next";

  return (
    <tr className={`border-t border-line/30 ${current ? "text-ink" : "text-muted"}`}>
      <td className="py-1 font-medium">{m.mapName || `Map ${m.sequence}`}</td>
      <td
        className={`py-1 text-right tabular-nums ${aWon ? "font-bold text-ink" : ""}`}
        style={aSide ? { color: aSide } : undefined}
      >
        {m.started ? sa : "–"}
      </td>
      <td
        className={`py-1 text-right tabular-nums ${bWon ? "font-bold text-ink" : ""}`}
        style={bSide ? { color: bSide } : undefined}
      >
        {m.started ? sb : "–"}
      </td>
      <td className="py-1 text-right text-[10px] text-faint">{status}</td>
    </tr>
  );
}

function TeamBoard({ team: t, meta }: { team: ProMapTeam; meta?: ProTeam }) {
  const side = sideHex(t.side);
  const players = [...(t.players ?? [])].sort(
    (x, y) => y.kills - x.kills || x.deaths - y.deaths,
  );
  const hasNet = players.some((p) => p.netWorth != null);
  const economy = [
    t.money != null ? `Money ${money(t.money)}` : "",
    t.netWorth != null ? `Net ${money(t.netWorth)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-line/50 bg-panel/40 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate font-bold text-ink">
          {meta?.shortName || meta?.name || "Team"}
          {t.side ? (
            <span className="ml-1.5 font-semibold" style={side ? { color: side } : undefined}>
              {t.side}
            </span>
          ) : null}
        </span>
        {economy ? <span className="shrink-0 tabular-nums text-faint">{economy}</span> : null}
      </div>
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-faint">
            <th scope="col" className="text-left font-semibold">Player</th>
            <th scope="col" className="w-7 text-right font-semibold">K</th>
            <th scope="col" className="w-7 text-right font-semibold">A</th>
            <th scope="col" className="w-7 text-right font-semibold">D</th>
            {hasNet ? (
              <th scope="col" className="w-14 text-right font-semibold">Net</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.name}>
              <td className="py-0.5 text-ink">{p.name}</td>
              <td className="text-right font-semibold text-ink">{p.kills}</td>
              <td className="text-right text-muted">{p.assists}</td>
              <td className="text-right text-muted">{p.deaths}</td>
              {hasNet ? <td className="text-right text-muted">{money(p.netWorth)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
