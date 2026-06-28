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
  const nades = (round.nades ?? []).filter((n) => n.by === i).sort((a, b) => a.t - b.t);
  const shots = stat?.shots ?? 0;
  const wc = new Map<string, number>();
  for (const k of kills) wc.set(k.w, (wc.get(k.w) ?? 0) + 1);
  const topWeapon = [...wc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    name: meta.players[i]?.name ?? "?",
    steamId: meta.players[i]?.steamId ?? "",
    side,
    won: !!side && round.winner === side,
    buy: stat?.buy ?? null,
    equip: stat?.equip ?? 0,
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
  };
}

const BUY_LABEL: Record<string, string> = { full: "Full buy", force: "Force buy", eco: "Eco", pistol: "Pistol" };

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
  onClose,
}: {
  round: ReplayRound;
  meta: ReplayMeta;
  i: number;
  onClose: () => void;
}) {
  const d = computePlayerRound(round, meta, i);
  const col = d.side === "T" ? T : CT;
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

      {d.flashed > 0 && (
        <div className="mt-1.5 text-[11px] text-muted">
          Flashed <span className="text-ink">{d.flashed}</span> {d.flashed === 1 ? "enemy" : "enemies"} · {d.flashDur.toFixed(1)}s blind
        </div>
      )}

      {d.nades.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">Utility thrown</div>
          <div className="mt-0.5 space-y-0.5">
            {d.nades.map((n, k) => (
              <div key={k} className="flex items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[n.k] ?? "#8a7dff" }} />
                <span className="capitalize text-muted">{n.k}</span>
                <span className="ml-auto tabular-nums text-faint">{mmss(n.t)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-line pt-1.5 text-[10px] text-faint">
        Round {round.n} · {reasonLabel(round.reason, round.winner)} · click another dot or ✕ to close
      </div>
    </div>
  );
}
