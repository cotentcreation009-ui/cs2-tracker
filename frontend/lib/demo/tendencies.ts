// Per-player TACTICAL tendencies derived from positioning/route data — what the
// AI read uses to comment on playstyle (takes empty space vs seeks contact,
// lurking, rotation activity, site preference/predictability). Computed in a
// single pass over the (post-freeze) frames; every frame carries both teams, so
// a player can be compared to live enemies and teammates.

import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { buildProjection } from "@/lib/demo/projection";
import { getActiveZones, classifyPosition } from "@/lib/maps/zones";

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

// tendencySummary turns tendencies into compact, pre-interpreted lines for the AI
// prompt. Gated on a usable sample so we don't over-read tiny demos.
export function tendencySummary(t: PlayerTendencies | undefined): string[] {
  if (!t || t.rounds < 5) return [];
  const lines: string[] = [];

  if (t.spacePct >= 70) lines.push(`Positioning: takes uncontested space — ${t.spacePct}th pct distance from enemies (avoids early contact).`);
  else if (t.spacePct <= 30) lines.push(`Positioning: seeks contact — only ${t.spacePct}th pct distance from enemies (often first to engage).`);

  if (t.lurkPct >= 75) lines.push(`Role: lurker — plays detached from the team (${t.lurkPct}th pct distance from teammates).`);
  else if (t.lurkPct <= 25) lines.push(`Role: plays tight with the team (stacks).`);

  // Zone-derived lines only when we actually classified zones (calibrated map
  // with samples) — otherwise 0 rotations would falsely read as "anchors".
  if (t.zoneSamples >= 12) {
    if (t.rotationsPerRound >= 1.6) lines.push(`Movement: rotates a lot (${t.rotationsPerRound.toFixed(1)} zone changes/round) — roams the map.`);
    else if (t.rotationsPerRound <= 0.5) lines.push(`Movement: holds position (${t.rotationsPerRound.toFixed(1)} zone changes/round) — anchors.`);

    const lean = (side: "ct" | "t", z: { a: number; b: number; mid: number }) => {
      const top = (["a", "b", "mid"] as const).reduce((m, k) => (z[k] > z[m] ? k : m), "a" as "a" | "b" | "mid");
      const share = z[top];
      if (share >= 0.55) {
        const label = top === "mid" ? "Mid" : top.toUpperCase();
        lines.push(`Site lean (${side.toUpperCase()}): ${Math.round(share * 100)}% ${label} — predictable.`);
      }
    };
    lean("ct", t.ct);
    lean("t", t.t);
  }

  return lines;
}
