// Cross-demo opponent dossiers — "have I seen this player before?" A steamId
// that recurs across the library gets its history surfaced in the case file:
// per past demo, their K/D + CheatMeter score, so one suspicious game can be
// read against their track record. Results are computed once per
// (demo, player) — the full pipeline (insights + rotations + meter) is heavy —
// and cached in localStorage.

import { listMatches, getMatch } from "./store";
import { computeInsights } from "./insights";
import { analyzeRotations } from "./rotates";
import { demoCheat } from "./cheat";

const KEY = (demoId: string, steamId: string) => `statrun:oppo:${demoId}:${steamId}`;

export interface OpponentSighting {
  demoId: string;
  demoName: string;
  savedAt: number;
  map: string;
  name: string; // their name in THAT demo (smurfs rename)
  kills: number;
  deaths: number;
  adr: number;
  cheatScore: number; // 0-100
  cheatBand: string;
  confidence: number; // meter confidence 0-1
}

interface CachedSighting extends OpponentSighting {
  v: 1;
}

function loadCached(demoId: string, steamId: string): OpponentSighting | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY(demoId, steamId));
    if (!raw) return null;
    const j = JSON.parse(raw) as CachedSighting;
    return j && j.v === 1 ? j : null;
  } catch {
    return null;
  }
}

function saveCached(demoId: string, steamId: string, s: OpponentSighting): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY(demoId, steamId), JSON.stringify({ ...s, v: 1 }));
  } catch {
    /* quota — recomputed next time */
  }
}

/**
 * Every OTHER saved demo this steamId appears in, with their meter + stat line
 * from that game. Sorted oldest → newest so the series reads left to right.
 * Cache-first; only cache misses load a demo's rounds and run the pipeline.
 */
export async function opponentHistory(steamId: string, excludeDemoId: string): Promise<OpponentSighting[]> {
  if (!steamId || steamId.startsWith("sample-")) return [];
  const all = await listMatches().catch(() => []);
  const out: OpponentSighting[] = [];
  for (const s of all) {
    if (s.id === excludeDemoId) continue;
    if (!s.meta.players?.some((p) => p.steamId === steamId)) continue;
    const hit = loadCached(s.id, steamId);
    if (hit) {
      out.push(hit);
      continue;
    }
    const m = await getMatch(s.id).catch(() => null);
    if (!m) continue;
    const insights = computeInsights(m.summary.meta, m.rounds);
    const p = insights.players.find((x) => x.steamId === steamId);
    if (!p) continue;
    const rot = analyzeRotations(m.summary.meta, m.rounds);
    const cheat = demoCheat(p, rot.available ? (rot.byPlayer.get(p.i) ?? null) : null);
    const sighting: OpponentSighting = {
      demoId: s.id,
      demoName: s.name,
      savedAt: s.savedAt,
      map: s.meta.map,
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      adr: p.adr,
      cheatScore: cheat.score,
      cheatBand: cheat.band,
      confidence: cheat.confidence,
    };
    saveCached(s.id, steamId, sighting);
    out.push(sighting);
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}
