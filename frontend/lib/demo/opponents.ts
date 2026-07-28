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
 * Cache-first; a cache miss loads that demo's rounds ONCE and caches a
 * sighting for EVERY player in it (the pipeline is the cost — one run serves
 * all ten suspects instead of re-running per case file). `shouldContinue`
 * lets the caller abandon the loop when the case file unmounts or switches.
 */
export async function opponentHistory(
  steamId: string,
  excludeDemoId: string,
  shouldContinue: () => boolean = () => true,
): Promise<OpponentSighting[]> {
  if (!steamId || steamId.startsWith("sample-")) return [];
  const all = await listMatches().catch(() => []);
  const out: OpponentSighting[] = [];
  for (const s of all) {
    if (!shouldContinue()) break;
    if (s.id === excludeDemoId) continue;
    if (!s.meta.players?.some((p) => p.steamId === steamId)) continue;
    const hit = loadCached(s.id, steamId);
    if (hit) {
      // the summary bits are mutable (rename) — refresh them as we serve
      out.push({ ...hit, demoName: s.name, savedAt: s.savedAt });
      continue;
    }
    const m = await getMatch(s.id).catch(() => null);
    if (!m) continue;
    const insights = computeInsights(m.summary.meta, m.rounds);
    const rot = analyzeRotations(m.summary.meta, m.rounds);
    for (const p of insights.players) {
      if (!p.steamId || p.steamId.startsWith("sample-")) continue;
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
      saveCached(s.id, p.steamId, sighting);
      if (p.steamId === steamId) out.push(sighting);
    }
    // yield between heavy demos so the case-file UI stays responsive
    await new Promise((r) => setTimeout(r, 0));
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}
