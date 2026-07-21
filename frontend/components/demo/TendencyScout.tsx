"use client";

// Tendencies — the counter-intelligence lens. Pick an opponent and get a
// scouting dossier built from this demo: WHERE they set up (radar positions by
// side + round phase, with named-callout reads), HOW they play (role,
// space/lurk meters, duels, timing, economy) and — the point of it all — a
// synthesized "How to counter" playbook where every line cites the demo
// evidence (counts + round numbers) it was derived from. Special lenses show
// where they hold when carrying a sniper and where they play on save rounds.

import { useEffect, useMemo, useState } from "react";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { computeInsights, clusterUtilThrows, weaponLabel, type PlayerInsight, type UtilThrow } from "@/lib/demo/insights";
import { computeTendencies, playstyleSummary, type PlayerTendencies } from "@/lib/demo/tendencies";
import { classifyBuy } from "@/lib/demo/economy";
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
// Below this speed (game units/second) between consecutive samples a player is
// "holding" — walking speed is ~250 u/s, so this is genuinely standing still.
const STILL_SPEED = 70;

const sideHex = (s: "CT" | "T" | "") => (s === "T" ? T : CT);
const sideSoft = (s: "CT" | "T" | "") => (s === "T" ? T_SOFT : CT_SOFT);

// One-word role heuristic (weapon + opening duels + positioning).
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
type Lens = "all" | "awp" | "eco" | "plant";

// A named-callout read: the rounds (numbers) whose opening setup was this zone.
interface ZoneRead {
  name: string;
  rounds: number[];
  sideRounds: number;
}

interface SpotRead {
  name: string;
  rounds: number[];
}

// A repeated grenade lineup: same kind landing in the same spot, N times.
interface NadeSpot {
  kind: string;
  name: string | null; // callout of the landing cluster (calibrated maps)
  count: number;
  rounds: number[];
  avgAfterFreeze: number; // avg seconds after freeze when it lands
}

interface UtilRead {
  counts: { smoke: number; flash: number; molotov: number; he: number };
  total: number;
  early: number; // thrown within 25s of freeze
  spots: NadeSpot[];
}

interface ScoutData {
  // radar-space position samples for the phase/side/lens filters
  pts: { x: number; y: number; side: "CT" | "T"; opening: boolean; rn: number; still: boolean; dir: number; post: boolean }[];
  deaths: { x: number; y: number; side: "CT" | "T"; rn: number }[];
  // per-round dominant opening callout, per side
  zonesCT: ZoneRead[];
  zonesT: ZoneRead[];
  sideRounds: { CT: number; T: number };
  calibrated: boolean;
  avgKillDist: number | null; // meters
  killDistN: number;
  avgDeathDist: number | null;
  // kills/deaths by round phase (post-freeze thirds: 0-25s / 25-55s / 55s+)
  killTiming: [number, number, number];
  deathTiming: [number, number, number];
  // first duel of the round, by round number
  openWon: number[];
  openLost: number[];
  earlyDeaths: number[]; // rounds where they died inside the first 25s
  totalDeaths: number;
  totalKills: number;
  // sniper (AWP/SSG/auto) intel
  sniperRounds: number[];
  sniperKills: number;
  sniperHold: SpotRead | null; // favourite stationary hold in sniper rounds
  // save-round intel (eco/semi buys)
  ecoRounds: number[];
  ecoSpot: SpotRead | null;
  util: UtilRead;
  // where their kills come FROM (killer position, with the victim direction)
  killPts: { x: number; y: number; vx: number; vy: number; side: "CT" | "T"; rn: number }[];
  // post-plant intel: rounds with a plant where this player was still alive
  plantRounds: number[];
  // bomb-carrier profile (T side)
  bombRounds: number[];
  bombDeaths: number; // died while still carrying (before any plant)
  // "death magnet" — the named callout they keep dying in (>=3 deaths)
  deathSpot: SpotRead | null;
  // what they do in the ~5s after getting a kill (from the 1 Hz frames)
  postKill: { reHold: number; move: number; tradedRounds: number[] };
  // conditioned economy: what they buy after a loss / win, pistol record
  econ: {
    afterLoss: { force: number; save: number; full: number; n: number; forceRounds: number[] };
    afterWin: { force: number; save: number; full: number; n: number };
    pistols: { won: number; n: number };
  };
}

const OPENING_WINDOW = 20; // seconds after freeze shown by the map's "First 20s" phase
// Setup read: within the first SETUP_WINDOW s after freeze, a callout only
// counts as the round's setup if the player DWELLED there — at least
// SETUP_MIN_DWELL consecutive 1 Hz samples (≈ seconds). Transit zones on the
// way out of spawn get 1-2 samples each and can never win.
const SETUP_WINDOW = 30;
const SETUP_MIN_DWELL = 3;

function computeScout(meta: ReplayMeta, rounds: ReplayRound[], idx: number): ScoutData {
  const proj = buildProjection(meta.map, rounds);
  const zones = getActiveZones(meta.map);
  const pts: ScoutData["pts"] = [];
  const deaths: ScoutData["deaths"] = [];
  const zoneRounds = { CT: new Map<string, number[]>(), T: new Map<string, number[]>() };
  const sideRounds = { CT: 0, T: 0 };
  let killDistSum = 0, killDistN = 0, deathDistSum = 0, deathDistN = 0;
  const killTiming: [number, number, number] = [0, 0, 0];
  const deathTiming: [number, number, number] = [0, 0, 0];
  const openWon: number[] = [];
  const openLost: number[] = [];
  const earlyDeaths: number[] = [];
  let totalDeaths = 0, totalKills = 0;
  const sniperRounds: number[] = [];
  let sniperKills = 0;
  const holdCount = new Map<string, { samples: number; rounds: Set<number> }>();
  const ecoRounds: number[] = [];
  const ecoCount = new Map<string, { samples: number; rounds: Set<number> }>();
  const utilCounts = { smoke: 0, flash: 0, molotov: 0, he: 0 };
  let utilTotal = 0, utilEarly = 0;
  const throwsByKind = new Map<string, UtilThrow[]>();
  const killPts: ScoutData["killPts"] = [];
  const plantRounds: number[] = [];
  const bombRounds: number[] = [];
  let bombDeaths = 0;
  const deathZone = new Map<string, number[]>(); // callout -> rounds died there
  const postKill = { reHold: 0, move: 0, tradedRounds: [] as number[] };
  const econ: ScoutData["econ"] = {
    afterLoss: { force: 0, save: 0, full: 0, n: 0, forceRounds: [] },
    afterWin: { force: 0, save: 0, full: 0, n: 0 },
    pistols: { won: 0, n: 0 },
  };
  let prevResult: boolean | null = null; // did their side win the previous round

  for (const rd of rounds) {
    const freeze = rd.freezeEnd ?? 15;
    const side: "CT" | "T" | "" = rd.ct?.includes(idx) ? "CT" : rd.t?.includes(idx) ? "T" : "";
    if (!side) continue;
    sideRounds[side]++;

    // economy + gear for this round
    const st = rd.stats?.find((s) => s.i === idx);
    const buyKind = st?.buy ?? (st?.equip != null ? classifyBuy(st.equip, rd.n).key : null);
    const isEco = buyKind === "eco" || buyKind === "semi";
    if (isEco) ecoRounds.push(rd.n);

    // conditioned economy: what did they buy GIVEN the previous round's result?
    if (rd.n === 1 || rd.n === 13) {
      econ.pistols.n++;
      if (rd.winner === side) econ.pistols.won++;
    } else if (prevResult != null && buyKind != null) {
      const bucket = prevResult ? econ.afterWin : econ.afterLoss;
      bucket.n++;
      if (buyKind === "force") {
        bucket.force++;
        if (!prevResult) econ.afterLoss.forceRounds.push(rd.n);
      } else if (isEco) bucket.save++;
      else if (buyKind === "full") bucket.full++;
    }
    prevResult = rd.winner ? rd.winner === side : null;
    const gear = [...(st?.bought ?? []), ...(st?.pickedUp ?? [])];
    const sniperKillsHere = (rd.kills ?? []).filter((k) => k.k === idx && SNIPER_RE.test(k.w)).length;
    sniperKills += sniperKillsHere;
    const hasSniper = sniperKillsHere > 0 || gear.some((g) => SNIPER_RE.test(g));
    if (hasSniper) sniperRounds.push(rd.n);

    const plant = (rd.bomb ?? []).find((b) => b.k === "plant") ?? null;
    let carriedBomb = false;
    let sawPostPlant = false;

    // ordered zone sequence over the setup window — the setup read is DWELL
    // based: the longest consecutive stay in one callout, so the spawn-exit
    // transit (1-2 samples per zone passed through) can never win. Spawn zones
    // are excluded outright: idling in spawn isn't a setup.
    const setupSeq: (string | null)[] = [];
    let prev: { x: number; y: number; t: number } | null = null;
    for (const f of rd.frames ?? []) {
      if (f.t < freeze) continue;
      const p = f.p.find((pp) => pp.i === idx && pp.h > 0);
      if (!p) {
        prev = null;
        continue;
      }
      if (p.b) carriedBomb = true;
      const r = proj.project(p.x, p.y);
      if (!r) continue;
      const still =
        prev != null && Math.hypot(p.x - prev.x, p.y - prev.y) / Math.max(1, f.t - prev.t) < STILL_SPEED;
      prev = { x: p.x, y: p.y, t: f.t };
      const opening = f.t <= freeze + OPENING_WINDOW;
      const post = plant != null && f.t >= plant.t;
      if (post) sawPostPlant = true;
      pts.push({ x: r.x * 100, y: r.y * 100, side, opening, rn: rd.n, still, dir: p.d, post });
      if (!proj.calibrated) continue;
      const z = classifyPosition(meta.map, p.x, p.y, zones);
      if (f.t <= freeze + SETUP_WINDOW) {
        setupSeq.push(z?.name && !/spawn/i.test(z.name) ? z.name : null);
      }
      if (!z?.name) continue;
      if (hasSniper && still) {
        const c = holdCount.get(z.name) ?? { samples: 0, rounds: new Set() };
        c.samples++;
        c.rounds.add(rd.n);
        holdCount.set(z.name, c);
      }
      if (isEco) {
        const c = ecoCount.get(z.name) ?? { samples: 0, rounds: new Set() };
        c.samples++;
        c.rounds.add(rd.n);
        ecoCount.set(z.name, c);
      }
    }
    // the round's setup = the longest consecutive dwell (≥ SETUP_MIN_DWELL
    // samples ≈ seconds at 1 Hz) in one callout within the setup window
    {
      let best: { name: string; len: number } | null = null;
      let run: { name: string; len: number } | null = null;
      for (const name of setupSeq) {
        if (name && run && run.name === name) run.len++;
        else run = name ? { name, len: 1 } : null;
        if (run && (!best || run.len > best.len)) best = { ...run };
      }
      if (best && best.len >= SETUP_MIN_DWELL) {
        const arr = zoneRounds[side].get(best.name) ?? [];
        arr.push(rd.n);
        zoneRounds[side].set(best.name, arr);
      }
    }

    // this player's grenades: kind counts, execute timing, repeated lineups
    for (const n of rd.nades ?? []) {
      if (n.by !== idx) continue;
      const kind = n.k === "molotov" || n.k === "inferno" || n.k === "incgrenade" ? "molotov" : n.k;
      if (kind === "decoy") continue;
      if (kind in utilCounts) utilCounts[kind as keyof typeof utilCounts]++;
      utilTotal++;
      if (n.t <= freeze + 25) utilEarly++;
      const arr = throwsByKind.get(kind) ?? [];
      // t is stored relative to freeze so cluster avgT reads as "lands at ~Xs"
      arr.push({ kind, x: n.x, y: n.y, ox: n.ox ?? n.x, oy: n.oy ?? n.y, t: Math.max(0, n.t - freeze), round: rd.n });
      throwsByKind.set(kind, arr);
    }

    const bucket = (t: number) => (t < freeze + 25 ? 0 : t < freeze + 55 ? 1 : 2);
    // first duel = earliest REAL opposing-team kill (world/fall deaths,
    // suicides and teamkills don't count as duels)
    let first: (typeof rd.kills)[number] | null = null;
    let myDeathT: number | null = null;
    for (const k of rd.kills ?? []) {
      const duel =
        k.k >= 0 && k.v >= 0 && k.k !== k.v && rd.ct?.includes(k.k) !== rd.ct?.includes(k.v);
      if (duel && (first == null || k.t < first.t)) first = k;
      const d = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
      if (k.k === idx && k.v !== idx) {
        totalKills++;
        killTiming[bucket(k.t)]++;
        killDistSum += d;
        killDistN++;
        const kr = proj.project(k.kx, k.ky);
        const vr = proj.project(k.vx, k.vy);
        if (kr) {
          killPts.push({
            x: kr.x * 100, y: kr.y * 100,
            vx: (vr ?? kr).x * 100, vy: (vr ?? kr).y * 100,
            side, rn: rd.n,
          });
        }
        // what do they do in the ~5s after the kill? (1 Hz samples permitting)
        const at = (lo: number, hi: number) => {
          for (const f of rd.frames ?? []) {
            if (f.t < lo || f.t > hi) continue;
            const pp = f.p.find((q) => q.i === idx && q.h > 0);
            if (pp) return pp;
          }
          return null;
        };
        const p0 = at(k.t - 1, k.t + 2);
        const p1 = at(k.t + 3.5, k.t + 7);
        if (p0 && p1) {
          if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 130) postKill.reHold++;
          else postKill.move++;
        }
        const tradedBack = (rd.kills ?? []).some(
          (k2) => k2.v === idx && k2.t > k.t && k2.t - k.t <= 5,
        );
        if (tradedBack && !postKill.tradedRounds.includes(rd.n)) postKill.tradedRounds.push(rd.n);
      }
      if (k.v === idx) {
        totalDeaths++;
        if (myDeathT == null || k.t < myDeathT) myDeathT = k.t;
        deathTiming[bucket(k.t)]++;
        if (bucket(k.t) === 0) earlyDeaths.push(rd.n);
        if (k.k >= 0) {
          // unknown killers leave kx/ky at the origin — garbage distance
          deathDistSum += d;
          deathDistN++;
        }
        const r = proj.project(k.vx, k.vy);
        if (r) deaths.push({ x: r.x * 100, y: r.y * 100, side, rn: rd.n });
        if (proj.calibrated) {
          const dz = classifyPosition(meta.map, k.vx, k.vy, zones);
          if (dz?.name) {
            const arr = deathZone.get(dz.name) ?? [];
            arr.push(rd.n);
            deathZone.set(dz.name, arr);
          }
        }
      }
    }
    if (first) {
      if (first.k === idx) openWon.push(rd.n);
      else if (first.v === idx) openLost.push(rd.n);
    }
    if (plant != null && sawPostPlant) plantRounds.push(rd.n);
    if (carriedBomb) {
      bombRounds.push(rd.n);
      if (myDeathT != null && (plant == null || myDeathT < plant.t)) bombDeaths++;
    }
  }

  const tops = (side: "CT" | "T") =>
    [...zoneRounds[side].entries()]
      .map(([name, rns]) => ({ name, rounds: rns, sideRounds: sideRounds[side] }))
      .sort((a, b) => b.rounds.length - a.rounds.length)
      .slice(0, 3);
  const topSpot = (m: Map<string, { samples: number; rounds: Set<number> }>, minSamples: number): SpotRead | null => {
    const best = [...m.entries()].sort((a, b) => b[1].samples - a[1].samples)[0];
    if (!best || best[1].samples < minSamples || best[1].rounds.size < 2) return null;
    return { name: best[0], rounds: [...best[1].rounds].sort((a, b) => a - b) };
  };

  // repeated lineups: cluster each grenade kind by landing spot, keep repeats
  const nadeSpots: NadeSpot[] = [];
  for (const [, throws] of throwsByKind) {
    for (const c of clusterUtilThrows(throws, proj.project)) {
      if (c.count < 2) continue;
      const z = proj.calibrated ? classifyPosition(meta.map, c.cx, c.cy, zones) : null;
      nadeSpots.push({
        kind: c.kind,
        name: z?.name ?? null,
        count: c.count,
        rounds: [...new Set(c.throws.map((tw) => tw.round))].sort((a, b) => a - b),
        avgAfterFreeze: c.avgT,
      });
    }
  }
  nadeSpots.sort((a, b) => b.count - a.count);

  return {
    pts,
    deaths,
    zonesCT: tops("CT"),
    zonesT: tops("T"),
    sideRounds,
    calibrated: proj.calibrated,
    avgKillDist: killDistN ? killDistSum / killDistN : null,
    killDistN,
    avgDeathDist: deathDistN ? deathDistSum / deathDistN : null,
    killTiming,
    deathTiming,
    openWon,
    openLost,
    earlyDeaths,
    totalDeaths,
    totalKills,
    sniperRounds,
    sniperKills,
    sniperHold: topSpot(holdCount, 4),
    ecoRounds,
    ecoSpot: topSpot(ecoCount, 3),
    util: { counts: utilCounts, total: utilTotal, early: utilEarly, spots: nadeSpots.slice(0, 3) },
    killPts,
    plantRounds,
    bombRounds,
    bombDeaths,
    deathSpot: (() => {
      const best = [...deathZone.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      return best && best[1].length >= 3 ? { name: best[0], rounds: best[1] } : null;
    })(),
    postKill,
    econ,
  };
}

// One playbook entry: the counter move, plus the demo evidence it rests on.
// `rounds` (when present) renders as clickable chips that scope the workspace;
// `zone` (when present) highlights that callout on the map while hovered.
interface Tip {
  text: string;
  why: string;
  rounds?: number[];
  zone?: string;
}

const fmtR = (ns: number[], cap = 6) =>
  ns.slice(0, cap).map((n) => `R${n}`).join(" · ") + (ns.length > cap ? ` +${ns.length - cap} more` : "");

// The playbook: actionable counters, each citing the counts + rounds behind it.
function counterPlan(p: PlayerInsight, t: PlayerTendencies | undefined, s: ScoutData): Tip[] {
  const out: Tip[] = [];
  const zoneTip = (side: "CT" | "T", zs: ZoneRead[]) => {
    const z = zs[0];
    if (z && z.sideRounds >= 3 && z.rounds.length / z.sideRounds >= 0.5) {
      out.push({
        text: `On their ${side} side, pre-aim ${z.name} — it's their default setup.`,
        why: `held ${z.name} for ${SETUP_MIN_DWELL}s+ early in ${z.rounds.length} of ${z.sideRounds} ${side} rounds`,
        rounds: z.rounds,
        zone: z.name,
      });
    }
  };
  zoneTip("CT", s.zonesCT);
  zoneTip("T", s.zonesT);

  if (s.sniperHold && s.sniperRounds.length >= 2) {
    out.push({
      text: `Their sniper lives at ${s.sniperHold.name} — smoke it off before crossing, or hit a different path entirely.`,
      why: `held ${s.sniperHold.name} stationary in ${s.sniperHold.rounds.length} of ${s.sniperRounds.length} sniper rounds`,
      rounds: s.sniperHold.rounds,
      zone: s.sniperHold.name,
    });
  }
  if (s.ecoSpot && s.ecoRounds.length >= 2) {
    out.push({
      text: `On save rounds, expect them at ${s.ecoSpot.name} with pistols — clear it with utility instead of walking in.`,
      why: `played ${s.ecoSpot.name} in ${s.ecoSpot.rounds.length} of ${s.ecoRounds.length} eco/light-buy rounds`,
      rounds: s.ecoSpot.rounds,
      zone: s.ecoSpot.name,
    });
  }

  const lineup = s.util.spots.find((sp) => sp.count >= 3 && sp.name);
  if (lineup) {
    out.push({
      text: `Same ${lineup.kind} every time — it lands ${lineup.name} like clockwork. The moment it blooms, you know the play; pre-position to punish it.`,
      why: `landed a ${lineup.kind} at ${lineup.name} ${lineup.count}× across ${lineup.rounds.length} round${lineup.rounds.length === 1 ? "" : "s"}, ~${lineup.avgAfterFreeze.toFixed(0)}s after freeze`,
      rounds: lineup.rounds,
      zone: lineup.name ?? undefined,
    });
  }
  if (s.util.total >= 8 && s.util.early / s.util.total >= 0.65) {
    out.push({
      text: "Their utility front-runs the execute — the first grenade you see is your rotate call.",
      why: `${s.util.early} of ${s.util.total} grenades detonating inside 25s of freeze`,
    });
  }

  if (t && t.rounds >= 5) {
    if (t.spacePct <= 25)
      out.push({
        text: "First through the door — hold close angles and set up instant trades; don't give free entries.",
        why: `distance to the nearest enemy in the ${t.spacePct}th percentile of this lobby across ${t.rounds} rounds`,
      });
    if (t.lurkPct >= 75)
      out.push({
        text: "Lurker — clear flanks before committing late-round; never rotate everyone off their side.",
        why: `distance from their own teammates in the ${t.lurkPct}th percentile of this lobby (${t.rounds} rounds)`,
      });
    if (t.zoneSamples >= 12 && t.rotationsPerRound >= 1.6)
      out.push({
        text: "Heavy roamer — one mid-round spot check tells you where the rest of their team isn't.",
        why: `moved between map areas ${t.rotationsPerRound.toFixed(1)} times per round`,
      });
  }

  const openN = s.openWon.length + s.openLost.length;
  if (openN >= 4 && s.openWon.length / openN >= 0.6) {
    out.push({
      text: "Never peek them dry — flash first or refuse the opening fight and trade instead.",
      why: `took the first kill of the round ${s.openWon.length} of ${openN} times it involved them`,
      rounds: s.openWon,
    });
  } else if (openN >= 4 && s.openLost.length / openN >= 0.65) {
    out.push({
      text: "Hunt the opening pick against them — they keep losing the first fight.",
      why: `died first in ${s.openLost.length} of ${openN} first duels`,
      rounds: s.openLost,
    });
  }

  if (s.sniperKills >= 3) {
    out.push({
      text: "Sniper threat — force close-range fights: smoke their angle, hit unscoped timings, repeek wide off a flash.",
      why: `${s.sniperKills} of their ${s.totalKills} kills came with a sniper rifle, carried in ${s.sniperRounds.length} rounds`,
    });
  } else if (s.avgKillDist != null && s.killDistN >= 5 && s.avgKillDist >= 22) {
    out.push({
      text: "Fights long ranges — close the distance with smokes before engaging.",
      why: `${s.killDistN} kills averaging ~${s.avgKillDist.toFixed(0)}m apart`,
    });
  } else if (s.avgKillDist != null && s.killDistN >= 5 && s.avgKillDist <= 9) {
    out.push({
      text: "Close-range killer — keep them at distance and deny tight positions with molotovs.",
      why: `${s.killDistN} kills averaging only ~${s.avgKillDist.toFixed(0)}m apart`,
    });
  }

  if (s.deathSpot) {
    out.push({
      text: `They keep dying at ${s.deathSpot.name} — pre-set the crossfire there and let them walk into it.`,
      why: `${s.deathSpot.rounds.length} of ${s.totalDeaths} deaths in that same callout`,
      rounds: s.deathSpot.rounds,
      zone: s.deathSpot.name,
    });
  }
  const pkN = s.postKill.reHold + s.postKill.move;
  if (pkN >= 4 && s.postKill.reHold / pkN >= 0.7) {
    out.push({
      text: "They re-hold the same angle after a kill — the refrag is free; trade wide immediately.",
      why: `stayed put after ${s.postKill.reHold} of ${pkN} sampled kills${s.postKill.tradedRounds.length ? `; already died within 5s of a kill ${s.postKill.tradedRounds.length}×` : ""}`,
      rounds: s.postKill.tradedRounds.length ? s.postKill.tradedRounds : undefined,
    });
  } else if (pkN >= 4 && s.postKill.move / pkN >= 0.7) {
    out.push({
      text: "They relocate after every kill — don't re-swing the same angle; clear wide for the new position.",
      why: `repositioned after ${s.postKill.move} of ${pkN} sampled kills`,
    });
  }

  // conditioned force read beats the flat histogram; fall back when thin
  const condForce = s.econ.afterLoss.n >= 4 && s.econ.afterLoss.force / s.econ.afterLoss.n >= 0.5;
  if (condForce) {
    out.push({
      text: "After losing a round they force — expect armor + upgraded pistols/SMGs, not an eco; don't over-chase.",
      why: `forced ${s.econ.afterLoss.force} of ${s.econ.afterLoss.n} rounds that followed a loss`,
      rounds: s.econ.afterLoss.forceRounds,
    });
  }
  const nb = p.buys.eco + p.buys.semi + p.buys.force + p.buys.full;
  if (!condForce && nb >= 5 && p.buys.force / nb >= 0.3)
    out.push({
      text: "Force-buys often after losses — expect upgraded pistols/SMGs on their 'save' rounds; don't over-push their ecos.",
      why: `${p.buys.force} force buys vs ${p.buys.eco} full saves across ${nb} gun rounds`,
    });
  if (s.totalDeaths >= 5 && s.earlyDeaths.length / s.totalDeaths >= 0.6)
    out.push({
      text: "Dies early most rounds — over-aggressive; punish with pre-placed crossfires on their usual first steps.",
      why: `${s.earlyDeaths.length} of ${s.totalDeaths} deaths inside the first 25s`,
      rounds: s.earlyDeaths,
    });
  if (p.clutchTotal >= 3 && p.clutchWon / p.clutchTotal >= 0.5)
    out.push({
      text: "Dangerous in clutches — play the bomb and the clock, don't peek them 1vX.",
      why: `won ${p.clutchWon} of ${p.clutchTotal} 1vX situations this match`,
    });
  if (p.enemiesFlashed >= 8)
    out.push({
      text: "Heavy flash usage — turn away on their utility timings and punish the follow-up peek.",
      why: `flashed ${p.enemiesFlashed} enemies this match (${p.flashDuration.toFixed(0)}s of total blind time)`,
    });

  if (p.kills >= 8 && p.hsPct >= 55)
    out.push({
      text: "Crosshair lives at head level — don't stand still in their angles; jiggle for info and wide-swing crouched.",
      why: `${p.headshots} of ${p.kills} kills were headshots (${p.hsPct.toFixed(0)}%)`,
    });
  else if (p.kills >= 8 && p.hsPct <= 20)
    out.push({
      text: "Body-sprayer — head-level crosshair wins you the first bullet in straight duels.",
      why: `only ${p.headshots} of ${p.kills} kills were headshots (${p.hsPct.toFixed(0)}%)`,
    });
  if (p.shots >= 120 && p.accuracy <= 15)
    out.push({
      text: "Wild sprayer — take fights at range and off-angles; their volume aim falls apart at distance.",
      why: `only ${p.accuracy.toFixed(0)}% of ${p.shots} bullets fired damaged an enemy`,
    });
  const bigRounds = p.multiKills.k3 + p.multiKills.k4 + p.multiKills.k5;
  if (bigRounds >= 2)
    out.push({
      text: "Snowballs fights — never trickle in one at a time; group up and hit them as a unit.",
      why: `${bigRounds} rounds with 3+ kills this match (3K ×${p.multiKills.k3}${p.multiKills.k4 ? `, 4K ×${p.multiKills.k4}` : ""}${p.multiKills.k5 ? `, ACE ×${p.multiKills.k5}` : ""})`,
    });
  if (p.kills >= 8 && p.tradeKillPct >= 40)
    out.push({
      text: "A trade player — after they refrag, their own position is briefly exposed; keep a third gun on the exchange.",
      why: `${p.tradeKills} of ${p.kills} kills (${p.tradeKillPct.toFixed(0)}%) were refrags of a teammate's death`,
    });
  if (t && t.rounds >= 5 && t.zoneSamples >= 12) {
    // share among SITE presence only (A vs B) — mid time doesn't dilute the read
    const site = t.t.a + t.t.b;
    if (site >= 0.2) {
      const pairs: ["A" | "B", number][] = [["A", t.t.a / site], ["B", t.t.b / site]];
      const pref = pairs.sort((a, b) => b[1] - a[1])[0];
      if (pref[1] >= 0.7)
        out.push({
          text: `On T side they gravitate to ${pref[0]} — weight your defensive setup and lurk checks toward it.`,
          why: `${Math.round(pref[1] * 100)}% of their T-side site (A/B) presence was around ${pref[0]}`,
        });
    }
  }

  if (!out.length)
    out.push({
      text: "No strong reads this demo — they play standard; win on fundamentals and utility.",
      why: `${t?.rounds ?? 0} rounds analyzed — no habit repeated often enough to bank on`,
    });
  return out;
}

function Meter({ label, pct, leftWord, rightWord }: { label: string; pct: number; leftWord: string; rightWord: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="uppercase tracking-wider text-faint">{label}</span>
        <span className="tabular-nums text-muted" title="percentile rank among the 10 players in this match">{pct}/100 vs lobby</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-panel">
        <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg"
          style={{ left: `${Math.min(96, Math.max(4, pct))}%`, background: "var(--color-brand)" }}
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
  // The dossier is ALWAYS match-wide: a habit read needs the whole demo, and
  // clicking a playbook evidence chip (which scopes the workspace to one round)
  // must not regenerate the dossier from a 1-round sample — the tip being
  // verified would vanish. The round scope only narrows the positions map.
  const scopeRn = view.scopeRound != null ? rounds[view.scopeRound]?.n ?? null : null;
  const insights = useMemo(() => computeInsights(meta, rounds), [meta, rounds]);
  const tendencies = useMemo(() => computeTendencies(meta, rounds), [meta, rounds]);

  const focus = view.focusPlayer;
  const [phase, setPhase] = useState<Phase>("opening");
  const [sideView, setSideView] = useState<SideView>("both");
  const [lens, setLens] = useState<Lens>("all");
  const [showKills, setShowKills] = useState(false);
  // hovering any named callout (setup rows, lineups, chips, playbook tips)
  // highlights that area on the positions map
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const zonePolys = useMemo(() => getActiveZones(meta.map), [meta.map]);
  const zoneHover = (name: string | null | undefined) => ({
    onMouseEnter: () => setHoverZone(name ?? null),
    onMouseLeave: () => setHoverZone(null),
  });

  // the toolbar's side filter drives the map's side view (still overridable)
  useEffect(() => {
    setSideView(view.side === "all" ? "both" : view.side);
  }, [view.side]);

  const player = focus != null ? insights.players.find((p) => p.i === focus) ?? null : null;
  const tend = player ? tendencies.get(player.steamId) : undefined;
  const scout = useMemo(
    () => (focus != null ? computeScout(meta, rounds, focus) : null),
    [meta, rounds, focus],
  );

  // lobby medians for context under the stat tiles — one cheap pass over kills
  const lobby = useMemo(() => {
    const distSum = new Map<number, { s: number; n: number }>();
    const duel = new Map<number, { w: number; n: number }>();
    for (const rd of rounds) {
      let first: { t: number; k: number; v: number } | null = null;
      for (const k of rd.kills ?? []) {
        if (k.k >= 0 && k.v >= 0 && k.k !== k.v && rd.ct?.includes(k.k) !== rd.ct?.includes(k.v)) {
          if (first == null || k.t < first.t) first = k;
          const d = Math.hypot(k.kx - k.vx, k.ky - k.vy) * UNIT_TO_M;
          const e = distSum.get(k.k) ?? { s: 0, n: 0 };
          e.s += d;
          e.n++;
          distSum.set(k.k, e);
        }
      }
      if (first) {
        const w = duel.get(first.k) ?? { w: 0, n: 0 };
        w.w++;
        w.n++;
        duel.set(first.k, w);
        const l = duel.get(first.v) ?? { w: 0, n: 0 };
        l.n++;
        duel.set(first.v, l);
      }
    }
    const median = (xs: number[]) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    return {
      killDist: median([...distSum.values()].filter((e) => e.n >= 3).map((e) => e.s / e.n)),
      duelWinPct: median([...duel.values()].filter((e) => e.n >= 2).map((e) => (e.w / e.n) * 100)),
    };
  }, [rounds]);

  // round number -> index for the clickable evidence chips
  const roundIndexOf = useMemo(() => new Map(rounds.map((r, i) => [r.n, i])), [rounds]);
  const RoundChips = ({ rounds: rns, cap = 8 }: { rounds: number[]; cap?: number }) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {rns.slice(0, cap).map((n) => {
        const ri = roundIndexOf.get(n);
        const active = ri != null && view.scopeRound === ri;
        return (
          <button
            key={n}
            type="button"
            disabled={ri == null}
            onClick={() => ri != null && view.setScopeRound(active ? null : ri)}
            aria-pressed={active}
            title={`Scope the workspace to round ${n} — the map, Routes and Replay follow; the dossier stays match-wide`}
            className={`rounded px-1 text-[9px] font-semibold tabular-nums leading-4 transition ${
              active ? "bg-brand/25 text-brand" : "bg-panel text-muted hover:bg-brand/15 hover:text-brand"
            }`}
          >
            R{n}
          </button>
        );
      })}
      {rns.length > cap && <span className="text-[9px] text-faint">+{rns.length - cap}</span>}
    </span>
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
          {(["CT", "T"] as const)
            .filter((team) => view.side === "all" || team === view.side)
            .map((team) => (
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
  // lens state can be stale from a previously scouted player — fall back safely
  const eLens: Lens =
    lens === "awp" && scout.sniperRounds.length >= 2
      ? "awp"
      : lens === "eco" && scout.ecoRounds.length >= 2
        ? "eco"
        : lens === "plant" && scout.plantRounds.length >= 2
          ? "plant"
          : "all";
  const lensRounds =
    eLens === "awp"
      ? new Set(scout.sniperRounds)
      : eLens === "eco"
        ? new Set(scout.ecoRounds)
        : eLens === "plant"
          ? new Set(scout.plantRounds)
          : null;
  // the workspace round scope narrows the MAP only — the dossier stays match-wide
  const shownPts = scout.pts.filter(
    (p) =>
      (scopeRn == null || p.rn === scopeRn) &&
      (eLens === "plant"
        ? p.post
        : eLens !== "all"
          ? lensRounds!.has(p.rn)
          : phase === "full" || p.opening) &&
      (sideView === "both" || p.side === sideView),
  );
  const shownDeaths = scout.deaths.filter(
    (d) =>
      (scopeRn == null || d.rn === scopeRn) &&
      (sideView === "both" || d.side === sideView) &&
      (lensRounds == null || lensRounds.has(d.rn)),
  );
  const shownKills = showKills
    ? scout.killPts.filter(
        (k) =>
          (scopeRn == null || k.rn === scopeRn) &&
          (sideView === "both" || k.side === sideView) &&
          (lensRounds == null || lensRounds.has(k.rn)),
      )
    : [];
  const pickLens = (l: Lens) => {
    setLens(l);
    if (l !== "all") setPhase("full");
  };
  const openN = scout.openWon.length + scout.openLost.length;
  const zoneList = (side: "CT" | "T", zs: ZoneRead[]) =>
    zs.length > 0 && (
      <div>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: sideSoft(side) }}>
          {side}-side setups <span className="font-normal normal-case text-faint">· held ≥{SETUP_MIN_DWELL}s early · hover → map</span>
        </div>
        <div className="space-y-1">
          {zs.map((z) => (
            <div key={z.name} className="flex cursor-default items-center gap-2 rounded text-[11px] transition hover:bg-panel/50" title={fmtR(z.rounds, 10)} {...zoneHover(z.name)}>
              <span className="w-24 shrink-0 truncate text-muted" title={z.name}>{z.name}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${(z.rounds.length / Math.max(1, z.sideRounds)) * 100}%`, background: sideHex(side) }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
                {z.rounds.length}/{z.sideRounds}
              </span>
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
        {scopeRn != null && (
          <button
            type="button"
            onClick={() => view.setScopeRound(null)}
            title="The dossier always reads the whole demo — the round scope only narrows the positions map. Click to clear it."
            className="pill shrink-0 whitespace-nowrap bg-brand/15 text-brand"
          >
            Dossier is match-wide · map scoped to R{scopeRn} ✕
          </button>
        )}
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
            {eLens === "all" && (
              <div className="flex rounded-lg border border-line bg-panel p-0.5">
                {(["opening", "full"] as const).map((ph) => (
                  <button key={ph} type="button" onClick={() => setPhase(ph)} aria-pressed={phase === ph}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize transition ${phase === ph ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"}`}>
                    {ph === "opening" ? `First ${OPENING_WINDOW}s` : "Whole round"}
                  </button>
                ))}
              </div>
            )}
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
            {(scout.sniperRounds.length >= 2 || scout.ecoRounds.length >= 2 || scout.plantRounds.length >= 2) && (
              <div className="flex rounded-lg border border-line bg-panel p-0.5">
                <button type="button" onClick={() => pickLens("all")} aria-pressed={eLens === "all"}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${eLens === "all" ? "bg-brand/15 text-brand" : "text-muted hover:text-ink"}`}>
                  All
                </button>
                {scout.sniperRounds.length >= 2 && (
                  <button type="button" onClick={() => pickLens("awp")} aria-pressed={eLens === "awp"}
                    title={`rounds carrying a sniper rifle: ${fmtR(scout.sniperRounds, 10)}`}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${eLens === "awp" ? "bg-[#b48cff]/20 text-[#cdb2ff]" : "text-muted hover:text-ink"}`}>
                    AWP · {scout.sniperRounds.length}
                  </button>
                )}
                {scout.ecoRounds.length >= 2 && (
                  <button type="button" onClick={() => pickLens("eco")} aria-pressed={eLens === "eco"}
                    title={`eco / light-buy rounds: ${fmtR(scout.ecoRounds, 10)}`}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${eLens === "eco" ? "bg-good/20 text-[#7fe39a]" : "text-muted hover:text-ink"}`}>
                    Ecos · {scout.ecoRounds.length}
                  </button>
                )}
                {scout.plantRounds.length >= 2 && (
                  <button type="button" onClick={() => pickLens("plant")} aria-pressed={eLens === "plant"}
                    title={`rounds where they were alive after the plant: ${fmtR(scout.plantRounds, 10)} — post-plant holds & retake paths`}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${eLens === "plant" ? "bg-bad/20 text-[#ff9d8a]" : "text-muted hover:text-ink"}`}>
                    Plant · {scout.plantRounds.length}
                  </button>
                )}
              </div>
            )}
            {scout.killPts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowKills((v) => !v)}
                aria-pressed={showKills}
                title="Show where their kills came FROM — dot at their position, line toward the victim"
                className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition ${
                  showKills ? "border-good/40 bg-good/15 text-good" : "border-line bg-panel text-muted hover:text-ink"
                }`}
              >
                ● kills
              </button>
            )}
            <span className="ml-auto text-[10px] text-faint">
              {shownPts.length} samples · ✕ deaths{showKills ? " · ● kill origins" : ""}
            </span>
          </div>
          <div className="relative aspect-square w-full max-w-240 overflow-hidden rounded-xl border border-line bg-panel2 lg:w-[min(100cqw,calc(100cqh-40px))] lg:max-w-none lg:shrink-0">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full select-none">
              {scout.calibrated ? (
                <image href={radarImage(meta.map)} x={0} y={0} width={100} height={100} preserveAspectRatio="none" opacity={0.9} />
              ) : (
                <rect x={0} y={0} width={100} height={100} fill="#0a1020" />
              )}
              {/* hovered-callout highlight — the named area lights up on the map */}
              {hoverZone &&
                scout.calibrated &&
                zonePolys
                  .filter((z) => z.name === hoverZone)
                  .map((z, i) =>
                    z.points.length >= 3 ? (
                      <polygon
                        key={`hz${i}`}
                        points={z.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
                        fill="rgba(56,214,255,0.18)"
                        stroke="#38d6ff"
                        strokeWidth={0.45}
                        strokeLinejoin="round"
                      />
                    ) : z.points[0] ? (
                      <circle
                        key={`hz${i}`}
                        cx={z.points[0].x * 100}
                        cy={z.points[0].y * 100}
                        r={5}
                        fill="rgba(56,214,255,0.15)"
                        stroke="#38d6ff"
                        strokeWidth={0.45}
                      />
                    ) : null,
                  )}
              {eLens !== "all" &&
                shownPts.map((p, i) => {
                  // facing cone on holds — which way they're actually aiming
                  if (!p.still) return null;
                  const a = (p.dir * Math.PI) / 180;
                  const L = 7, S = 0.3; // reach + half-spread (~17°)
                  return (
                    <polygon
                      key={`c${i}`}
                      points={`${p.x},${p.y} ${p.x + L * Math.cos(a - S)},${p.y - L * Math.sin(a - S)} ${p.x + L * Math.cos(a + S)},${p.y - L * Math.sin(a + S)}`}
                      fill={sideHex(p.side)}
                      opacity={0.12}
                    />
                  );
                })}
              {shownPts.map((p, i) =>
                eLens !== "all" && p.still ? (
                  <circle key={i} cx={p.x} cy={p.y} r={1.15} fill={sideHex(p.side)} opacity={0.95} stroke="#fff" strokeWidth={0.18} />
                ) : (
                  <circle key={i} cx={p.x} cy={p.y} r={eLens !== "all" ? 0.55 : 0.8} fill={sideHex(p.side)} opacity={eLens !== "all" ? 0.28 : 0.5} />
                ),
              )}
              {shownDeaths.map((d, i) => (
                <g key={`d${i}`} stroke="#f5694a" strokeWidth={0.4} opacity={0.9}>
                  <line x1={d.x - 1} y1={d.y - 1} x2={d.x + 1} y2={d.y + 1} />
                  <line x1={d.x + 1} y1={d.y - 1} x2={d.x - 1} y2={d.y + 1} />
                </g>
              ))}
              {shownKills.map((k, i) => {
                const dx = k.vx - k.x;
                const dy = k.vy - k.y;
                const len = Math.hypot(dx, dy) || 1;
                const L = Math.min(4, len);
                return (
                  <g key={`k${i}`}>
                    <line x1={k.x} y1={k.y} x2={k.x + (dx / len) * L} y2={k.y + (dy / len) * L} stroke="#46d369" strokeWidth={0.25} opacity={0.55} />
                    <circle cx={k.x} cy={k.y} r={0.7} fill="#46d369" opacity={0.9} />
                  </g>
                );
              })}
            </svg>
            {shownPts.length === 0 && shownDeaths.length === 0 && shownKills.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="rounded-lg bg-black/55 px-3 py-1.5 text-center text-[11px] text-muted backdrop-blur-sm">
                  No samples for this view — widen the side / phase / lens filters
                  {scopeRn != null ? ` or clear the R${scopeRn} round scope` : ""}.
                </div>
              </div>
            )}
            {eLens !== "all" && (
              <div className="pointer-events-none absolute bottom-2 left-1/2 w-max max-w-[95%] -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] text-ink backdrop-blur-sm">
                {eLens === "awp"
                  ? `sniper rounds only (${fmtR(scout.sniperRounds, 4)}) — ringed dots = stationary holds, cones = where they're aiming`
                  : eLens === "eco"
                    ? `save rounds only (${fmtR(scout.ecoRounds, 4)}) — ringed dots = where they camp on eco / light buys`
                    : `after the plant only (${fmtR(scout.plantRounds, 4)}) — their post-plant / retake positions`}
              </div>
            )}
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
              {(scout.bombRounds.length > 0 || scout.deathSpot) && (
                <div className="flex flex-wrap items-center gap-1 text-[10px]">
                  {scout.bombRounds.length > 0 && (
                    <span className="rounded-full bg-panel px-2 py-0.5 tabular-nums text-muted" title={fmtR(scout.bombRounds, 10)}>
                      Bomb · carried in {scout.bombRounds.length} rd{scout.bombRounds.length === 1 ? "" : "s"}
                      {scout.bombDeaths > 0 ? ` · died with it ${scout.bombDeaths}×` : ""}
                    </span>
                  )}
                  {scout.deathSpot && (
                    <span className="cursor-default rounded-full bg-bad/10 px-2 py-0.5 tabular-nums text-bad" title={fmtR(scout.deathSpot.rounds, 10)} {...zoneHover(scout.deathSpot.name)}>
                      ✕ dies at {scout.deathSpot.name} — {scout.deathSpot.rounds.length} of {scout.totalDeaths}
                    </span>
                  )}
                </div>
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

          {scout.util.total > 0 && (
            <div className="border-t border-line pt-3">
              <div className="stat-label mb-1.5">Utility habits</div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {(
                  [
                    ["smoke", "Smokes", "#8fa3bd"],
                    ["flash", "Flashes", "#e7d178"],
                    ["molotov", "Molotovs", "#f08c4a"],
                    ["he", "HE", "#f5694a"],
                  ] as const
                ).map(([k, label, hex]) =>
                  scout.util.counts[k] > 0 ? (
                    <span key={k} className="rounded-full bg-panel px-2 py-0.5 tabular-nums text-muted">
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: hex }} />
                      {label} · {scout.util.counts[k]}
                    </span>
                  ) : null,
                )}
                <span className="rounded-full bg-panel px-2 py-0.5 tabular-nums text-faint" title="grenades detonating within 25s of freeze — execute utility">
                  {scout.util.early}/{scout.util.total} early
                </span>
              </div>
              {scout.util.spots.filter((sp) => sp.name).length > 0 && (
                <div className="mt-2 space-y-1">
                  {scout.util.spots
                    .filter((sp) => sp.name)
                    .map((sp, i) => (
                      <div key={i} className="flex cursor-default items-center gap-2 rounded text-[11px] text-muted transition hover:bg-panel/50" title={fmtR(sp.rounds, 10)} {...zoneHover(sp.name)}>
                        <span className="capitalize text-faint">{sp.kind}</span>
                        <span aria-hidden>→</span>
                        <span className="truncate font-medium text-ink">{sp.name}</span>
                        <span className="ml-auto shrink-0 tabular-nums">
                          ×{sp.count} <span className="text-faint">· ~{sp.avgAfterFreeze.toFixed(0)}s</span>
                        </span>
                      </div>
                    ))}
                  <div className="text-[9px] text-faint">repeated lineups — same grenade landing the same spot; ~time is after freeze</div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
            <div className="rounded-lg bg-panel/50 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-faint">Avg kill range</div>
              <div className="text-sm font-bold tabular-nums">{scout.avgKillDist != null ? `~${scout.avgKillDist.toFixed(0)}m` : "—"}</div>
              {lobby.killDist != null && <div className="text-[9px] tabular-nums text-faint">lobby ~{lobby.killDist.toFixed(0)}m</div>}
            </div>
            <div className="rounded-lg bg-panel/50 px-2 py-1.5" title={openN ? `won: ${fmtR(scout.openWon, 8) || "—"}` : undefined}>
              <div className="text-[9px] uppercase tracking-wider text-faint">First duels</div>
              <div className="text-sm font-bold tabular-nums">{openN ? `${scout.openWon.length}/${openN} won` : "—"}</div>
              {lobby.duelWinPct != null && openN > 0 && <div className="text-[9px] tabular-nums text-faint">lobby {lobby.duelWinPct.toFixed(0)}%</div>}
            </div>
            {(() => {
              const pk = scout.postKill;
              const n = pk.reHold + pk.move;
              return (
                <div
                  className="rounded-lg bg-panel/50 px-2 py-1.5"
                  title={n ? `movement in the ~5s after a kill, from 1 Hz samples (${n} kills sampled)${pk.tradedRounds.length ? ` · died ≤5s after a kill: ${fmtR(pk.tradedRounds, 6)}` : ""}` : "no kills with usable follow-up samples"}
                >
                  <div className="text-[9px] uppercase tracking-wider text-faint">After a kill</div>
                  <div className="text-sm font-bold tabular-nums">
                    {n ? `${Math.round((pk.reHold / n) * 100)}% re-hold` : "—"}
                  </div>
                  {pk.tradedRounds.length > 0 && (
                    <div className="text-[9px] tabular-nums text-bad">traded back ×{pk.tradedRounds.length}</div>
                  )}
                </div>
              );
            })()}
          </div>

          {(scout.econ.afterLoss.n >= 3 || scout.econ.afterWin.n >= 3 || scout.econ.pistols.n > 0) && (
            <div className="border-t border-line pt-3">
              <div className="stat-label mb-1.5">Economy reactions</div>
              <div className="space-y-1 text-[11px] text-muted">
                {scout.econ.afterLoss.n >= 3 && (
                  <div title={scout.econ.afterLoss.forceRounds.length ? `forces: ${fmtR(scout.econ.afterLoss.forceRounds, 8)}` : undefined}>
                    <span className="text-faint">after a loss</span>{" "}
                    <span className="tabular-nums">
                      {scout.econ.afterLoss.force > 0 && <span className="text-mid">force {scout.econ.afterLoss.force}/{scout.econ.afterLoss.n}</span>}
                      {scout.econ.afterLoss.force > 0 && (scout.econ.afterLoss.save > 0 || scout.econ.afterLoss.full > 0) && " · "}
                      {scout.econ.afterLoss.save > 0 && <span>save {scout.econ.afterLoss.save}/{scout.econ.afterLoss.n}</span>}
                      {scout.econ.afterLoss.save > 0 && scout.econ.afterLoss.full > 0 && " · "}
                      {scout.econ.afterLoss.full > 0 && <span>full {scout.econ.afterLoss.full}/{scout.econ.afterLoss.n}</span>}
                    </span>
                  </div>
                )}
                {scout.econ.afterWin.n >= 3 && (
                  <div>
                    <span className="text-faint">after a win</span>{" "}
                    <span className="tabular-nums">
                      full {scout.econ.afterWin.full}/{scout.econ.afterWin.n}
                      {scout.econ.afterWin.save > 0 && ` · save ${scout.econ.afterWin.save}/${scout.econ.afterWin.n}`}
                      {scout.econ.afterWin.force > 0 && ` · force ${scout.econ.afterWin.force}/${scout.econ.afterWin.n}`}
                    </span>
                  </div>
                )}
                {scout.econ.pistols.n > 0 && (
                  <div>
                    <span className="text-faint">pistol rounds</span>{" "}
                    <span className="tabular-nums">won {scout.econ.pistols.won} of {scout.econ.pistols.n}</span>
                  </div>
                )}
              </div>
            </div>
          )}

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
              <li key={i} className={`flex gap-2 rounded-lg bg-panel/50 px-3 py-2 ${tip.zone ? "transition hover:bg-panel/80" : ""}`} {...(tip.zone ? zoneHover(tip.zone) : {})}>
                <span className="shrink-0 font-black tabular-nums text-brand text-[12px]">{i + 1}.</span>
                <span className="min-w-0">
                  <span className="block text-[12px] leading-snug text-ink">{tip.text}</span>
                  <span className="mt-1 block text-[10px] leading-snug text-faint">
                    <span className="font-semibold uppercase tracking-wide text-muted/80">evidence</span> · {tip.why}
                    {tip.rounds && tip.rounds.length > 0 && <RoundChips rounds={tip.rounds} />}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-auto border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
            Built from this demo only ({rounds.length} round{rounds.length === 1 ? "" : "s"}) — habits can differ across maps and lobbies. Round chips scope the rest of the workspace (map, Routes, Replay) — the dossier itself always stays match-wide. Positions sample at 1 Hz after freeze; &quot;stationary&quot; means under ~1.3 m/s between samples; grenade timing uses detonation time.
          </p>
        </div>
      </div>
    </section>
  );
}
