// Per-player TACTICAL tendencies derived from positioning/route data — what the
// AI read uses to comment on playstyle (takes empty space vs seeks contact,
// lurking, rotation activity, site preference/predictability). Computed in a
// single pass over the (post-freeze) frames; every frame carries both teams, so
// a player can be compared to live enemies and teammates.

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { buildProjection } from "@/lib/demo/projection";
import { getActiveZones, classifyPosition } from "@/lib/maps/zones";
import { weaponLabel, type PlayerInsight } from "@/lib/demo/insights";

const SNIPERS = /awp|ssg|scar-20|g3sg1|scout/i;

export interface PlayerTendencies {
  steamId: string;
  rounds: number; // rounds with usable post-freeze frames
  spacePct: number; // 0..100 vs match — higher = plays further from enemies (takes space)
  lurkPct: number; // 0..100 vs match — higher = plays further from teammates (lurks)
  rotationsPerRound: number; // avg sustained zone changes per round
  zoneSamples: number; // frames that classified into a zone (0 on uncalibrated maps)
  ct: { a: number; b: number; mid: number }; // occupancy share by side (0..1, A/B/Mid only)
  t: { a: number; b: number; mid: number };
}

type Zoned = "a" | "b" | "mid" | null;
function zoneKey(kind: string | undefined): Zoned {
  if (kind === "A") return "a";
  if (kind === "B") return "b";
  if (kind === "Mid") return "mid";
  return null;
}

export function computeTendencies(
  meta: ReplayMeta,
  rounds: ReplayRound[],
): Map<string, PlayerTendencies> {
  const proj = buildProjection(meta.map, rounds);
  // Zones are calibrated to the real radar; on uncalibrated maps buildProjection
  // auto-scales to the match bbox, so classifying against radar zones would be
  // wrong — skip zone/rotation tendencies there entirely (space/lurk still work).
  const calibrated = proj.calibrated;
  const zones = getActiveZones(meta.map);
  const N = meta.players.length;

  const sumEnemy = new Array(N).fill(0);
  const nEnemy = new Array(N).fill(0);
  const sumMate = new Array(N).fill(0);
  const nMate = new Array(N).fill(0);
  const rotations = new Array(N).fill(0);
  const roundsSeen = new Array(N).fill(0);
  const ct = Array.from({ length: N }, () => ({ a: 0, b: 0, mid: 0, n: 0 }));
  const tt = Array.from({ length: N }, () => ({ a: 0, b: 0, mid: 0, n: 0 }));

  for (const rd of rounds) {
    const frames = rd.frames ?? [];
    const freezeEnd = rd.freezeEnd ?? 15;
    const ctSet = new Set(rd.ct ?? []);
    const seenThisRound = new Set<number>();
    const lastZone = new Map<number, Zoned>();
    const cand = new Map<number, Zoned>(); // candidate next zone (needs to persist)
    const candN = new Map<number, number>();

    for (const f of frames) {
      if (f.t < freezeEnd) continue;
      const alive = f.p.filter((p) => p.h > 0);
      // project once per frame
      const proj2 = alive.map((p) => {
        const r = proj.project(p.x, p.y);
        return r ? { i: p.i, x: r.x, y: r.y, wx: p.x, wy: p.y, ct: ctSet.has(p.i) } : null;
      });
      const pts = proj2.filter((v): v is NonNullable<typeof v> => v != null);
      for (const me of pts) {
        let dE = Infinity;
        let dM = Infinity;
        for (const o of pts) {
          if (o.i === me.i) continue;
          const d = Math.hypot(o.x - me.x, o.y - me.y);
          if (o.ct === me.ct) dM = Math.min(dM, d);
          else dE = Math.min(dE, d);
        }
        if (dE < Infinity) {
          sumEnemy[me.i] += dE;
          nEnemy[me.i]++;
        }
        if (dM < Infinity) {
          sumMate[me.i] += dM;
          nMate[me.i]++;
        }
        // zone occupancy + rotation count — calibrated maps only (radar zones)
        if (calibrated) {
          const z = classifyPosition(meta.map, me.wx, me.wy, zones);
          const zk = zoneKey(z?.kind);
          if (zk) {
            const bucket = me.ct ? ct[me.i] : tt[me.i];
            bucket[zk]++;
            bucket.n++;
            // count a rotation only when a NEW zone is sustained ≥2 samples, so
            // one-frame flicker on anchor seams (at ~1Hz) doesn't inflate it.
            const prev = lastZone.get(me.i);
            if (prev === zk) {
              cand.delete(me.i);
            } else if (cand.get(me.i) === zk) {
              const n = (candN.get(me.i) ?? 1) + 1;
              if (n >= 2) {
                if (prev != null) rotations[me.i]++;
                lastZone.set(me.i, zk);
                cand.delete(me.i);
              } else {
                candN.set(me.i, n);
              }
            } else {
              cand.set(me.i, zk);
              candN.set(me.i, 1);
            }
          }
        }
        seenThisRound.add(me.i);
      }
    }
    for (const i of seenThisRound) roundsSeen[i]++;
  }

  // percentile rank of a value within the set of players who have data
  const pct = (vals: (number | null)[], v: number | null): number => {
    if (v == null) return 50;
    const xs = vals.filter((x): x is number => x != null);
    if (xs.length < 2) return 50;
    const below = xs.filter((x) => x < v).length;
    return Math.round((below / (xs.length - 1)) * 100);
  };

  const avgEnemy = sumEnemy.map((s, i) => (nEnemy[i] ? s / nEnemy[i] : null));
  const avgMate = sumMate.map((s, i) => (nMate[i] ? s / nMate[i] : null));

  const out = new Map<string, PlayerTendencies>();
  for (let i = 0; i < N; i++) {
    if (!roundsSeen[i]) continue;
    const share = (b: { a: number; b: number; mid: number; n: number }) => ({
      a: b.n ? b.a / b.n : 0,
      b: b.n ? b.b / b.n : 0,
      mid: b.n ? b.mid / b.n : 0,
    });
    out.set(meta.players[i].steamId, {
      steamId: meta.players[i].steamId,
      rounds: roundsSeen[i],
      spacePct: pct(avgEnemy, avgEnemy[i]),
      lurkPct: pct(avgMate, avgMate[i]),
      rotationsPerRound: roundsSeen[i] ? rotations[i] / roundsSeen[i] : 0,
      zoneSamples: ct[i].n + tt[i].n,
      ct: share(ct[i]),
      t: share(tt[i]),
    });
  }
  return out;
}

// playstyleSummary turns a player's demo stats + positioning tendencies into
// plain-English, scouting-style lines — for the AI prompt AND the card display.
// Natural wording (no "Nth percentile"), each gated so we don't over-read.
export function playstyleSummary(p: PlayerInsight, t?: PlayerTendencies): string[] {
  const lines: string[] = [];

  // --- positioning / role / movement (from per-frame tendencies) ---
  if (t && t.rounds >= 5) {
    if (t.spacePct >= 70) lines.push("Positioning: plays for space — usually holds away from enemies, rarely takes first contact.");
    else if (t.spacePct <= 25) lines.push("Positioning: plays up front — often the first into contact (entry).");

    if (t.lurkPct >= 75) lines.push("Role: lurker — frequently splits off from the team.");
    else if (t.lurkPct <= 20) lines.push("Role: plays grouped with the team (stacks).");

    if (t.zoneSamples >= 12) {
      if (t.rotationsPerRound >= 1.6) lines.push("Movement: roams — rotates between areas a lot.");
      else if (t.rotationsPerRound <= 0.5) lines.push("Movement: anchor — tends to hold one area.");

      const lean = (side: "CT" | "T", z: { a: number; b: number; mid: number }) => {
        const top = (["a", "b", "mid"] as const).reduce((m, k) => (z[k] > z[m] ? k : m), "a" as "a" | "b" | "mid");
        if (z[top] >= 0.55) {
          const label = top === "mid" ? "Mid" : top.toUpperCase();
          lines.push(`Predictable on ${side}: ${Math.round(z[top] * 100)}% of the time around ${label}.`);
        }
      };
      lean("CT", t.ct);
      lean("T", t.t);
    }
  }

  // --- weapon preference ---
  const fav = p.favoriteWeapons?.[0];
  if (fav && fav.kills >= 3) {
    if (SNIPERS.test(fav.weapon)) lines.push(`Weapon: AWPer — ${fav.kills} sniper kills.`);
    else lines.push(`Weapon: favours the ${weaponLabel(fav.weapon)} (${fav.kills} kills).`);
  }

  // --- economy / buy discipline ---
  const nb = p.buys.eco + p.buys.semi + p.buys.force + p.buys.full;
  if (nb >= 5) {
    const ecoPct = (p.buys.eco + p.buys.semi) / nb; // full saves + half-buys
    const forcePct = p.buys.force / nb;
    if (ecoPct <= 0.12) lines.push("Economy: disciplined — rarely ecos, buys when the team buys.");
    else if (ecoPct >= 0.4) lines.push("Economy: saves a lot — ecos / half-buys frequently.");
    if (forcePct >= 0.3) lines.push("Economy: force-buys often — aggressive with money.");
  }

  // --- entry / opening-duel outcome ---
  if (p.openingAttempts >= 4) {
    if (p.openingWinPct >= 60) lines.push(`Opening duels: strong — wins ${p.openingWinPct.toFixed(0)}% of first contacts.`);
    else if (p.openingWinPct <= 35) lines.push(`Opening duels: shaky — wins only ${p.openingWinPct.toFixed(0)}% of first contacts.`);
  }

  // --- trade discipline ---
  if (p.deaths >= 6 && p.tradeKillPct >= 35) lines.push(`Trading: refrags well — ${p.tradeKillPct.toFixed(0)}% of kills are trades.`);

  return lines;
}
