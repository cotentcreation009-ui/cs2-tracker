// Weapon Insights — derived purely from §5 kill events (ReplayRound.kills).
//
// The original csgomap "WeaponInsights" was built on per-player *purchase*
// events plus a per-round economy classification (eco / pistol). Our replay
// model captures neither weapon_fire, damage, nor economy, so a faithful
// loadout/eco view is impossible. Instead we re-derive an equivalent picture
// from the only weapon signal we do have: who killed whom, with what weapon,
// and whether it was a headshot. This yields a kill-driven weapon meta:
// per-weapon kill counts + headshot %, weapon-class mix, and the same data
// sliced per player (their personal weapon breakdown + HS%).

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";

export type WeaponClass = "rifle" | "sniper" | "smg" | "pistol" | "heavy" | "other";

export interface WeaponMeta {
  /** canonical key from the demo (e.g. "ak47") */
  key: string;
  label: string;
  color: string;
  cls: WeaponClass;
}

// Display catalogue. Anything not listed falls back to a humanised label and a
// neutral colour, and is classed "other".
const CATALOG: Record<string, Omit<WeaponMeta, "key">> = {
  ak47: { label: "AK-47", color: "#f5694a", cls: "rifle" },
  m4a1: { label: "M4A1-S", color: "#38d6ff", cls: "rifle" },
  m4a1_silencer: { label: "M4A1-S", color: "#38d6ff", cls: "rifle" },
  m4a4: { label: "M4A4", color: "#5b9dff", cls: "rifle" },
  awp: { label: "AWP", color: "#46d369", cls: "sniper" },
  ssg08: { label: "SSG 08", color: "#7ee0a0", cls: "sniper" },
  scar20: { label: "SCAR-20", color: "#a0e0c0", cls: "sniper" },
  g3sg1: { label: "G3SG1", color: "#a0e0c0", cls: "sniper" },
  aug: { label: "AUG", color: "#6aa9ff", cls: "rifle" },
  sg556: { label: "SG 553", color: "#ff8a5b", cls: "rifle" },
  sg553: { label: "SG 553", color: "#ff8a5b", cls: "rifle" },
  famas: { label: "FAMAS", color: "#8a7dff", cls: "rifle" },
  galilar: { label: "Galil AR", color: "#f59e42", cls: "rifle" },
  deagle: { label: "Desert Eagle", color: "#f5b942", cls: "pistol" },
  revolver: { label: "R8 Revolver", color: "#f5d142", cls: "pistol" },
  glock: { label: "Glock-18", color: "#e7b53c", cls: "pistol" },
  hkp2000: { label: "P2000", color: "#38d6ff", cls: "pistol" },
  usp_silencer: { label: "USP-S", color: "#5bd6ff", cls: "pistol" },
  p2000: { label: "P2000", color: "#38d6ff", cls: "pistol" },
  fiveseven: { label: "Five-SeveN", color: "#46d3c0", cls: "pistol" },
  tec9: { label: "Tec-9", color: "#f5694a", cls: "pistol" },
  cz75a: { label: "CZ75-Auto", color: "#ff9a5b", cls: "pistol" },
  p250: { label: "P250", color: "#8a7dff", cls: "pistol" },
  elite: { label: "Dual Berettas", color: "#c77dff", cls: "pistol" },
  mac10: { label: "MAC-10", color: "#ec5b9d", cls: "smg" },
  mp9: { label: "MP9", color: "#8a7dff", cls: "smg" },
  mp7: { label: "MP7", color: "#7d9dff", cls: "smg" },
  mp5sd: { label: "MP5-SD", color: "#7d9dff", cls: "smg" },
  ump45: { label: "UMP-45", color: "#b07dff", cls: "smg" },
  p90: { label: "P90", color: "#ff5bd6", cls: "smg" },
  bizon: { label: "PP-Bizon", color: "#c05bff", cls: "smg" },
  nova: { label: "Nova", color: "#9bb0c8", cls: "heavy" },
  xm1014: { label: "XM1014", color: "#b0c0d0", cls: "heavy" },
  mag7: { label: "MAG-7", color: "#a0b8d0", cls: "heavy" },
  sawedoff: { label: "Sawed-Off", color: "#90a8c0", cls: "heavy" },
  m249: { label: "M249", color: "#c0d0e0", cls: "heavy" },
  negev: { label: "Negev", color: "#d0e0f0", cls: "heavy" },
  taser: { label: "Zeus x27", color: "#f5d142", cls: "other" },
  knife: { label: "Knife", color: "#93b6d8", cls: "other" },
  hegrenade: { label: "HE Grenade", color: "#f5b942", cls: "other" },
  inferno: { label: "Molotov", color: "#f5694a", cls: "other" },
  molotov: { label: "Molotov", color: "#f5694a", cls: "other" },
  flashbang: { label: "Flashbang", color: "#e3f2ff", cls: "other" },
  decoy: { label: "Decoy", color: "#5a7aa3", cls: "other" },
  smokegrenade: { label: "Smoke", color: "#93b6d8", cls: "other" },
};

const CLASS_LABEL: Record<WeaponClass, string> = {
  rifle: "Rifles",
  sniper: "Snipers",
  smg: "SMGs",
  pistol: "Pistols",
  heavy: "Heavy",
  other: "Other",
};

const CLASS_COLOR: Record<WeaponClass, string> = {
  rifle: "#f5694a",
  sniper: "#46d369",
  smg: "#8a7dff",
  pistol: "#f5b942",
  heavy: "#9bb0c8",
  other: "#5a7aa3",
};

export function classLabel(c: WeaponClass): string {
  return CLASS_LABEL[c];
}
export function classColor(c: WeaponClass): string {
  return CLASS_COLOR[c];
}

/** Normalise a raw demo weapon string into our catalogue key. */
function normKey(raw: string): string {
  let k = (raw || "").toLowerCase().trim();
  if (k.startsWith("weapon_")) k = k.slice(7);
  // strip a leading knife_* variants down to a single "knife"
  if (k.startsWith("knife") || k === "bayonet" || k.endsWith("_knife")) return "knife";
  return k;
}

const sideOfKiller = (
  r: ReplayRound,
  i: number,
  meta: ReplayMeta,
): "CT" | "T" | "" => {
  if (r.ct?.includes(i)) return "CT";
  if (r.t?.includes(i)) return "T";
  return meta.players[i]?.team ?? "";
};

export function weaponMeta(raw: string): WeaponMeta {
  const key = normKey(raw);
  const hit = CATALOG[key];
  if (hit) return { key, ...hit };
  const label = key
    ? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown";
  return { key: key || "unknown", label, color: "#5a7aa3", cls: "other" };
}

export interface WeaponStat {
  key: string;
  label: string;
  color: string;
  cls: WeaponClass;
  kills: number;
  headshots: number;
  hsPct: number; // 0..100
}

export interface ClassStat {
  cls: WeaponClass;
  label: string;
  color: string;
  kills: number;
  pct: number; // 0..100 of categorised kills
}

export interface PlayerWeaponStat {
  i: number; // index into meta.players
  name: string;
  team: "CT" | "T" | "";
  totalKills: number;
  headshots: number;
  hsPct: number; // 0..100
  weapons: WeaponStat[]; // sorted desc by kills
  topWeapon: WeaponStat | null;
  favClass: WeaponClass | null;
}

export interface WeaponInsightsData {
  totalKills: number;
  totalHeadshots: number;
  overallHsPct: number; // 0..100
  weapons: WeaponStat[]; // sorted desc by kills
  classes: ClassStat[]; // sorted desc by kills
  players: PlayerWeaponStat[]; // sorted desc by total kills
  topWeapon: WeaponStat | null;
  topHsWeapon: WeaponStat | null; // most headshot-prone weapon (min 4 kills)
  deadliestPlayer: PlayerWeaponStat | null;
  rounds: number;
}

interface Acc {
  kills: number;
  headshots: number;
}

const EMPTY: WeaponInsightsData = {
  totalKills: 0,
  totalHeadshots: 0,
  overallHsPct: 0,
  weapons: [],
  classes: [],
  players: [],
  topWeapon: null,
  topHsWeapon: null,
  deadliestPlayer: null,
  rounds: 0,
};

function statFrom(key: string, a: Acc): WeaponStat {
  const m = weaponMeta(key);
  return {
    key: m.key,
    label: m.label,
    color: m.color,
    cls: m.cls,
    kills: a.kills,
    headshots: a.headshots,
    hsPct: a.kills ? (a.headshots / a.kills) * 100 : 0,
  };
}

/**
 * Aggregate all weapon insight data from the kill events of the supplied
 * rounds. Pure — call inside useMemo. `roundFilter` lets the UI scope to a
 * single round (or any subset) by round index.
 */
export function computeWeaponInsights(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  roundFilter?: (r: ReplayRound, idx: number) => boolean,
  side: "all" | "CT" | "T" = "all",
): WeaponInsightsData {
  if (!meta || !rounds?.length) return EMPTY;

  const overall = new Map<string, Acc>();
  const byClass = new Map<WeaponClass, Acc>();
  const perPlayer = new Map<number, { total: Acc; weapons: Map<string, Acc> }>();
  let totalKills = 0;
  let totalHeadshots = 0;
  let usedRounds = 0;

  rounds.forEach((r, idx) => {
    if (roundFilter && !roundFilter(r, idx)) return;
    usedRounds++;
    for (const k of r.kills ?? []) {
      if (k.k < 0) continue; // no killer (e.g. suicide / world) — skip weapon credit
      if (side !== "all" && sideOfKiller(r, k.k, meta) !== side) continue;
      const m = weaponMeta(k.w);
      const hs = k.hs ? 1 : 0;
      totalKills++;
      totalHeadshots += hs;

      const o = overall.get(m.key) ?? { kills: 0, headshots: 0 };
      o.kills++;
      o.headshots += hs;
      overall.set(m.key, o);

      const c = byClass.get(m.cls) ?? { kills: 0, headshots: 0 };
      c.kills++;
      c.headshots += hs;
      byClass.set(m.cls, c);

      let pp = perPlayer.get(k.k);
      if (!pp) {
        pp = { total: { kills: 0, headshots: 0 }, weapons: new Map() };
        perPlayer.set(k.k, pp);
      }
      pp.total.kills++;
      pp.total.headshots += hs;
      const pw = pp.weapons.get(m.key) ?? { kills: 0, headshots: 0 };
      pw.kills++;
      pw.headshots += hs;
      pp.weapons.set(m.key, pw);
    }
  });

  if (totalKills === 0) return { ...EMPTY, rounds: usedRounds };

  const weapons = [...overall.entries()]
    .map(([key, a]) => statFrom(key, a))
    .sort((x, y) => y.kills - x.kills || y.hsPct - x.hsPct);

  const classes: ClassStat[] = [...byClass.entries()]
    .map(([cls, a]) => ({
      cls,
      label: CLASS_LABEL[cls],
      color: CLASS_COLOR[cls],
      kills: a.kills,
      pct: (a.kills / totalKills) * 100,
    }))
    .sort((x, y) => y.kills - x.kills);

  const players: PlayerWeaponStat[] = [...perPlayer.entries()]
    .map(([i, pp]) => {
      const ws = [...pp.weapons.entries()]
        .map(([key, a]) => statFrom(key, a))
        .sort((x, y) => y.kills - x.kills || y.hsPct - x.hsPct);
      // favourite class by kills
      const cm = new Map<WeaponClass, number>();
      for (const w of ws) cm.set(w.cls, (cm.get(w.cls) ?? 0) + w.kills);
      let favClass: WeaponClass | null = null;
      let favN = -1;
      for (const [cls, n] of cm) if (n > favN) ((favN = n), (favClass = cls));
      const player = meta.players[i];
      return {
        i,
        name: player?.name ?? `Player ${i}`,
        team: player?.team ?? "",
        totalKills: pp.total.kills,
        headshots: pp.total.headshots,
        hsPct: pp.total.kills ? (pp.total.headshots / pp.total.kills) * 100 : 0,
        weapons: ws,
        topWeapon: ws[0] ?? null,
        favClass,
      };
    })
    .sort((x, y) => y.totalKills - x.totalKills);

  const topHsWeapon =
    [...weapons]
      .filter((w) => w.kills >= 4)
      .sort((x, y) => y.hsPct - x.hsPct || y.kills - x.kills)[0] ?? null;

  return {
    totalKills,
    totalHeadshots,
    overallHsPct: (totalHeadshots / totalKills) * 100,
    weapons,
    classes,
    players,
    topWeapon: weapons[0] ?? null,
    topHsWeapon,
    deadliestPlayer: players[0] ?? null,
    rounds: usedRounds,
  };
}