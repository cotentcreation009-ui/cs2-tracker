"use client";

import Link from "next/link";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { weaponLabel } from "@/lib/demo/insights";
import { KIND_COLOR } from "@/components/demo/RadarMap";

const CT = "#5b9dff";
const T = "#e7b53c";
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.max(0, Math.round(t % 60))).padStart(2, "0")}`;

function reasonLabel(reason: string, winner: string): string {
  const k = (reason || "").toLowerCase();
  if (k.includes("defus")) return "Bomb defused";
  if (k.includes("bomb") || k.includes("detonat")) return "Bomb detonated";
  if (k.includes("time") || k.includes("saved") || k.includes("expir")) return "Time expired";
  if (k.includes("surrender")) return "Surrender";
  if (k.includes("elim") || k.includes("won") || k.includes("win") || k.includes("kill"))
    return `${winner === "CT" ? "CTs" : "Terrorists"} eliminated`;
  return reason ? reason.replace(/_/g, " ") : "Round ended";
}

// Everything a player did THIS round (distinct from career stats) for the
// click-to-select detail panel — used by both the replay and the routes view.
export function computePlayerRound(round: ReplayRound, meta: ReplayMeta, i: number) {
  const stat = (round.stats ?? []).find((s) => s.i === i);
  const side: "CT" | "T" | "" = round.ct?.includes(i) ? "CT" : round.t?.includes(i) ? "T" : "";
  const kills = (round.kills ?? []).filter((k) => k.k === i);
  const died = (round.kills ?? []).some((k) => k.v === i);
  // keep each nade's ORIGINAL index so the list can cross-highlight the map
  const nades = (round.nades ?? [])
    .map((n, ni) => ({ ...n, ni }))
    .filter((n) => n.by === i)
    .sort((a, b) => a.t - b.t);
  const shots = stat?.shots ?? 0;
  const wc = new Map<string, number>();
  for (const k of kills) wc.set(k.w, (wc.get(k.w) ?? 0) + 1);
  const topWeapon = [...wc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // damage dealt per opponent this round (even when they weren't killed)
  const dmgTo = Object.entries(stat?.dmgTo ?? {})
    .map(([vi, dmg]) => {
      const vIdx = Number(vi);
      return {
        i: vIdx,
        name: meta.players[vIdx]?.name ?? "?",
        dmg,
        killed: (round.kills ?? []).some((k) => k.k === i && k.v === vIdx),
      };
    })
    .sort((a, b) => b.dmg - a.dmg);
  return {
    name: meta.players[i]?.name ?? "?",
    steamId: meta.players[i]?.steamId ?? "",
    side,
    won: !!side && round.winner === side,
    buy: stat?.buy ?? null,
    equip: stat?.equip ?? 0,
    startMoney: stat?.startMoney ?? 0,
    money: stat?.money ?? 0,
    bought: stat?.bought ?? [],
    kills: kills.length,
    hs: kills.filter((k) => k.hs).length,
    alive: !died,
    dmg: stat?.dmg ?? 0,
    utilDmg: stat?.utilDmg ?? 0,
    shots,
    acc: shots ? Math.min(100, ((stat?.hits ?? 0) / shots) * 100) : null,
    hsAcc: shots ? Math.min(100, ((stat?.hsHits ?? 0) / shots) * 100) : null,
    reaction: stat?.aimN ? (stat.rctMs ?? 0) / stat.aimN : null,
    flashed: stat?.flashed ?? 0,
    flashDur: stat?.flashDur ?? 0,
    nades,
    topWeapon,
    dmgTo,
  };
}

const BUY_LABEL: Record<string, string> = { full: "Full buy", force: "Force buy", eco: "Eco", pistol: "Pistol" };

// Loss bonus the player's team is sitting on entering this round: $1400 + $500
// per consecutive loss (capped at $3400), reset at the half (side swap). Computed
// from round history, so it needs the full rounds array.
function lossInfo(rounds: ReplayRound[], round: ReplayRound, i: number): { streak: number; bonus: number } {
  const idx = rounds.indexOf(round);
  const mySide = round.ct?.includes(i) ? "CT" : round.t?.includes(i) ? "T" : null;
  let streak = 0;
  if (mySide && idx > 0) {
    for (let p = idx - 1; p >= 0; p--) {
      const rd = rounds[p];
      const side = rd.ct?.includes(i) ? "CT" : rd.t?.includes(i) ? "T" : null;
      if (side !== mySide) break; // crossed the half — loss bonus resets
      if (rd.winner === side) break; // won — streak ends
      streak++;
    }
  }
  return { streak, bonus: 1400 + 500 * Math.min(streak, 4) };
}

function RStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel/50 px-1 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-faint">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
      {sub ? <div className="text-[9px] text-faint">{sub}</div> : null}
    </div>
  );
}

export function PlayerRoundCard({
  round,
  meta,
  i,
  rounds,
  onClose,
  onUtilHover,
  onUtilPin,
  activeUtilId,
  zoneOf,
}: {
  round: ReplayRound;
  meta: ReplayMeta;
  i: number;
  rounds?: ReplayRound[];
  onClose: () => void;
  // optional map cross-link: hover/click a util row to highlight it on the map
  onUtilHover?: (nadeIndex: number | null) => void;
  onUtilPin?: (nadeIndex: number) => void;
  activeUtilId?: number | null;
  zoneOf?: (x: number, y: number) => string | null;
}) {
  const utilInteractive = !!onUtilHover || !!onUtilPin;
  const d = computePlayerRound(round, meta, i);
  const col = d.side === "T" ? T : CT;
  const loss = rounds ? lossInfo(rounds, round, i) : null;
  // dedupe the loadout into "item ×N"
  const buyCounts = new Map<string, number>();
  for (const w of d.bought) buyCounts.set(w, (buyCounts.get(w) ?? 0) + 1);
  const buyList = [...buyCounts.entries()].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w));
  return (
    <div className="card px-4 py-3" style={{ borderColor: `${col}55` }}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col }} />
        <span className="truncate text-sm font-bold">{d.name}</span>
        <span className="pill shrink-0" style={{ background: `${col}22`, color: col }}>
          {d.side || "—"}
        </span>
        {d.steamId && (
          <Link
            href={`/profiles/${d.steamId}`}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted transition hover:bg-panel/50 hover:text-ink"
          >
            Profile →
          </Link>
        )}
        <button type="button" onClick={onClose} className="ml-auto shrink-0 text-sm text-faint hover:text-ink" title="Close">
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`pill ${d.won ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
          {d.won ? "Won round" : "Lost round"}
        </span>
        <span className={`pill ${d.alive ? "bg-good/12 text-good" : "bg-panel text-faint"}`}>
          {d.alive ? "Survived" : "Died"}
        </span>
        {d.buy && (
          <span className="pill bg-panel text-muted">
            {BUY_LABEL[d.buy] ?? d.buy}
            {d.equip ? ` · $${d.equip}` : ""}
          </span>
        )}
      </div>

      <div className="mt-2 rounded-md border border-line bg-panel/40 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-faint">Buy</span>
          <span className="text-[11px] tabular-nums">
            {d.startMoney > 0 && (
              <>
                <span className="text-faint">${d.startMoney} start</span>
                <span className="text-faint"> · </span>
              </>
            )}
            <span className="text-muted">${d.money} left</span>
            {loss && (
              <>
                <span className="text-faint"> · loss bonus </span>
                <span className="font-semibold text-mid">${loss.bonus}</span>
              </>
            )}
          </span>
        </div>
        {buyList.length > 0 ? (
          <div className="mt-1 text-[11px] leading-snug text-ink">{buyList.join(", ")}</div>
        ) : (
          <div className="mt-1 text-[11px] text-faint">Saved — no buy</div>
        )}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        <RStat label="Kills" value={`${d.kills}`} sub={d.hs ? `${d.hs} hs` : undefined} />
        <RStat label="Damage" value={`${d.dmg}`} sub={d.utilDmg ? `${d.utilDmg} util` : undefined} />
        <RStat label="Accuracy" value={d.acc != null ? `${d.acc.toFixed(0)}%` : "—"} sub={d.shots ? `${d.shots} shots` : undefined} />
        <RStat label="Reaction" value={d.reaction != null ? `${d.reaction.toFixed(0)}ms` : "—"} />
      </div>

      {d.topWeapon && (
        <div className="mt-2 text-[11px] text-muted">
          Top weapon: <span className="text-ink">{weaponLabel(d.topWeapon)}</span>
        </div>
      )}

      {d.dmgTo.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">Damage dealt</div>
          <div className="mt-0.5 space-y-1">
            {d.dmgTo.map((x) => (
              <div key={x.i} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-20 shrink-0 truncate text-muted">{x.name}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.min(100, (x.dmg / Math.max(1, d.dmgTo[0].dmg)) * 100)}%`,
                      background: x.killed ? "#f5694a" : "#5b9dff",
                    }}
                  />
                </span>
                <span className="w-7 shrink-0 text-right font-semibold tabular-nums">{x.dmg}</span>
                {x.killed ? (
                  <span className="text-bad" title="killed this player">
                    ☠
                  </span>
                ) : (
                  <span className="w-[1ch]" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {d.flashed > 0 && (
        <div className="mt-1.5 text-[11px] text-muted">
          Flashed <span className="text-ink">{d.flashed}</span> {d.flashed === 1 ? "enemy" : "enemies"} · {d.flashDur.toFixed(1)}s blind
        </div>
      )}

      {d.nades.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">
            Utility thrown{utilInteractive && <span className="ml-1 normal-case text-faint">· hover to find on map</span>}
          </div>
          <div className="mt-0.5 space-y-0.5">
            {d.nades.map((n) => {
              const zone = zoneOf?.(n.x, n.y);
              const on = activeUtilId != null && activeUtilId === n.ni;
              const dmgEntries = n.dmg
                ? Object.entries(n.dmg)
                    .map(([v, dd]) => ({ name: meta.players[Number(v)]?.name ?? "?", dmg: dd }))
                    .sort((a, b) => b.dmg - a.dmg)
                : [];
              const dmgTotal = dmgEntries.reduce((s, x) => s + x.dmg, 0);
              const inner = (
                <span className="block w-full">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[n.k] ?? "#8a7dff" }} />
                    <span className="capitalize text-muted">{n.k}</span>
                    {zone && <span className="truncate text-faint">· {zone}</span>}
                    <span className="ml-auto shrink-0 tabular-nums text-faint">{mmss(n.t)}</span>
                  </span>
                  {dmgTotal > 0 && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-3 text-[10px]">
                      <span className="font-semibold text-bad">{dmgTotal} dmg</span>
                      <span className="text-faint">→ {dmgEntries.map((x) => `${x.name} ${x.dmg}`).join(", ")}</span>
                    </span>
                  )}
                </span>
              );
              return utilInteractive ? (
                <button
                  key={n.ni}
                  type="button"
                  onMouseEnter={() => onUtilHover?.(n.ni)}
                  onMouseLeave={() => onUtilHover?.(null)}
                  onClick={() => onUtilPin?.(n.ni)}
                  className={`block w-full rounded px-1 py-0.5 text-left text-[11px] transition ${
                    on ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-panel/60"
                  }`}
                >
                  {inner}
                </button>
              ) : (
                <div key={n.ni} className="block px-1 text-[11px]">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-line pt-1.5 text-[10px] text-faint">
        Round {round.n} · {reasonLabel(round.reason, round.winner)} · click another dot or ✕ to close
      </div>
    </div>
  );
}
