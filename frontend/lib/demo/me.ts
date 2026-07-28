// "This is me" — the library's identity + form-over-time layer.
//
// DORMANT: the auto-suggest UI (YourForm on /demos) was pulled by product
// decision (2026-07-27) — identity should come from real user sign-ins, not a
// roster-frequency heuristic. The lib + component + tests stay so the sign-in
// integration can wire straight into them; nothing renders today.
//
// The user marks their steamId once; each saved demo then contributes one
// compact digest of their performance, cached so trends never re-read every
// round blob.

import type { ReplayMeta, ReplayRound } from "./types";
import { teamAStarters } from "./score";

const ME_KEY = "statrun:me";
const digestKey = (demoId: string, steamId: string) => `statrun:digest:${demoId}:${steamId}`;

export interface MeIdentity {
  steamId: string;
  name: string;
}

export function getMe(): MeIdentity | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ME_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as MeIdentity;
    return j && typeof j.steamId === "string" && j.steamId ? j : null;
  } catch {
    return null;
  }
}

export function setMe(id: MeIdentity | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (id) localStorage.setItem(ME_KEY, JSON.stringify(id));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Who is this library's owner, probably? Ranks every roster entry across the
 * saved demos by how many demos they appear in — your own id is in all of
 * them. Sample-demo ids are excluded. Returns candidates sorted best-first
 * with appearance counts.
 */
export function suggestMe(
  summaries: { meta: ReplayMeta }[],
): { steamId: string; name: string; demos: number }[] {
  const seen = new Map<string, { steamId: string; name: string; demos: number }>();
  for (const s of summaries) {
    const once = new Set<string>();
    for (const p of s.meta.players ?? []) {
      if (!p?.steamId || p.steamId.startsWith("sample-") || once.has(p.steamId)) continue;
      once.add(p.steamId);
      const cur = seen.get(p.steamId) ?? { steamId: p.steamId, name: p.name, demos: 0 };
      cur.demos++;
      if (p.name) cur.name = p.name;
      seen.set(p.steamId, cur);
    }
  }
  return [...seen.values()].sort((a, b) => b.demos - a.demos);
}

// One demo's contribution to the trends — everything the form charts need,
// small enough to cache in localStorage.
export interface DemoDigest {
  v: 2; // v1 had inverted matchWon for late connectors + ADR 0 on stats-less parses
  kills: number;
  deaths: number;
  adr: number | null; // null when the parse carries no per-round stats
  hsPct: number; // of kills
  reactionMs: number | null; // avg, when the parse carries aim data
  wins: number; // rounds MY team won
  rounds: number; // rounds I played
  matchWon: boolean | null; // null = tie/unknown
}

/** Compute the identity's digest for one demo; null when they didn't play. */
export function demoDigest(meta: ReplayMeta, rounds: ReplayRound[], steamId: string): DemoDigest | null {
  const idx = meta.players.findIndex((p) => p.steamId === steamId);
  if (idx < 0) return null;
  const teamA = teamAStarters(rounds);
  // Team membership by ROSTER OVERLAP in the first round the player appears —
  // raw round-1 membership inverted matchWon for anyone who connected late.
  let mineA: boolean | null = teamA.size > 0 && teamA.has(idx) ? true : null;
  if (mineA == null && teamA.size > 0) {
    for (const r of rounds) {
      const side = r.ct?.includes(idx) ? "CT" : r.t?.includes(idx) ? "T" : null;
      if (!side) continue;
      const aOnCT = (r.ct ?? []).some((i) => teamA.has(i));
      mineA = (side === "CT") === aOnCT;
      break;
    }
  }
  let kills = 0;
  let deaths = 0;
  let hs = 0;
  let dmg = 0;
  let statN = 0;
  let rctSum = 0;
  let aimN = 0;
  let played = 0;
  let wins = 0;
  let winsA = 0;
  let winsB = 0;
  for (const r of rounds) {
    const side = r.ct?.includes(idx) ? "CT" : r.t?.includes(idx) ? "T" : null;
    if (side) {
      played++;
      if (r.winner === side) wins++;
    }
    const aOnCT = (r.ct ?? []).some((i) => teamA.has(i));
    if (r.winner === "CT" || r.winner === "T") {
      const aWon = aOnCT ? r.winner === "CT" : r.winner === "T";
      if (aWon) winsA++;
      else winsB++;
    }
    for (const k of r.kills ?? []) {
      if (k.k === idx && k.v !== idx) {
        kills++;
        if (k.hs) hs++;
      }
      if (k.v === idx) deaths++;
    }
    const st = (r.stats ?? []).find((s) => s.i === idx);
    if (st) {
      statN++;
      dmg += st.dmg ?? 0;
      if (!r.bots?.includes(idx)) {
        rctSum += st.rctMs ?? 0;
        aimN += st.aimN ?? 0;
      }
    }
  }
  if (!played) return null;
  const myWins = mineA == null ? 0 : mineA ? winsA : winsB;
  const theirWins = mineA == null ? 0 : mineA ? winsB : winsA;
  return {
    v: 2,
    kills,
    deaths,
    // null (not 0) when the parse has no per-round stats — a zero would chart
    // a fake ADR cliff for pre-stats demos, and the cache would keep it
    adr: statN > 0 ? dmg / played : null,
    hsPct: kills ? (hs / kills) * 100 : 0,
    reactionMs: aimN > 0 ? rctSum / aimN : null,
    wins,
    rounds: played,
    matchWon: mineA == null || myWins === theirWins ? null : myWins > theirWins,
  };
}

export function loadDigest(demoId: string, steamId: string): DemoDigest | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(digestKey(demoId, steamId));
    if (!raw) return null;
    const j = JSON.parse(raw) as DemoDigest;
    return j && j.v === 2 ? j : null; // v1 digests recompute (see DemoDigest.v)
  } catch {
    return null;
  }
}

export function saveDigest(demoId: string, steamId: string, d: DemoDigest): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(digestKey(demoId, steamId), JSON.stringify(d));
  } catch {
    /* quota — trends will just recompute next time */
  }
}
