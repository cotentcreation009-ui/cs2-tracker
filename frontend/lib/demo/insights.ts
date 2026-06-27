// Player Insights — behavioral analysis re-derived entirely from §5 replay data.
//
// The old csgomap implementation (analysis.ts) leaned on per-tick weapon_fire,
// util_damage, flash_blind, economy and a hand-authored map-zone database. We
// have NONE of that. Everything below is reconstructed from the three streams we
// actually capture per round: kills, 1 Hz positions (frames), and grenade lands
// (nades). Gaps are documented in PLAYER_INSIGHTS_LIMITATIONS and surfaced in
// the UI so numbers are never silently fabricated.

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";

export interface MultiKillTally { k2: number; k3: number; k4: number; k5: number; }

export interface AreaTendency {
  a: number; b: number; mid: number; rounds: number;
}

export interface FavoriteWeapon { weapon: string; kills: number; }

export interface PlayerInsight {
  i: number; steamId: string; name: string; team: "CT" | "T" | ""; roundsPlayed: number;
  kills: number; deaths: number; assistsApprox: number; kd: number; kpr: number;
  headshots: number; hsPct: number;
  openingKills: number; openingDeaths: number; openingAttempts: number; openingWinPct: number;
  tradeKills: number; tradedDeaths: number; tradeKillPct: number;
  multiKills: MultiKillTally; multiKillRounds: number;
  favoriteWeapons: FavoriteWeapon[]; area: AreaTendency;
  adr: number; utilDamage: number; enemiesFlashed: number; flashDuration: number;
  utilThrown: { smoke: number; molotov: number; flash: number; he: number; decoy: number; total: number };
  buys: { pistol: number; eco: number; force: number; full: number };
  utilNades: UtilThrow[]; // every grenade this player threw (for the map view)
}

// One grenade landing, attributed to a thrower — used to plot a player's utility
// on the radar (and animate the throw → bloom) and spot repeated setups.
export interface UtilThrow {
  kind: string; // smoke | molotov | flash | he | decoy
  x: number; // landing position
  y: number;
  ox: number; // thrower's position at throw time (arc origin)
  oy: number;
  t: number; // seconds since round start
  round: number;
}

// A cluster of one player's throws of a kind that land near the same spot — the
// core of "they smoke here every round". cx/cy are world-space (so callers can
// classify the landing into a zone); avgT is seconds since round start.
export interface UtilSpot {
  kind: string;
  cx: number;
  cy: number;
  count: number;
  avgT: number;
  throws: UtilThrow[]; // members, sorted by round
}

export interface SiteAnchor {
  a: { x: number; y: number } | null; b: { x: number; y: number } | null; center: { x: number; y: number };
}

export interface TeamUtil {
  smoke: number; molotov: number; flash: number; he: number; decoy: number; total: number; perRound: number;
}

export interface InsightsResult {
  players: PlayerInsight[]; util: TeamUtil; siteAnchor: SiteAnchor; totalRounds: number; map: string;
}

const TRADE_WINDOW = 5; // seconds

export const PLAYER_INSIGHTS_LIMITATIONS = [
  "ADR is enemy health-damage per round; it can differ slightly from official (no per-hit overkill cap).",
  "Flash stats are enemies blinded + blind-seconds dealt, not flash-assists (we don't tie a flash to a teammate's kill).",
  "Assists are a trade-proximity proxy (our data has no assist event).",
  "Economy is a coarse equipment-value bucket (pistol / eco / force / full), not real money or a full loadout.",
  "Map areas (A / B / Mid) are inferred from observed bomb-plant spots — directional, not named zones. Clutch / 1vX needs per-tick data we don't capture.",
  "Grenades whose thrower the demo didn't record are counted in match totals but can't be attributed to a player on the map.",
].join(" ");

const sideOf = (r: ReplayRound, i: number, meta: ReplayMeta): "CT" | "T" | "" => {
  if (r.ct?.includes(i)) return "CT";
  if (r.t?.includes(i)) return "T";
  return meta.players[i]?.team ?? "";
};

const WEAPON_NAMES: Record<string, string> = {
  ak47: "AK-47", m4a1: "M4A4", m4a1_silencer: "M4A1-S", m4a4: "M4A4",
  awp: "AWP", deagle: "Desert Eagle", glock: "Glock-18", usp_silencer: "USP-S",
  hkp2000: "P2000", p250: "P250", famas: "FAMAS", galilar: "Galil AR",
  ssg08: "SSG 08", aug: "AUG", sg556: "SG 553", sg553: "SG 553",
  mp9: "MP9", mac10: "MAC-10", mp7: "MP7", ump45: "UMP-45", p90: "P90",
  bizon: "PP-Bizon", mp5sd: "MP5-SD", nova: "Nova", xm1014: "XM1014",
  mag7: "MAG-7", sawedoff: "Sawed-Off", m249: "M249", negev: "Negev",
  cz75a: "CZ75-Auto", tec9: "Tec-9", fiveseven: "Five-SeveN", revolver: "R8 Revolver",
  elite: "Dual Berettas", knife: "Knife", hegrenade: "HE Grenade",
  inferno: "Molotov", molotov: "Molotov", incgrenade: "Incendiary",
  scar20: "SCAR-20", g3sg1: "G3SG1", taser: "Zeus",
};

export function weaponLabel(w: string): string {
  if (!w) return "Unknown";
  const key = w.toLowerCase().replace(/^weapon_/, "");
  if (WEAPON_NAMES[key]) return WEAPON_NAMES[key];
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// deriveSiteAnchor: split observed bomb-plant positions about their mean X into
// two side centroids (a rough A/B), and a map center from average kill positions.
function deriveSiteAnchor(rounds: ReplayRound[]): SiteAnchor {
  const plants: { x: number; y: number }[] = [];
  let cx = 0, cy = 0, cn = 0;
  for (const r of rounds) {
    for (const b of r.bomb ?? []) {
      if (b.k === "plant" || b.k === "plant_start") plants.push({ x: b.x, y: b.y });
    }
    for (const k of r.kills ?? []) { cx += k.vx; cy += k.vy; cn++; }
  }
  const center = cn ? { x: cx / cn, y: cy / cn } : { x: 0, y: 0 };
  if (plants.length < 2) {
    return { a: plants[0] ?? null, b: null, center };
  }
  const mx = plants.reduce((s, p) => s + p.x, 0) / plants.length;
  const left = plants.filter((p) => p.x <= mx);
  const right = plants.filter((p) => p.x > mx);
  const mean = (g: { x: number; y: number }[]) =>
    g.length ? { x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length } : null;
  return { a: mean(left), b: mean(right), center };
}

const d2 = (ax: number, ay: number, bx: number, by: number) =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

// throwOrigin finds a player's position closest to time t in a round — the
// visual origin of a grenade arc (where it was thrown from). Shared by every
// lens that draws utility so they can all show origin → landing.
export function throwOrigin(
  r: ReplayRound,
  idx: number,
  t: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDt = Infinity;
  for (const f of r.frames ?? []) {
    const p = f.p.find((pp) => pp.i === idx);
    if (!p) continue;
    const dt = Math.abs(f.t - t);
    if (dt < bestDt) {
      bestDt = dt;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}

// clusterUtilThrows groups throws (typically one kind) by landing proximity in
// radar-normalized space, surfacing "this exact spot, N times". `project` maps
// world→0..1 (pass buildProjection().project); `threshold` is the max normalized
// distance to join a cluster (~7% of the radar). Sorted by count desc.
export function clusterUtilThrows(
  throws: UtilThrow[],
  project: (x: number, y: number) => { x: number; y: number } | null,
  threshold = 0.07,
): UtilSpot[] {
  const clusters: { nx: number; ny: number; members: UtilThrow[] }[] = [];
  for (const tw of throws) {
    const n = project(tw.x, tw.y);
    if (!n) {
      clusters.push({ nx: Number.POSITIVE_INFINITY, ny: 0, members: [tw] });
      continue;
    }
    let best: (typeof clusters)[number] | null = null;
    let bestD = threshold;
    for (const c of clusters) {
      const d = Math.hypot(c.nx - n.x, c.ny - n.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      best.members.push(tw);
      const k = best.members.length;
      best.nx = (best.nx * (k - 1) + n.x) / k;
      best.ny = (best.ny * (k - 1) + n.y) / k;
    } else {
      clusters.push({ nx: n.x, ny: n.y, members: [tw] });
    }
  }
  return clusters
    .map((c) => {
      const members = c.members.slice().sort((a, b) => a.round - b.round);
      return {
        kind: members[0].kind,
        cx: members.reduce((s, m) => s + m.x, 0) / members.length,
        cy: members.reduce((s, m) => s + m.y, 0) / members.length,
        count: members.length,
        avgT: members.reduce((s, m) => s + m.t, 0) / members.length,
        throws: members,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function computeInsights(meta: ReplayMeta, rounds: ReplayRound[]): InsightsResult {
  const anchor = deriveSiteAnchor(rounds);
  const util: TeamUtil = { smoke: 0, molotov: 0, flash: 0, he: 0, decoy: 0, total: 0, perRound: 0 };

  interface Acc {
    rounds: number; kills: number; deaths: number; hs: number; assists: number;
    openK: number; openD: number; tradeK: number; tradedD: number;
    mk: MultiKillTally; mkRounds: number; weapons: Map<string, number>;
    a: number; b: number; mid: number; areaRounds: number;
    dmg: number; utilDmg: number; flashed: number; flashDur: number;
    util: { smoke: number; molotov: number; flash: number; he: number; decoy: number };
    buys: { pistol: number; eco: number; force: number; full: number };
    nadeList: UtilThrow[];
  }
  const acc = new Map<number, Acc>();
  const get = (i: number): Acc => {
    let a = acc.get(i);
    if (!a) {
      a = { rounds: 0, kills: 0, deaths: 0, hs: 0, assists: 0, openK: 0, openD: 0,
        tradeK: 0, tradedD: 0, mk: { k2: 0, k3: 0, k4: 0, k5: 0 }, mkRounds: 0,
        weapons: new Map(), a: 0, b: 0, mid: 0, areaRounds: 0,
        dmg: 0, utilDmg: 0, flashed: 0, flashDur: 0,
        util: { smoke: 0, molotov: 0, flash: 0, he: 0, decoy: 0 },
        buys: { pistol: 0, eco: 0, force: 0, full: 0 }, nadeList: [] };
      acc.set(i, a);
    }
    return a;
  };

  for (const r of rounds) {
    // who played this round (on a side)
    const onSide = new Set<number>([...(r.ct ?? []), ...(r.t ?? [])]);
    for (const i of onSide) get(i).rounds++;

    const kills = [...(r.kills ?? [])].sort((x, y) => x.t - y.t);

    // opening duel = first real kill of the round
    const opener = kills.find((k) => k.k >= 0 && k.v >= 0);
    if (opener) {
      if (opener.k >= 0) get(opener.k).openK++;
      if (opener.v >= 0) get(opener.v).openD++;
    }

    // per-round kill tallies (for multikills + weapons + hs)
    const perRoundKills = new Map<number, number>();
    for (const k of kills) {
      if (k.k >= 0) {
        const a = get(k.k);
        a.kills++;
        if (k.hs) a.hs++;
        a.weapons.set(k.w, (a.weapons.get(k.w) ?? 0) + 1);
        perRoundKills.set(k.k, (perRoundKills.get(k.k) ?? 0) + 1);
      }
      if (k.v >= 0) get(k.v).deaths++;
    }
    for (const [i, n] of perRoundKills) {
      const a = get(i);
      if (n >= 2) a.mkRounds++;
      if (n === 2) a.mk.k2++;
      else if (n === 3) a.mk.k3++;
      else if (n === 4) a.mk.k4++;
      else if (n >= 5) a.mk.k5++;
    }

    // trades: a kill avenging a teammate killed by the same victim within window
    for (const k of kills) {
      if (k.k < 0 || k.v < 0) continue;
      const killerSide = sideOf(r, k.k, meta);
      const avenged = kills.some(
        (p) => p !== k && p.k === k.v && p.v >= 0 &&
          sideOf(r, p.v, meta) === killerSide && k.t - p.t >= 0 && k.t - p.t <= TRADE_WINDOW,
      );
      if (avenged) {
        get(k.k).tradeK++;
        get(k.k).assists++; // proximity proxy
      }
    }
    for (const k of kills) {
      if (k.v < 0 || k.k < 0) continue;
      const victimSide = sideOf(r, k.v, meta);
      const traded = kills.some(
        (p) => p !== k && p.v === k.k && p.k >= 0 &&
          sideOf(r, p.k, meta) === victimSide && p.t - k.t >= 0 && p.t - k.t <= TRADE_WINDOW,
      );
      if (traded) get(k.v).tradedD++;
    }

    // area lean: each player's mean position this round -> nearest anchor
    if (anchor.a || anchor.b) {
      const sum = new Map<number, { x: number; y: number; n: number }>();
      for (const f of r.frames ?? []) for (const p of f.p) {
        if (p.h <= 0) continue;
        const s = sum.get(p.i) ?? { x: 0, y: 0, n: 0 };
        s.x += p.x; s.y += p.y; s.n++; sum.set(p.i, s);
      }
      for (const [i, s] of sum) {
        if (!s.n) continue;
        const px = s.x / s.n, py = s.y / s.n;
        const da = anchor.a ? d2(px, py, anchor.a.x, anchor.a.y) : Infinity;
        const db = anchor.b ? d2(px, py, anchor.b.x, anchor.b.y) : Infinity;
        const dc = d2(px, py, anchor.center.x, anchor.center.y);
        const a = get(i); a.areaRounds++;
        if (dc <= da && dc <= db) a.mid++;
        else if (da <= db) a.a++;
        else a.b++;
      }
    }

    // per-player aggregates (economy, damage, flashes) from this round's stats
    for (const s of r.stats ?? []) {
      const a = get(s.i);
      a.dmg += s.dmg ?? 0;
      a.utilDmg += s.utilDmg ?? 0;
      a.flashed += s.flashed ?? 0;
      a.flashDur += s.flashDur ?? 0;
      if (s.buy === "pistol") a.buys.pistol++;
      else if (s.buy === "eco") a.buys.eco++;
      else if (s.buy === "force") a.buys.force++;
      else if (s.buy === "full") a.buys.full++;
    }

    // utility — match-wide totals + per-thrower attribution (nade.by) + the
    // landing position so the UI can plot a player's throws on the map.
    for (const n of r.nades ?? []) {
      util.total++;
      const a = n.by >= 0 ? get(n.by) : null;
      let kind = "";
      if (n.k === "smoke") { util.smoke++; kind = "smoke"; if (a) a.util.smoke++; }
      else if (n.k === "molotov" || n.k === "inferno" || n.k === "incgrenade") { util.molotov++; kind = "molotov"; if (a) a.util.molotov++; }
      else if (n.k === "flash") { util.flash++; kind = "flash"; if (a) a.util.flash++; }
      else if (n.k === "he") { util.he++; kind = "he"; if (a) a.util.he++; }
      else if (n.k === "decoy") { util.decoy++; kind = "decoy"; if (a) a.util.decoy++; }
      if (a && kind) {
        const o = throwOrigin(r, n.by, n.t);
        a.nadeList.push({
          kind, x: n.x, y: n.y, round: r.n, t: n.t,
          ox: o?.x ?? n.x, oy: o?.y ?? n.y,
        });
      }
    }
  }
  util.perRound = rounds.length ? util.total / rounds.length : 0;

  const players: PlayerInsight[] = [];
  for (const [i, a] of acc) {
    const pl = meta.players[i];
    if (!pl) continue;
    const favoriteWeapons = [...a.weapons.entries()]
      .sort((x, y) => y[1] - x[1]).slice(0, 4)
      .map(([weapon, kills]) => ({ weapon, kills }));
    players.push({
      i, steamId: pl.steamId, name: pl.name || `Player ${i}`, team: pl.team,
      roundsPlayed: a.rounds, kills: a.kills, deaths: a.deaths, assistsApprox: a.assists,
      kd: a.deaths ? a.kills / a.deaths : a.kills, kpr: a.rounds ? a.kills / a.rounds : 0,
      headshots: a.hs, hsPct: a.kills ? (a.hs / a.kills) * 100 : 0,
      openingKills: a.openK, openingDeaths: a.openD, openingAttempts: a.openK + a.openD,
      openingWinPct: a.openK + a.openD ? (a.openK / (a.openK + a.openD)) * 100 : 0,
      tradeKills: a.tradeK, tradedDeaths: a.tradedD,
      tradeKillPct: a.kills ? (a.tradeK / a.kills) * 100 : 0,
      multiKills: a.mk, multiKillRounds: a.mkRounds, favoriteWeapons,
      area: { a: a.a, b: a.b, mid: a.mid, rounds: a.areaRounds },
      adr: a.rounds ? a.dmg / a.rounds : 0,
      utilDamage: a.utilDmg, enemiesFlashed: a.flashed, flashDuration: a.flashDur,
      utilThrown: {
        ...a.util,
        total: a.util.smoke + a.util.molotov + a.util.flash + a.util.he + a.util.decoy,
      },
      buys: a.buys,
      utilNades: a.nadeList,
    });
  }
  players.sort((x, y) => y.kills - x.kills);

  return { players, util, siteAnchor: anchor, totalRounds: rounds.length, map: meta.map };
}
