"use client";

import { useEffect, useRef } from "react";
import type { MatchState, ProMap, ProTeam } from "./types";
import { PointPill } from "./PointPill";
import { clockLabel, sideHex, teamBarColors } from "./format";

// HLTV-style game log, built from data we actually have on GRID Open Access:
// a round-by-round timeline derived from the polled round list (winner, side,
// running score, halftime/OT breaks) with a live header (round, clock, team
// banks) — honest about its 10s granularity, no fabricated kill feed. Rounds
// that finish while the page is open get annotated with per-player kill
// deltas diffed between polls ("nacho 3K") — best-effort, labelled as such.
export function GameLog({ match }: { match: MatchState }) {
  const teams = match.teams ?? [];
  const t1 = teams[0];
  const t2 = teams[1];
  const [h1, h2] = teamBarColors(t1?.colorPrimary, t2?.colorPrimary);
  const hexOf = (id?: string) => (id && id === t1?.gridId ? h1 : id && id === t2?.gridId ? h2 : null);
  const nameOf = (id?: string) => {
    const t = teams.find((x) => x.gridId === id);
    return t?.shortName || t?.name || "";
  };

  // per-round kill annotations for rounds observed live: snapshot each
  // player's kills at every poll; when a round flips to finished, credit the
  // delta since the previous flip. Session-local by design (a page load
  // mid-map can't reconstruct past rounds' kills from cumulative totals).
  const killSnap = useRef<Map<string, number>>(new Map());
  const roundNotes = useRef<Map<string, string>>(new Map());
  const seenRounds = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    const maps = match.maps ?? [];
    const finishedKeys: string[] = [];
    for (const mp of maps) {
      for (const r of mp.rounds ?? []) {
        if (r.finished || r.winnerSide) finishedKeys.push(`${mp.sequence}:${r.number}`);
      }
    }
    const snapNow = new Map<string, number>();
    for (const mp of maps) {
      for (const mt of mp.teams ?? []) {
        for (const p of mt.players ?? []) snapNow.set(`${mp.sequence}:${p.name}`, p.kills);
      }
    }
    if (!primed.current) {
      // first poll: everything already finished predates the visit — no notes
      primed.current = true;
      finishedKeys.forEach((k) => seenRounds.current.add(k));
      killSnap.current = snapNow;
      return;
    }
    const fresh = finishedKeys.filter((k) => !seenRounds.current.has(k));
    if (fresh.length > 0) {
      // credit kill deltas to the newest fresh round (10s polling can't split
      // multi-round windows — rare; the note is best-effort color, not stats)
      const target = fresh[fresh.length - 1];
      const mapSeq = Number(target.split(":")[0]);
      const parts: string[] = [];
      for (const [key, k] of snapNow) {
        const [seq, name] = [Number(key.split(":")[0]), key.slice(key.indexOf(":") + 1)];
        if (seq !== mapSeq) continue;
        const prev = killSnap.current.get(key) ?? k;
        const d = k - prev;
        if (d >= 2) parts.push(`${name} ${d}K`);
      }
      if (parts.length > 0) roundNotes.current.set(target, parts.sort().join(" · "));
      fresh.forEach((k) => seenRounds.current.add(k));
    }
    killSnap.current = snapNow;
  }, [match]);

  const maps = [...(match.maps ?? [])]
    .filter((mp) => mp.started || (mp.rounds?.length ?? 0) > 0)
    .sort((x, y) => y.sequence - x.sequence); // newest map first

  if (maps.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink">Game log</h2>
        <span className="text-[10px] text-faint" title="Built from the live feed we poll every ~10 seconds — round results are exact; in-round detail at this granularity isn't possible on our data plan">
          round-by-round · updates every ~10s
        </span>
      </div>
      <div className="space-y-3">
        {maps.map((mp) => (
          <MapLog
            key={mp.sequence}
            map={mp}
            match={match}
            hexOf={hexOf}
            nameOf={nameOf}
            notes={roundNotes.current}
            teams={teams}
          />
        ))}
      </div>
    </section>
  );
}

function MapLog({
  map: mp,
  match,
  hexOf,
  nameOf,
  notes,
  teams,
}: {
  map: ProMap;
  match: MatchState;
  hexOf: (id?: string) => string | null;
  nameOf: (id?: string) => string;
  notes: Map<string, string>;
  teams: ProTeam[];
}) {
  const isLive = mp.started && !mp.finished;
  const rounds = [...(mp.rounds ?? [])]
    .filter((r) => r.finished || r.winnerSide)
    .sort((x, y) => x.number - y.number);

  // running score per round, in board order (team[0]–team[1])
  const id1 = teams[0]?.gridId;
  const id2 = teams[1]?.gridId;
  let s1 = 0;
  let s2 = 0;
  const rows = rounds.map((r) => {
    if (r.winnerTeam === id1) s1++;
    else if (r.winnerTeam === id2) s2++;
    return { r, s1, s2 };
  });

  const clock = clockLabel(mp.clockSeconds);

  return (
    <div className={`card overflow-hidden p-4 ${isLive ? "border-[#ff4655]/30" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-panel text-[11px] font-bold tabular-nums text-muted">
            {mp.sequence}
          </span>
          <span className="truncate text-sm font-semibold text-ink">{mp.mapName || "Live map"}</span>
          {!isLive ? <span className="text-[10px] uppercase tracking-wider text-faint">final</span> : null}
        </span>
        {isLive ? (
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <PointPill match={match} map={mp} />
            <span className="text-[11px] tabular-nums text-muted">
              Round {mp.currentRound ?? rounds.length + 1}
              {clock ? ` · ${clock}` : ""} in progress
            </span>
          </span>
        ) : null}
      </div>

      {/* live economy: each team's bank + equipment value, straight from the feed */}
      {isLive && (mp.teams ?? []).some((t) => (t.money ?? 0) > 0 || (t.netWorth ?? 0) > 0) ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {[teams[0], teams[1]].map((t) => {
            const mt = mp.teams?.find((x) => x.gridId === t?.gridId);
            if (!t || !mt) return <span key={t?.gridId ?? Math.random()} />;
            const hex = hexOf(t.gridId) ?? undefined;
            return (
              <div key={t.gridId} className="flex items-center justify-between gap-2 rounded-lg border border-line/50 bg-panel/40 px-2.5 py-1.5 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
                  <span className="truncate font-semibold text-ink">{t.shortName || t.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted" title="Team bank (spendable cash) · total net worth including equipment">
                  {(mt.money ?? 0) > 0 ? <>bank <span className="font-semibold text-ink">${fmtK(mt.money!)}</span></> : null}
                  {(mt.money ?? 0) > 0 && (mt.netWorth ?? 0) > 0 ? " · " : null}
                  {(mt.netWorth ?? 0) > 0 ? <>worth ${fmtK(mt.netWorth!)}</> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 space-y-0.5">
          {[...rows].reverse().map(({ r, s1, s2 }, i, arr) => {
            const hex = hexOf(r.winnerTeam);
            const side = (r.winnerSide || "").toUpperCase();
            const note = notes.get(`${mp.sequence}:${r.number}`);
            const showBreak = isBreakAfter(r.number) && i < arr.length - 1;
            return (
              <div key={r.number}>
                <div className="flex items-center gap-2.5 rounded-md px-2 py-1 text-xs transition hover:bg-panel/50">
                  <span className="w-8 shrink-0 tabular-nums text-faint">R{r.number}</span>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={hex ? { background: hex, boxShadow: sideHex(side) ? `0 0 0 1px ${sideHex(side)}` : undefined } : undefined} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-ink">{nameOf(r.winnerTeam) || (side ? `${side} side` : "—")}</span>
                    <span className="text-muted"> win{side ? ` (${side})` : ""}</span>
                    {note ? <span className="text-faint"> · {note}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {s1}–{s2}
                  </span>
                </div>
                {showBreak ? (
                  <div className="my-1.5 flex items-center gap-2 px-2" aria-hidden>
                    <span className="h-px flex-1 bg-line/60" />
                    <span className="text-[9px] uppercase tracking-wider text-faint">{breakLabel(r.number)}</span>
                    <span className="h-px flex-1 bg-line/60" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-faint">Round results appear here as they finish.</p>
      )}
    </div>
  );
}

// break AFTER round n (log renders newest-first, so the divider sits below
// the first round of the next period): halftime after 12, regulation after
// 24, then each MR3 OT half
function isBreakAfter(n: number): boolean {
  return n === 12 || n === 24 || (n > 24 && (n - 24) % 3 === 0);
}

function breakLabel(n: number): string {
  if (n === 12) return "halftime";
  if (n === 24) return "overtime";
  return "ot half";
}

function fmtK(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
}
