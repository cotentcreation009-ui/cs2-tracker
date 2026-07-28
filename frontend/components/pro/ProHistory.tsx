"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ProFormEntry, ProHistory, ProPrediction, ProRosterPlayer, ProTeam } from "./types";
import { TeamLogo } from "./TeamLogo";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerStatsDrawer } from "./PlayerStatsDrawer";
import { validHex } from "./format";

// Recent form + head-to-head, loaded lazily (after the live scoreboard) from
// /api/pro-matches/{id}/history so it never blocks the live data.
export function ProHistoryPanel({ id, teams }: { id: string; teams: ProTeam[] }) {
  const [data, setData] = useState<ProHistory | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/pro-matches/${id}/history`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const d = (await res.json()) as ProHistory;
        if (!alive) return;
        const anyForm = Object.values(d.form ?? {}).some((f) => f.length > 0);
        const anyH2H = (d.h2h ?? []).length > 0;
        const anyRoster = Object.values(d.rosters ?? {}).some((r) => r.length > 0);
        setData(d);
        setState(anyForm || anyH2H || anyRoster ? "ready" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <section className="space-y-3">
        <SectionTitle />
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="card h-40 animate-pulse bg-line/30" />
          ))}
        </div>
      </section>
    );
  }
  if (state !== "ready" || !data) return null; // empty/error → hide silently

  const a = teams[0];
  const b = teams[1];
  const h2h = data.h2h ?? [];
  const aWins = h2h.filter((m) => m.winnerId === a?.gridId).length;
  const bWins = h2h.filter((m) => m.winnerId === b?.gridId).length;

  return (
    <section className="space-y-3">
      <SectionTitle />

      {/* who's favored, and WHY — every factor's inputs are the same numbers
          shown in the cards below it */}
      {a && b && data.prediction && <PredictionCard pred={data.prediction} a={a} b={b} />}

      {/* lineups: who's on each team + their recent-series stats */}
      {(data.rosters?.[a?.gridId ?? ""]?.length || data.rosters?.[b?.gridId ?? ""]?.length) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[a, b].map((t) =>
            t ? <LineupCard key={t.gridId} team={t} players={data.rosters?.[t.gridId] ?? []} /> : null,
          )}
        </div>
      ) : null}

      {/* head-to-head */}
      {h2h.length > 0 && a && b ? (
        <div className="card-2 p-4">
          <div className="mb-3 flex items-center justify-center gap-4 text-sm">
            <span className="truncate font-bold" style={{ color: validHex(a.colorPrimary) ?? "var(--color-ink)" }}>
              {a.shortName || a.name}
            </span>
            <span className="shrink-0 text-xl font-extrabold tabular-nums">
              <span className={aWins >= bWins ? "text-ink" : "text-faint"}>{aWins}</span>
              <span className="mx-1 text-sm text-faint">–</span>
              <span className={bWins >= aWins ? "text-ink" : "text-faint"}>{bWins}</span>
            </span>
            <span className="truncate font-bold" style={{ color: validHex(b.colorPrimary) ?? "var(--color-ink)" }}>
              {b.shortName || b.name}
            </span>
          </div>
          <div className="mx-auto max-w-md space-y-1">
            {h2h.map((m) => {
              const as = m.scoreByTeam[a.gridId] ?? 0;
              const bs = m.scoreByTeam[b.gridId] ?? 0;
              return (
                <Link
                  key={m.seriesId}
                  href={`/pro-matches/${m.seriesId}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-xs transition hover:bg-panel/60"
                >
                  <span className="w-16 shrink-0 tabular-nums text-faint">{fmtDate(m.date)}</span>
                  <span className="flex flex-1 items-center justify-center gap-2 tabular-nums">
                    <span className={m.winnerId === a.gridId ? "font-bold text-ink" : "text-muted"}>{as}</span>
                    <span className="text-faint">–</span>
                    <span className={m.winnerId === b.gridId ? "font-bold text-ink" : "text-muted"}>{bs}</span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-faint">
                    {m.winnerId === a.gridId ? a.shortName : m.winnerId === b.gridId ? b.shortName : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[10px] text-faint">Recent meetings (last ~120 days)</p>
        </div>
      ) : null}

      {/* recent form per team */}
      <div className="grid gap-3 lg:grid-cols-2">
        {[a, b].map((t) =>
          t ? <FormCard key={t.gridId} team={t} entries={data.form?.[t.gridId] ?? []} /> : null,
        )}
      </div>
    </section>
  );
}

// HLTV-style lineup: a photo card per player (photo, name, K/D + maps),
// starters first; extra stand-ins and no-data roster players fold into chips.
// per-factor value formatting — the same numbers the evidence cards show
function fmtFactor(key: string, v: number): string {
  switch (key) {
    case "form":
      return `${(v * 100).toFixed(0)}%`;
    case "h2h":
      return `${v.toFixed(0)} win${v === 1 ? "" : "s"}`;
    case "margin":
      return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`; // avg map margin (unit in tooltip)
    case "lineup":
      return v.toFixed(2);
    default:
      return v.toFixed(2);
  }
}

// The verdict + its reasons. A transparent heuristic (labelled), never shown
// without the evidence: each factor row carries both teams' actual values, and
// the panels below are the receipts. Refuses thin data instead of guessing.
function PredictionCard({ pred, a, b }: { pred: ProPrediction; a: ProTeam; b: ProTeam }) {
  const aHex = validHex(a.colorPrimary) ?? "#5b9dff";
  const bHex = validHex(b.colorPrimary) ?? "#e7b53c";
  if (!pred.available) {
    return (
      <div className="card-2 px-4 py-2.5 text-center text-[11px] text-faint">
        No win estimate — {pred.reason ?? "insufficient data"} ({pred.seriesN[0]} vs {pred.seriesN[1]} finished
        series tracked).
      </div>
    );
  }
  const pa = Math.round(pred.pA * 100);
  const pb = 100 - pa;
  const favA = pred.pA >= 0.5;
  return (
    <div className="card-2 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="stat-label">Win estimate</span>
        <span className="text-[10px] text-faint" title={`model ${pred.model} — a hand-weighted read over the evidence below, not a trained model and not betting advice`}>
          heuristic · from {pred.seriesN[0]} + {pred.seriesN[1]} recent series
        </span>
      </div>
      {/* the verdict bar */}
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className={`truncate font-bold ${favA ? "" : "opacity-60"}`} style={{ color: aHex }}>
          {a.shortName || a.name}
        </span>
        <span className="shrink-0 text-lg font-extrabold tabular-nums">
          <span className={favA ? "text-ink" : "text-faint"}>{pa}%</span>
          <span className="mx-1.5 text-xs font-normal text-faint">vs</span>
          <span className={favA ? "text-faint" : "text-ink"}>{pb}%</span>
        </span>
        <span className={`truncate text-right font-bold ${favA ? "opacity-60" : ""}`} style={{ color: bHex }}>
          {b.shortName || b.name}
        </span>
      </div>
      <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-panel">
        <div className="h-full rounded-l-full transition-all" style={{ width: `${pa}%`, background: aHex, opacity: 0.85 }} />
        <div className="h-full rounded-r-full transition-all" style={{ width: `${pb}%`, background: bHex, opacity: 0.85 }} />
      </div>
      {/* the reasons — each row: who it favors and by how much, with values */}
      <div className="mx-auto max-w-xl space-y-1">
        {(pred.factors ?? []).map((f) => {
          const favors = f.contribution > 0.02 ? "a" : f.contribution < -0.02 ? "b" : null;
          return (
            <div key={f.key} className="flex items-center gap-2 text-xs" title={f.note}>
              <span
                className="w-13 shrink-0 truncate text-right tabular-nums"
                style={{ color: favors === "a" ? aHex : undefined, fontWeight: favors === "a" ? 700 : 400, opacity: favors === "a" ? 1 : 0.65 }}
              >
                {fmtFactor(f.key, f.a)}
              </span>
              <span className="w-28 shrink-0 text-center text-muted">{f.label}</span>
              <span
                className="w-13 shrink-0 truncate tabular-nums"
                style={{ color: favors === "b" ? bHex : undefined, fontWeight: favors === "b" ? 700 : 400, opacity: favors === "b" ? 1 : 0.65 }}
              >
                {fmtFactor(f.key, f.b)}
              </span>
              {/* pull strength toward the favored side */}
              <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    background: f.contribution >= 0 ? aHex : bHex,
                    opacity: 0.8,
                    left: f.contribution >= 0 ? `${50 - Math.min(50, Math.abs(f.contribution) * 55)}%` : "50%",
                    width: `${Math.min(50, Math.abs(f.contribution) * 55)}%`,
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] text-faint">
        every input is shown in the panels below · last ~120 days · estimate, not betting advice
      </p>
    </div>
  );
}

function LineupCard({ team, players }: { team: ProTeam; players: ProRosterPlayer[] }) {
  const hex = validHex(team.colorPrimary) ?? "#8a93a5";
  const kdColor = (v: number) => (v >= 1.1 ? "text-good" : v < 0.95 ? "text-bad" : "text-ink");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = players.find((p) => p.id && p.id === openId);
  // Always show a full 5-card lineup: stat-backed players first, then the
  // rest of the roster (silhouette + dash stats) so a thin-data team doesn't
  // read as "3v5". Whoever doesn't fit folds into the chips row.
  const ordered = [...players.filter((p) => p.src !== ""), ...players.filter((p) => p.src === "")];
  const cards = ordered.slice(0, 5);
  const extras = ordered.slice(5);
  return (
    <div className="card-2 overflow-hidden p-0">
      <Link href={`/pro-matches/team/${team.gridId}`} title="Team page — roster, stats & results" className="flex items-center gap-2.5 border-b px-4 py-3 transition hover:brightness-125" style={{ borderColor: `${hex}33`, background: `linear-gradient(90deg, ${hex}14, transparent)` }}>
        <TeamLogo name={team.shortName || team.name} src={team.logoUrl} color={team.colorPrimary} size={32} />
        <span className="truncate text-base font-bold text-ink">{team.shortName || team.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="rounded bg-panel/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-faint" title="Stats cover the maps GRID tracked over the last 3 months — not every event is covered at every tier">
            last 3 months
          </span>
          <span className="text-[10px] uppercase tracking-wider text-faint">Lineup →</span>
        </span>
      </Link>
      {cards.length > 0 ? (
        <div className="grid grid-cols-5 gap-2 p-3">
          {cards.map((p) => {
            const has = p.src !== "";
            const n = p.src === "grid" ? p.maps : p.series;
            const clickable = !!p.id;
            const isOpen = !!p.id && p.id === openId;
            return (
              <button
                key={p.nick}
                type="button"
                disabled={!clickable}
                onClick={() => setOpenId(isOpen ? null : (p.id ?? null))}
                title={clickable ? `${p.nick} — click for form over time` : undefined}
                className={`min-w-0 rounded-lg text-left transition ${clickable ? "cursor-pointer hover:-translate-y-0.5" : "cursor-default"} ${isOpen ? "ring-1" : ""}`}
                style={isOpen ? { boxShadow: `0 0 0 1px ${hex}66` } : undefined}
              >
                <PlayerAvatar nick={p.nick} hex={hex} shape="card" />
                <p className="mt-1.5 truncate text-center text-xs font-bold text-ink" title={p.nick}>
                  {p.nick}
                </p>
                <p className="text-center text-xs tabular-nums leading-tight">
                  {has ? (
                    <>
                      <span className={`font-bold ${kdColor(p.kd)}`}>{p.kd.toFixed(2)}</span>
                      <span className="text-faint"> K/D</span>
                    </>
                  ) : (
                    <span className="text-faint">— K/D</span>
                  )}
                </p>
                <p
                  className="truncate text-center text-[10px] tabular-nums leading-tight text-faint"
                  title={has ? `Across the ${n} maps GRID tracked for ${p.nick} in the last 3 months${p.src === "grid" && p.avgKills > 0 ? ` · ${p.avgKills.toFixed(1)} average kills per map` : ""}` : "No GRID-tracked matches in the last 3 months"}
                >
                  {has ? `${n} maps${p.src === "grid" && p.avgKills > 0 ? ` · ${p.avgKills.toFixed(1)} AK` : ""}` : "no data yet"}
                </p>
                {clickable ? (
                  <p className={`text-center text-[9px] leading-tight ${isOpen ? "" : "text-faint/70"}`} style={isOpen ? { color: hex } : undefined}>
                    {isOpen ? "▲ close" : "▾ more stats"}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-4 text-center text-[11px] text-faint">No tracked stats yet for this lineup.</p>
      )}
      {open?.id ? (
        <div className="border-t border-line/40 bg-panel/25">
          <PlayerStatsDrawer playerId={open.id} nick={open.nick} hex={hex} />
        </div>
      ) : null}
      {extras.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line/40 px-4 py-2">
          <span className="text-[9px] uppercase tracking-wider text-faint">Also on the roster</span>
          {extras.map((p) => (
            <span key={p.nick} className="rounded bg-panel px-1.5 py-0.5 text-[11px] font-medium text-muted" title={p.src === "" ? "No tracked matches in GRID's data yet" : `${p.kd.toFixed(2)} K/D over recent series`}>
              {p.nick}
            </span>
          ))}
        </div>
      ) : null}
      <p className="border-t border-line/40 px-4 py-1.5 text-[9px] leading-snug text-faint">
        Stats: official GRID aggregates over the last 3 months of tracked pro play — map counts reflect GRID&apos;s event coverage, not every match played · Photos: Liquipedia (CC BY-SA 3.0)
      </p>
    </div>
  );
}

function FormCard({ team, entries }: { team: ProTeam; entries: ProFormEntry[] }) {
  const hex = validHex(team.colorPrimary) ?? "#8a93a5";
  const wins = entries.filter((e) => e.won).length;
  return (
    <div className="card-2 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href={`/pro-matches/team/${team.gridId}`} title="Team page — roster, stats & results" className="flex min-w-0 items-center gap-2 hover:underline">
          <TeamLogo name={team.shortName || team.name} src={team.logoUrl} color={team.colorPrimary} size={22} />
          <span className="truncate text-sm font-bold text-ink">{team.shortName || team.name}</span>
        </Link>
        {entries.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex gap-0.5">
              {entries.map((e) => (
                <span
                  key={e.seriesId}
                  className={`grid h-4 w-4 place-items-center rounded text-[8px] font-bold ${e.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}
                  title={`${e.won ? "Won" : "Lost"} ${e.score[0]}–${e.score[1]} vs ${e.opponentName}`}
                >
                  {e.won ? "W" : "L"}
                </span>
              ))}
            </span>
            <span className="text-[11px] tabular-nums text-faint">
              {wins}–{entries.length - wins}
            </span>
          </div>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-faint">No recent results on record.</p>
      ) : (
        <div className="divide-y divide-line/40" style={{ borderColor: `${hex}22` }}>
          {entries.map((e) => (
            <Link
              key={e.seriesId}
              href={`/pro-matches/${e.seriesId}`}
              className="flex items-center gap-2 py-1.5 text-xs transition hover:bg-panel/50"
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[8px] font-bold ${e.won ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}
              >
                {e.won ? "W" : "L"}
              </span>
              <span className="w-14 shrink-0 tabular-nums text-faint">{fmtDate(e.date)}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="text-faint">vs</span>
                {e.opponentLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.opponentLogo} alt="" loading="lazy" className="h-3.5 w-3.5 shrink-0 rounded object-contain" />
                ) : null}
                <span className="truncate text-muted">{e.opponentName}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${e.won ? "text-good" : "text-bad"}`}>
                {e.score[0]}–{e.score[1]}
              </span>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-2 text-[9px] text-faint">Results from GRID-tracked events · last 120 days</p>
    </div>
  );
}

function SectionTitle() {
  return <h2 className="text-sm font-bold uppercase tracking-wider text-ink">Lineups, form &amp; head-to-head</h2>;
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
