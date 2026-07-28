// Team-level scouting — the anti-strat reads that live ABOVE one player's
// dossier: who trades whom (the duo structure), and which utility packages the
// team actually runs on T side (site, size, win rate). Teams are the STARTING
// rosters (A = teamAStarters), followed across the halftime swap.

import type { ReplayMeta, ReplayRound } from "./types";
import { teamAStarters } from "./score";
import { classifyPosition, type Zone } from "@/lib/maps/zones";

export interface TradePair {
  avenged: number; // player index who died
  avenger: number; // teammate who killed the killer within the window
  count: number;
}

export interface TeamTrades {
  pairs: TradePair[]; // sorted by count desc
  traded: number; // deaths avenged in-window
  deaths: number; // enemy-inflicted deaths (the denominator)
}

const TRADE_WINDOW = 5; // seconds

/** Who avenges whom, per starting team. */
export function tradePairs(meta: ReplayMeta, rounds: ReplayRound[]): { a: TeamTrades; b: TeamTrades } {
  const teamA = teamAStarters(rounds);
  const mk = (): TeamTrades => ({ pairs: [], traded: 0, deaths: 0 });
  const out = { a: mk(), b: mk() };
  const pairCount = { a: new Map<string, TradePair>(), b: new Map<string, TradePair>() };

  for (const r of rounds) {
    const kills = (r.kills ?? []).filter((k) => k.v >= 0);
    const sideSet = (i: number) => (r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : null);
    kills.forEach((k, idx) => {
      if (k.k < 0 || sideSet(k.k) == null || sideSet(k.v) == null || sideSet(k.k) === sideSet(k.v)) return;
      const team = teamA.has(k.v) ? "a" : "b";
      out[team].deaths++;
      // avenged: a TEAMMATE of the victim kills this killer within the window
      for (let j = idx + 1; j < kills.length; j++) {
        const t = kills[j];
        if (t.t - k.t > TRADE_WINDOW) break;
        if (t.v !== k.k || t.k < 0 || t.k === k.v) continue;
        if (sideSet(t.k) !== sideSet(k.v)) continue;
        out[team].traded++;
        const key = `${k.v}:${t.k}`;
        const m = pairCount[team];
        const cur = m.get(key) ?? { avenged: k.v, avenger: t.k, count: 0 };
        cur.count++;
        m.set(key, cur);
        break; // one trade per death
      }
    });
  }
  out.a.pairs = [...pairCount.a.values()].sort((x, y) => y.count - x.count);
  out.b.pairs = [...pairCount.b.values()].sort((x, y) => y.count - x.count);
  return out;
}

export interface ExecPackage {
  site: "A" | "B" | "Mid";
  count: number;
  wins: number;
  kinds: Record<string, number>; // smoke/flash/molotov/he totals across runs
  rounds: number[]; // round numbers, for citations
}

export interface TeamExecs {
  packages: ExecPackage[]; // sorted by count desc
  tRounds: number; // T-side rounds played (denominator)
}

const normKind = (k: string) => (k === "inferno" || k === "incgrenade" ? "molotov" : k);

/**
 * T-side utility packages per starting team: rounds where the T roster landed
 * 3+ grenades inside a 12 s burst, labeled by the majority SITE (A/B/Mid) of
 * where they landed. `zones` must be the map's call-out set — rounds whose
 * grenades don't classify to a site are skipped, not guessed.
 */
export function execPackages(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  zones: Zone[],
): { a: TeamExecs; b: TeamExecs } {
  const teamA = teamAStarters(rounds);
  const out = { a: { packages: [], tRounds: 0 } as TeamExecs, b: { packages: [], tRounds: 0 } as TeamExecs };
  const acc = { a: new Map<string, ExecPackage>(), b: new Map<string, ExecPackage>() };

  for (const r of rounds) {
    const roster = r.t ?? [];
    if (!roster.length) continue;
    const team = roster.filter((i) => teamA.has(i)).length >= roster.length / 2 ? "a" : "b";
    out[team].tRounds++;
    if (!zones.length) continue;
    const nades = (r.nades ?? []).filter((n) => n.by >= 0 && roster.includes(n.by)).sort((x, y) => x.t - y.t);
    if (nades.length < 3) continue;
    // tightest 3-nade burst start, then absorb everything within 12s of it
    let start = -1;
    for (let i = 0; i + 2 < nades.length; i++) {
      if (nades[i + 2].t - nades[i].t <= 12) {
        start = i;
        break;
      }
    }
    if (start < 0) continue;
    const burst = nades.filter((n) => n.t >= nades[start].t && n.t <= nades[start].t + 12);
    const votes: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    for (const n of burst) {
      kinds[normKind(n.k)] = (kinds[normKind(n.k)] ?? 0) + 1;
      const z = classifyPosition(meta.map, n.x, n.y, zones, n.z);
      if (z && (z.kind === "A" || z.kind === "B" || z.kind === "Mid")) {
        votes[z.kind] = (votes[z.kind] ?? 0) + 1;
      }
    }
    const site = (Object.entries(votes).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null) as ExecPackage["site"] | null;
    if (!site) continue; // nothing classified — don't guess
    const m = acc[team];
    const cur = m.get(site) ?? { site, count: 0, wins: 0, kinds: {}, rounds: [] };
    cur.count++;
    if (r.winner === "T") cur.wins++;
    for (const [k, n] of Object.entries(kinds)) cur.kinds[k] = (cur.kinds[k] ?? 0) + n;
    cur.rounds.push(r.n);
    m.set(site, cur);
  }
  out.a.packages = [...acc.a.values()].sort((x, y) => y.count - x.count);
  out.b.packages = [...acc.b.values()].sort((x, y) => y.count - x.count);
  return out;
}
