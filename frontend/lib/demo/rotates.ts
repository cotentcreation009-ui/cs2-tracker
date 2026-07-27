// Rotation analysis — the radar-hack tell reconstructed from §5 replay data.
//
// A legitimate player only crosses the map in response to INFORMATION: a kill
// on the feed, enemy utility detonating, bomb activity, or an enemy getting
// close enough to a living teammate to be seen or heard. A player reading a
// radar/wallhack rotates in response to HIDDEN state — they leave B for A
// moments after the attackers commit to A, before any of that information
// exists. GOTV demos record every player's position, so both sides of that
// comparison are reconstructable from the 1 Hz frames:
//
//   rotate start t0   — when a settled player began a cross-map move
//   firstInfo         — earliest thing their team could legitimately know
//                       ABOUT THE DESTINATION (info is location-aware: a molly
//                       at your own site never justifies rotating away from it;
//                       real rounds always contain info somewhere, so a global
//                       model would mark every rotate "informed" and never fire)
//   commit onset tc   — when the enemy team's distribution actually shifted
//
// blind (t0 before firstInfo) + correct (enemies had committed) = the tell.
// Blind rotates that turn out WRONG are counter-evidence and subtract: legit
// hunches split roughly evenly, radar users approach 100% correct. Reaction
// speed matters too — reacting ≤6s after a hidden shift is superhuman, while
// a slow late-round rotate is the classic legit timer/silence read, so slow
// reactions are heavily discounted rather than flagged.
//
// Everything here is a "look here" signal for the Cheat/AI tab — never proof.

import type { ReplayMeta, ReplayRound } from "./types";

export type RotateVerdict = "informed" | "hunch" | "blind-correct" | "blind-wrong";

export interface RotateEvent {
  roundIdx: number;
  roundN: number;
  playerIdx: number;
  side: "CT" | "T";
  from: string; // site label left behind
  to: string; // site label rotated to
  t0: number; // seconds since round start — when the move began
  tArrive: number;
  firstInfo: number | null; // earliest destination-relevant team info (null = none all round)
  commitAt: number | null; // enemy-shift onset backing the verdict
  reactSec: number | null; // t0 - commitAt for blind verdicts
  verdict: RotateVerdict;
}

export interface PlayerRotates {
  playerIdx: number;
  total: number;
  informed: number;
  hunch: number;
  blindCorrect: number;
  blindWrong: number;
  avgReactSec: number | null; // mean reaction of blind-correct rotates
  x: number; // suspicion input: Σ speed-weighted blind-correct − 0.75·blind-wrong
  events: RotateEvent[];
}

export interface RotationReport {
  available: boolean;
  reason?: string; // when unavailable
  siteA: string;
  siteB: string;
  events: RotateEvent[];
  byPlayer: Map<number, PlayerRotates>;
}

// ── tuning ──────────────────────────────────────────────────────────────────
const CONTACT_RADIUS = 1200; // enemy within this 2D range of a teammate = info
const CONTACT_Z = 350; // ignore "contact" across floors when heights are known
const START_FRAC = 0.55; // rotate must begin ≥ this ×sep from the destination
const ARRIVE_FRAC = 0.33; // …and reach ≤ this ×sep of it
const ORIGIN_FRAC = 0.55; // …starting from within this ×sep of the origin site
const SETTLE_FRAC = 0.5; // settled = held ≥ this ×sep from destination
const SETTLE_SEC = 8; // …for this long before the move
const MAX_TRAVEL_SEC = 40; // slower than this is a drift, not a rotate
const DEPLOY_GRACE = 10; // seconds after freeze end before rotates count
const COMMIT_HI = 0.6; // enemy fraction that establishes a commit
const COMMIT_LO = 0.5; // …and the floor it must sustain until t0
const BLIND_EPS = 0.75; // t0 must precede firstInfo by more than this
const MIN_SEP = 1000; // anchors closer than this are one plant cluster

const d2d = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

const sideOf = (r: ReplayRound, i: number, meta: ReplayMeta): "CT" | "T" | "" => {
  if (r.ct?.includes(i)) return "CT";
  if (r.t?.includes(i)) return "T";
  return meta.players[i]?.team ?? "";
};

interface Anchors {
  a: { x: number; y: number; label: string };
  b: { x: number; y: number; label: string };
  sep: number;
}

// Site anchors from observed plant positions. Newer parses label plants with
// the real bombsite; older ones fall back to a mean-x split (rough A/B, same
// convention as insights' area lean). Returns a human-readable reason instead
// of anchors when the analysis genuinely can't run on this match.
function deriveAnchors(rounds: ReplayRound[]): { anchors: Anchors } | { reason: string } {
  const plants: { x: number; y: number; site?: string }[] = [];
  for (const r of rounds) {
    for (const b of r.bomb ?? []) {
      if (b.k === "plant" || b.k === "plant_start") plants.push({ x: b.x, y: b.y, site: b.site });
    }
  }
  if (plants.length === 0) return { reason: "no bomb plants in this match to locate the sites" };
  const mean = (g: { x: number; y: number }[]) =>
    g.length
      ? { x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length }
      : null;
  const la = plants.filter((p) => p.site === "A");
  const lb = plants.filter((p) => p.site === "B");
  let a = mean(la);
  let b = mean(lb);
  const labeledBoth = !!(a && b);
  if (!a || !b) {
    if (plants.length < 2) return { reason: "only one bomb plant recorded — both sites are needed" };
    const mx = plants.reduce((s, p) => s + p.x, 0) / plants.length;
    a = mean(plants.filter((p) => p.x <= mx));
    b = mean(plants.filter((p) => p.x > mx));
  }
  if (!a || !b) return { reason: "bomb plants cluster at a single site" };
  const sep = d2d(a.x, a.y, b.x, b.y);
  if (sep < MIN_SEP) {
    // Plants at both sites but (almost) the same radar spot → vertically
    // stacked sites (Nuke). Site-rotation timing can't be read from radar
    // positions there — say so instead of pretending nothing was planted.
    return {
      reason: labeledBoth
        ? "this map's sites sit on top of each other (Nuke-style verticality), so cross-site rotates can't be read from radar positions"
        : "bomb plants cluster at a single site",
    };
  }
  return { anchors: { a: { ...a, label: "A" }, b: { ...b, label: "B" }, sep } };
}

// Earliest information `side` could legitimately have ABOUT the destination
// this round. Location-aware: an event only informs a rotate toward `to` when
// it happened on the destination half of the map (or near mid — the 1.15
// slack), because a fight or molly at your OWN site never tells you the real
// hit is elsewhere. Counted events: kills (either participant's position —
// killfeed + comms), enemy/unattributed grenade detonations (landing spot),
// bomb events (site-revealing, so always global), and an enemy inside
// audible/visible range of any living teammate while that enemy is on the
// destination half. Infinity when nothing pointed there before round end.
function firstRelevantInfo(
  r: ReplayRound,
  meta: ReplayMeta,
  side: "CT" | "T",
  to: { x: number; y: number },
  from: { x: number; y: number },
): number {
  const relevant = (x: number, y: number) =>
    d2d(x, y, to.x, to.y) <= 1.15 * d2d(x, y, from.x, from.y);
  let best = Infinity;
  for (const b of r.bomb ?? []) best = Math.min(best, b.t);
  for (const k of r.kills ?? []) {
    if (k.t >= best) continue;
    if (relevant(k.vx, k.vy) || relevant(k.kx, k.ky)) best = k.t;
  }
  for (const n of r.nades ?? []) {
    if (n.t >= best) continue;
    const thrower = n.by >= 0 ? sideOf(r, n.by, meta) : "";
    if (thrower === side) continue; // own utility isn't enemy info
    if (relevant(n.x, n.y)) best = n.t;
  }
  for (const f of r.frames ?? []) {
    if (f.t >= best) break;
    const mine = f.p.filter((p) => p.h > 0 && sideOf(r, p.i, meta) === side);
    if (!mine.length) continue;
    for (const e of f.p) {
      if (e.h <= 0) continue;
      const es = sideOf(r, e.i, meta);
      if (es === side || es === "") continue;
      if (!relevant(e.x, e.y)) continue;
      const heard = mine.some(
        (m) =>
          d2d(m.x, m.y, e.x, e.y) <= CONTACT_RADIUS &&
          !(m.z != null && e.z != null && Math.abs(m.z - e.z) > CONTACT_Z),
      );
      if (heard) {
        best = f.t;
        break;
      }
    }
  }
  return best;
}

// Fraction of living `enemySide` players nearer `to` than `from`, per frame.
// null when fewer than 2 are alive (a lone survivor's position isn't a
// "team distribution" — and by then kills have informed everyone anyway).
function commitSeries(
  r: ReplayRound,
  meta: ReplayMeta,
  enemySide: "CT" | "T",
  to: { x: number; y: number },
  from: { x: number; y: number },
): { t: number; frac: number | null }[] {
  const out: { t: number; frac: number | null }[] = [];
  for (const f of r.frames ?? []) {
    const foes = f.p.filter((p) => p.h > 0 && sideOf(r, p.i, meta) === enemySide);
    if (foes.length < 2) {
      out.push({ t: f.t, frac: null });
      continue;
    }
    const near = foes.filter((p) => d2d(p.x, p.y, to.x, to.y) < d2d(p.x, p.y, from.x, from.y)).length;
    out.push({ t: f.t, frac: near / foes.length });
  }
  return out;
}

// Onset of a sustained commit: earliest time frac reached COMMIT_HI and never
// fell below COMMIT_LO from then through t0. null = no active commit at t0.
function commitOnset(series: { t: number; frac: number | null }[], t0: number): number | null {
  let run: number | null = null;
  for (const s of series) {
    if (s.t > t0) break;
    if (s.frac == null || s.frac < COMMIT_LO) run = null;
    else if (s.frac >= COMMIT_HI && run == null) run = s.t;
  }
  return run;
}

// Speed-weighted contribution of one blind-correct rotate. Reacting to a
// hidden shift within seconds is the superhuman part; a slow response is how
// legit timer/silence reads look, so it barely counts.
const reactWeight = (react: number) => (react <= 6 ? 1.5 : react <= 12 ? 1 : 0.5);

export function analyzeRotations(meta: ReplayMeta, rounds: ReplayRound[]): RotationReport {
  const derived = deriveAnchors(rounds);
  if ("reason" in derived) {
    return {
      available: false,
      reason: derived.reason,
      siteA: "A",
      siteB: "B",
      events: [],
      byPlayer: new Map(),
    };
  }
  const anchors = derived.anchors;

  const events: RotateEvent[] = [];

  rounds.forEach((r, roundIdx) => {
    if (!r.frames?.length) return;
    // freeze end fallback: the first moment anyone actually moves
    let freezeEnd = r.freezeEnd ?? null;
    if (freezeEnd == null) {
      freezeEnd = 0;
      const prev = new Map<number, { x: number; y: number }>();
      scan: for (const f of r.frames) {
        for (const p of f.p) {
          const q = prev.get(p.i);
          if (q && d2d(p.x, p.y, q.x, q.y) > 100) {
            freezeEnd = f.t;
            break scan;
          }
          prev.set(p.i, { x: p.x, y: p.y });
        }
      }
    }
    const tMin = freezeEnd + DEPLOY_GRACE;

    const indices = new Set<number>([...(r.ct ?? []), ...(r.t ?? [])]);
    for (const i of indices) {
      const side = sideOf(r, i, meta);
      if (side !== "CT" && side !== "T") continue;

      // alive track (frames only snapshot living players; stop at first gap)
      const pts: { t: number; x: number; y: number }[] = [];
      for (const f of r.frames) {
        const p = f.p.find((pp) => pp.i === i);
        if (!p || p.h <= 0) {
          if (pts.length) break;
          continue;
        }
        pts.push({ t: f.t, x: p.x, y: p.y });
      }
      if (pts.length < 10) continue;

      for (const [dest, origin] of [
        [anchors.a, anchors.b],
        [anchors.b, anchors.a],
      ] as const) {
        const dD = pts.map((p) => d2d(p.x, p.y, dest.x, dest.y));
        const dO = pts.map((p) => d2d(p.x, p.y, origin.x, origin.y));
        let lastFar: number | null = null;

        for (let idx = 0; idx < pts.length; idx++) {
          if (dD[idx] >= START_FRAC * anchors.sep) {
            lastFar = idx;
            continue;
          }
          if (dD[idx] > ARRIVE_FRAC * anchors.sep || lastFar == null) continue;

          // arrival — walk back from the last far frame to where the approach
          // actually began (≥40u/s of progress toward the destination)
          let k = lastFar;
          while (k > 0 && dD[k - 1] - dD[k] > 40 && pts[lastFar].t - pts[k - 1].t <= 25) k--;
          const t0 = pts[k].t;
          const tArrive = pts[idx].t;
          lastFar = null; // one event per crossing

          if (t0 < tMin) continue;
          if (tArrive - t0 > MAX_TRAVEL_SEC) continue;
          if (dO[k] > ORIGIN_FRAC * anchors.sep) continue; // not from the other site
          // settled: held the origin side for SETTLE_SEC before moving
          const before = pts.filter((p) => p.t >= t0 - SETTLE_SEC && p.t < t0);
          if (!before.length) continue;
          if (before.some((p) => d2d(p.x, p.y, dest.x, dest.y) < SETTLE_FRAC * anchors.sep)) continue;

          const enemySide = side === "CT" ? "T" : "CT";
          const teamInfo = firstRelevantInfo(r, meta, side, dest, origin);
          const blind = t0 < teamInfo - BLIND_EPS;

          let verdict: RotateVerdict = "informed";
          let commitAt: number | null = null;
          let reactSec: number | null = null;
          if (blind) {
            const toDest = commitOnset(commitSeries(r, meta, enemySide, dest, origin), t0);
            const toOrigin = commitOnset(commitSeries(r, meta, enemySide, origin, dest), t0);
            if (side === "CT") {
              // going where the hidden attack went / fleeing a hidden push
              if (toDest != null) {
                verdict = "blind-correct";
                commitAt = toDest;
              } else if (toOrigin != null) {
                verdict = "blind-wrong";
                commitAt = toOrigin;
              } else verdict = "hunch";
            } else {
              // T: fleeing a stack that FORMED mid-round is reactive (the
              // tell); leaving a static spawn-set stack is a normal weak-site
              // guess and stays a hunch — that's how legit defaults look.
              if (toOrigin != null && toOrigin >= tMin) {
                verdict = "blind-correct";
                commitAt = toOrigin;
              } else if (toDest != null) {
                verdict = "blind-wrong"; // walked into the stack blind
                commitAt = toDest;
              } else verdict = "hunch";
            }
            if (verdict === "blind-correct" && commitAt != null) reactSec = Math.max(0, t0 - commitAt);
          }

          events.push({
            roundIdx,
            roundN: r.n,
            playerIdx: i,
            side,
            from: origin.label,
            to: dest.label,
            t0,
            tArrive,
            firstInfo: Number.isFinite(teamInfo) ? teamInfo : null,
            commitAt,
            reactSec,
            verdict,
          });
        }
      }
    }
  });

  events.sort((a, b) => a.roundIdx - b.roundIdx || a.t0 - b.t0);

  const byPlayer = new Map<number, PlayerRotates>();
  for (const ev of events) {
    let p = byPlayer.get(ev.playerIdx);
    if (!p) {
      p = {
        playerIdx: ev.playerIdx,
        total: 0,
        informed: 0,
        hunch: 0,
        blindCorrect: 0,
        blindWrong: 0,
        avgReactSec: null,
        x: 0,
        events: [],
      };
      byPlayer.set(ev.playerIdx, p);
    }
    p.total++;
    p.events.push(ev);
    if (ev.verdict === "informed") p.informed++;
    else if (ev.verdict === "hunch") p.hunch++;
    else if (ev.verdict === "blind-wrong") {
      p.blindWrong++;
      p.x -= 0.75;
    } else {
      p.blindCorrect++;
      p.x += reactWeight(ev.reactSec ?? 99);
    }
  }
  for (const p of byPlayer.values()) {
    const reacts = p.events.filter((e) => e.verdict === "blind-correct" && e.reactSec != null);
    p.avgReactSec = reacts.length
      ? reacts.reduce((s, e) => s + (e.reactSec ?? 0), 0) / reacts.length
      : null;
    p.x = Math.max(0, p.x);
  }

  return {
    available: true,
    siteA: anchors.a.label,
    siteB: anchors.b.label,
    events,
    byPlayer,
  };
}
