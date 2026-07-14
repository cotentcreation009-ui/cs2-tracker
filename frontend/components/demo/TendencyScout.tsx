"use client";

// Tendencies — the counter-intelligence lens. Pick an opponent and get a
// scouting dossier built from this demo: WHERE they set up (radar positions by
// side + round phase, with named-callout percentages), HOW they play (role,
// space/lurk meters, duels, timing, economy) and — the point of it all — a
// synthesized "How to counter" playbook. Expands lib/demo/tendencies.ts from a
// text block into a full lens.

import { useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, weaponLabel, type PlayerInsight } from "@/lib/demo/insights";
import { computeTendencies, playstyleSummary, type PlayerTendencies } from "@/lib/demo/tendencies";
import { buildProjection } from "@/lib/demo/projection";
import { getActiveZones, classifyPosition } from "@/lib/maps/zones";
import { radarImage } from "@/lib/maps/calibration";
import type { DemoView } from "@/components/demo/MatchToolbar";

const CT = "#5b9dff";
const T = "#e7b53c";
const CT_SOFT = "#9cc1ff";
const T_SOFT = "#f0cd78";
const UNIT_TO_M = 0.01905;
const SNIPER_RE = /awp|ssg|scar-?20|g3sg1/i;

const sideHex = (s: "CT" | "T" | "") => (s === "T" ? T : CT);
const sideSoft = (s: "CT" | "T" | "") => (s === "T" ? T_SOFT : CT_SOFT);

// One-word role, same heuristics the Insights cards use.
function roleOf(p: PlayerInsight, t?: PlayerTendencies): string {
  if (SNIPER_RE.test(p.favoriteWeapons?.[0]?.weapon ?? "")) return "AWPer";
  if (t && t.rounds >= 5) {
    if (t.lurkPct >= 75) return "Lurker";
    if (p.openingAttempts >= 4 && t.spacePct <= 30) return "Entry";
    if (t.zoneSamples >= 12 && t.rotationsPerRound <= 0.5) return "Anchor";
    if (t.spacePct >= 70) return "Support";
  }
  if (p.openingAttempts >= 5 && p.openingWinPct >= 55) return "Entry";
  return "Rifler";
}

type Phase = "opening" | "full";
type SideView = "both" | "CT" | "T";

interface ScoutData {
  // radar-space position samples for the phase/side filters
  pts: { x: number; y: number; side: "CT" | "T"; opening: boolean }[];
  deaths: { x: number; y: number; side: "CT" | "T" }[];
  // top named callouts per side (opening window)
  zonesCT: { name: string; pct: number }[];
  zonesT: { name: string; pct: number }[];
  calibrated: boolean;
  avgKillDist: number | null; // meters
  avgDeathDist: number | null;
  // kills/deaths by round phase (post-freeze thirds: 0-25s / 25-55s / 55s+)
  killTiming: [number, number, number];
  deathTiming: [number, number, number];
}

const OPENING_WINDOW = 20; // seconds after freeze that define "opening setup"

function computeScout(meta: ReplayMeta, rounds: ReplayRound[], idx: number): ScoutData {
  const proj = buildProjection(meta.map, rounds);
  const zones = getActiveZones(meta.map);
  const pts: ScoutData["pts"] = [];
  const deaths: ScoutData["deaths"] = [];
  const zoneCount = { CT: new Map<string, number>(), T: new Map<string, number>() };
  const zoneN = { CT: 0, T: 0 };
  let killDistSum = 0, killDistN = 0, deathDistSum = 0, deathDistN = 0;
  const killTiming: [number, number, number] = [0, 0, 0];
  const deathTiming: [number, number, number] = [0, 0, 0];

  for (const rd of rounds) {
    const freeze = rd.freezeEnd ?? 15;
    const side: "CT" | "T" | "" = rd.ct?.includes(idx) ? "CT" : rd.t?.includes(idx) ? "T" : "";
    if (!side) continue;

    for (const f of rd.frames ?? []) {
      if (f.t < freeze) continue;
      const p = f.p.find((pp) => pp.i === idx && pp.h > 0);
      if (!p) continue;
      const r = proj.project(p.x, p.y);
      if (!r) continue;
      const opening = f.t <= freeze + OPENING_WINDOW;
      pts.push({ x: r.x * 100, y: r.y * 100, side, opening });
      if (opening && proj.calibrated) {
        const z = classifyPosition(meta.map, p.x, p.y, zones);
        if (z?.name) {
          zoneCount[side].set(z.name, (zoneCount[side].get(z.name) ?? 0) + 1);
          zoneN[side]++;
        }
      }
    }

    const bucket = (t: number) => (t < freeze + 25 ? 0 : t < freeze + 55 ? 1 : 2);
    for (const k of rd.kills ?? []) {
      const d = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
      if (k.k === idx) {
        killTiming[bucket(k.t)]++;
        killDistSum += d;
        killDistN++;
      }
      if (k.v === idx) {
        deathTiming[bucket(k.t)]++;
        deathDistSum += d;
        deathDistN++;
        const r = proj.project(k.vx, k.vy);
        if (r) deaths.push({ x: r.x * 100, y: r.y * 100, side });
      }
    }
  }

  const tops = (side: "CT" | "T") =>
    [...zoneCount[side].entries()]
      .map(([name, n]) => ({ name, pct: zoneN[side] ? (n / zoneN[side]) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3);

  return {
    pts,
    deaths,
    zonesCT: tops("CT"),
    zonesT: tops("T"),
    calibrated: proj.calibrated,
    avgKillDist: killDistN ? killDistSum / killDistN : null,
    avgDeathDist: deathDistN ? deathDistSum / deathDistN : null,
    killTiming,
    deathTiming,
  };
}

// The playbook: actionable counters synthesized from every read we have.
function counterPlan(p: PlayerInsight, t: PlayerTendencies | undefined, s: ScoutData): string[] {
  const out: string[] = [];
  const zoneTip = (side: "CT" | "T", z: { name: string; pct: number }[]) => {
    if (z[0] && z[0].pct >= 50) out.push(`On their ${side} side, pre-aim ${z[0].name} — they set up there ${z[0].pct.toFixed(0)}% of rounds.`);
  };
  zoneTip("CT", s.zonesCT);
  zoneTip("T", s.zonesT);

  if (t && t.rounds >= 5) {
    if (t.spacePct <= 25) out.push("First through the door — hold close angles and set up instant trades; don't give free entries.");
    if (t.lurkPct >= 75) out.push("Lurker — clear flanks before committing late-round; never rotate everyone off their side.");
    if (t.zoneSamples >= 12 && t.rotationsPerRound >= 1.6) out.push("Heavy roamer — mid-round info (one spot check) tells you where the rest of the team isn't.");
  }
  if (p.openingAttempts >= 4 && p.openingWinPct >= 60) {
    out.push(`Wins ${p.openingWinPct.toFixed(0)}% of first duels — never peek them dry; flash first or refuse the opening fight.`);
  } else if (p.openingAttempts >= 4 && p.openingWinPct <= 35) {
    out.push(`Loses ${(100 - p.openingWinPct).toFixed(0)}% of first duels — hunt the opening pick against them.`);
  }
  if (SNIPER_RE.test(p.favoriteWeapons?.[0]?.weapon ?? "")) {
    out.push("AWPer — force close-range fights: smoke their angle, hit unscoped timings, and repeek wide with a flash.");
  } else if (s.avgKillDist != null && s.avgKillDist >= 22) {
    out.push(`Fights long ranges (~${s.avgKillDist.toFixed(0)}m avg kill) — close the distance with smokes before engaging.`);
  } else if (s.avgKillDist != null && s.avgKillDist <= 9 && p.kills >= 5) {
    out.push(`Close-range killer (~${s.avgKillDist.toFixed(0)}m avg) — keep them at distance and deny close positions with molotovs.`);
  }
  const nb = p.buys.eco + p.buys.semi + p.buys.force + p.buys.full;
  if (nb >= 5 && p.buys.force / nb >= 0.3) out.push("Force-buys often after losses — expect upgraded pistols/SMGs on their 'save' rounds; don't over-push their ecos.");
  const dt = s.deathTiming[0] + s.deathTiming[1] + s.deathTiming[2];
  if (dt >= 5 && s.deathTiming[0] / dt >= 0.6) out.push("Dies early most rounds — over-aggressive; punish with pre-placed crossfires on their usual first steps.");
  if (p.clutchTotal >= 3 && p.clutchWon / p.clutchTotal >= 0.5) out.push(`Dangerous in clutches (${p.clutchWon}/${p.clutchTotal} won) — play the bomb/time, don't peek them 1vX.`);
  if (p.enemiesFlashed >= 8) out.push("Heavy flash usage — turn away on their utility timings and punish the follow-up peek.");

  if (!out.length) out.push("No strong reads this demo — they play standard; win on fundamentals and utility.");
  return out;
}

function Meter({ label, pct, leftWord, rightWord }: { label: string; pct: number; leftWord: string; rightWord: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="uppercase tracking-wider text-faint">{label}</span>
        <span className="tabular-nums text-muted">{pct}th pctile</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-panel">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
          style={{ left: `${pct}%`, background: "var(--color-brand)" }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-faint">
        <span>{leftWord}</span>
        <span>{rightWord}</span>
      </div>
    </div>
  );
}

function TimingBars({ label, data, hex }: { label: string; data: [number, number, number]; hex: string }) {
  const max = Math.max(1, ...data);
  const cats = ["early", "mid", "late"];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
      <div className="mt-1 flex items-end gap-1.5">
        {data.map((v, i) => (
          <div key={i} className="flex-1 text-center">
            <div className="mx-auto flex h-10 w-full items-end rounded-sm bg-panel">
              <div className="w-full rounded-sm" style={{ height: `${(v / max) * 100}%`, background: hex, opacity: 0.85 }} />
            </div>
            <div className="mt-0.5 text-[9px] tabular-nums text-faint">
              {cats[i]} · {v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TendencyScout({ meta, rounds, view }: { meta: ReplayMeta; rounds: ReplayRound[]; view: DemoView }) {
  const scopedRounds = useMemo(
    () => (view.scopeRound != null && rounds[view.scopeRound] ? [rounds[view.scopeRound]] : rounds),
    [rounds, view.scopeRound],
  );
  const insights = useMemo(() => computeInsights(meta, scopedRounds), [meta, scopedRounds]);
  const tendencies = useMemo(() => computeTendencies(meta, scopedRounds), [meta, scopedRounds]);

  const focus = view.focusPlayer;
  const [phase, setPhase] = useState<Phase>("opening");
  const [sideView, setSideView] = useState<SideView>("both");

  const player = focus != null ? insights.players.find((p) => p.i === focus) ?? null : null;
  const tend = player ? tendencies.get(player.steamId) : undefined;
  const scout = useMemo(
    () => (focus != null ? computeScout(meta, scopedRounds, focus) : null),
    [meta, scopedRounds, focus],
  );

  // ---------- picker (no player selected) ----------
  if (player == null || scout == null) {
    const byTeam = (team: "CT" | "T") => insights.players.filter((p) => p.team === team);
    const card = (p: PlayerInsight) => {
      const t = tendencies.get(p.steamId);
      const lines = playstyleSummary(p, t);
      return (
        <button
          key={p.i}
          type="button"
          onClick={() => view.setFocusPlayer(p.i)}
          className="card lift flex flex-col gap-1.5 px-4 py-3 text-left transition hover:border-brand/40"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sideHex(p.team) }} />
            <span className="truncate text-sm font-bold">{p.name}</span>
            <span className="pill ml-auto shrink-0 bg-panel text-[10px] text-muted">{roleOf(p, t)}</span>
          </div>
          <div className="line-clamp-2 text-[11px] leading-snug text-muted">
            {lines[0] ?? "No strong reads yet — open the profile for the full breakdown."}
          </div>
          <div className="mt-auto flex items-center justify-between text-[10px] text-faint">
            <span>
              {p.kills}K / {p.deaths}D
              {p.openingAttempts >= 3 ? ` · wins ${p.openingWinPct.toFixed(0)}% of openings` : ""}
            </span>
            <span className="font-semibold text-brand">Scout →</span>
          </div>
        </button>
      );
    };
    return (
      <section className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0">
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          <h2 className="text-lg font-extrabold tracking-tight">Tendencies</h2>
          <span className="text-xs text-faint">pick a player to build their counter-intel dossier — habits, positions, and how to beat them</span>
        </div>
        <div className="scroll-slim grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:content-start lg:gap-3 lg:overflow-y-auto">
          {(["CT", "T"] as const).map((team) => (
            <div key={team} className="card-2 px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: sideHex(team) }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: sideSoft(team) }}>
                  {team} start
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">{byTeam(team).map(card)}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ---------- full dossier ----------
  const lines = playstyleSummary(player, tend);
  const plan = counterPlan(player, tend, scout);
  const shownPts = scout.pts.filter(
    (p) => (phase === "full" || p.opening) && (sideView === "both" || p.side === sideView),
  );
  const shownDeaths = scout.deaths.filter((d) => sideView === "both" || d.side === sideView);
  const zoneList = (side: "CT" | "T", zs: { name: string; pct: number }[]) =>
    zs.length > 0 && (
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: sideSoft(side) }}>
          {side}-side setups
        </div>
        <div className="space-y-1">
          {zs.map((z) => (
            <div key={z.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 shrink-0 truncate text-muted" title={z.name}>{z.name}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${z.pct}%`, background: sideHex(side) }} />
              </span>
              <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{z.pct.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <section className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
        <span className="h-3 w-3 rounded-full" style={{ background: sideHex(player.team) }} />
        <h2 className="text-lg font-extrabold tracking-tight">{player.name}</h2>
        <span className="pill bg-panel text-muted">{roleOf(player, tend)}</span>
        <span className="text-xs text-faint">
          {player.kills}K / {player.deaths}D · ADR {player.adr.toFixed(0)}
          {player.favoriteWeapons[0] ? ` · ${weaponLabel(player.favoriteWeapons[0].weapon)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => view.setFocusPlayer(null)}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition hover:bg-panel/60 hover:text-ink"
        >
          ← All players
        </button>
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.8fr)_minmax(320px,0.85fr)] lg:items-stretch lg:gap-3">
        {/* map unit: position samples */}
        <div className="space-y-2 lg:flex lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:space-y-0 lg:@container-size">
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-[min(100cqw,calc(100cqh-40px))] lg:shrink-0">
            <span className="stat-label">Positions</span>
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {(["opening", "full"] as const).map((ph) => (
                <button key={ph} type="button" onClick={() => setPhase(ph)} aria-pressed={phase === ph}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition ${phase === ph ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"}`}>
                  {ph === "opening" ? `First ${OPENING_WINDOW}s` : "Whole round"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-line bg-panel p-0.5">
              {(["both", "CT", "T"] as const).map((sv) => (
                <button key={sv} type="button" onClick={() => setSideView(sv)} aria-pressed={sideView === sv}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                    sideView === sv
                      ? sv === "CT" ? "bg-[#5b9dff]/20 text-[#9cc1ff]" : sv === "T" ? "bg-[#e7b53c]/20 text-[#f0cd78]" : "bg-brand/15 text-brand"
                      : "text-muted hover:text-ink"
                  }`}>
                  {sv === "both" ? "Both" : sv}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[10px] text-faint">{shownPts.length} samples · ✕ deaths</span>
          </div>
          <div className="relative aspect-square w-full max-w-240 overflow-hidden rounded-xl border border-line bg-panel2 lg:w-[min(100cqw,calc(100cqh-40px))] lg:max-w-none lg:shrink-0">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full select-none">
              {scout.calibrated ? (
                <image href={radarImage(meta.map)} x={0} y={0} width={100} height={100} preserveAspectRatio="none" opacity={0.9} />
              ) : (
                <rect x={0} y={0} width={100} height={100} fill="#0a1020" />
              )}
              {shownPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={0.8} fill={sideHex(p.side)} opacity={0.5} />
              ))}
              {shownDeaths.map((d, i) => (
                <g key={`d${i}`} stroke="#f5694a" strokeWidth={0.4} opacity={0.9}>
                  <line x1={d.x - 1} y1={d.y - 1} x2={d.x + 1} y2={d.y + 1} />
                  <line x1={d.x + 1} y1={d.y - 1} x2={d.x - 1} y2={d.y + 1} />
                </g>
              ))}
            </svg>
            {!scout.calibrated && (
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-mid/15 px-2 py-0.5 text-[10px] text-mid">
                {meta.map} uncalibrated — positions auto-scaled, callouts unavailable
              </div>
            )}
          </div>
        </div>

        {/* dossier */}
        <div className="scroll-slim card-2 space-y-4 px-4 py-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          <div>
            <div className="stat-label mb-2">Setups &amp; habits</div>
            <div className="space-y-3">
              {zoneList("CT", scout.zonesCT)}
              {zoneList("T", scout.zonesT)}
              {!scout.zonesCT.length && !scout.zonesT.length && (
                <div className="text-[11px] text-faint">No callout data (uncalibrated map or too few frames).</div>
              )}
            </div>
          </div>

          {tend && tend.rounds >= 3 && (
            <div className="space-y-3 border-t border-line pt-3">
              <Meter label="Contact distance" pct={tend.spacePct} leftWord="up front / entry" rightWord="plays for space" />
              <Meter label="Team proximity" pct={tend.lurkPct} leftWord="stacks with team" rightWord="lurks alone" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <TimingBars label="Kills by phase" data={scout.killTiming} hex="#46d369" />
            <TimingBars label="Deaths by phase" data={scout.deathTiming} hex="#f5694a" />
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-line pt-3 text-center">
            <div className="rounded-lg bg-panel/50 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-faint">Avg kill range</div>
              <div className="text-sm font-bold tabular-nums">{scout.avgKillDist != null ? `~${scout.avgKillDist.toFixed(0)}m` : "—"}</div>
            </div>
            <div className="rounded-lg bg-panel/50 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-faint">Opening duels</div>
              <div className="text-sm font-bold tabular-nums">
                {player.openingAttempts ? `${player.openingWinPct.toFixed(0)}% of ${player.openingAttempts}` : "—"}
              </div>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="border-t border-line pt-3">
              <div className="stat-label mb-1.5">Scouting notes</div>
              <ul className="space-y-1">
                {lines.map((l, i) => {
                  const [cat, ...rest] = l.split(":");
                  return (
                    <li key={i} className="text-[11px] leading-snug text-muted">
                      <span className="font-semibold text-ink">{cat}:</span>
                      {rest.join(":")}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* the counter playbook */}
        <div className="scroll-slim card-2 flex flex-col px-4 py-3 lg:h-full lg:min-h-0 lg:overflow-y-auto" style={{ borderColor: "rgba(56,214,255,0.35)" }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand/15 text-brand">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
              </svg>
            </span>
            <span className="text-sm font-extrabold tracking-tight">How to counter {player.name}</span>
          </div>
          <ol className="space-y-2">
            {plan.map((tip, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-panel/50 px-3 py-2 text-[12px] leading-snug text-ink">
                <span className="shrink-0 font-black tabular-nums text-brand">{i + 1}.</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
          <p className="mt-auto border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
            Built from this demo only ({scopedRounds.length} round{scopedRounds.length === 1 ? "" : "s"}) — habits can differ across maps and lobbies. Positions sample at 1 Hz after freeze time.
          </p>
        </div>
      </div>
    </section>
  );
}
