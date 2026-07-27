// "Flagged moments" for the Cheat/AI case file: a player's kills ranked by how
// worth-reviewing they are, so a suspicion score turns into concrete clips you
// can jump to in the Replay tab. Evidence is drawn from per-round aim
// aggregates (ReplayPlayerStat: snap corrections, crosshair offset, reaction)
// plus the kill's own properties (headshot, one-tap weapon, multi-kill round).
// It is a review aid, never proof — an anomalous round is a place to LOOK.

import type { ReplayMeta, ReplayRound } from "./types";
import { weaponMeta } from "./weapons";

export interface CheatMoment {
  roundIdx: number;
  roundN: number;
  t: number; // seconds since round start (the kill time — where to seek)
  weaponRaw: string;
  weaponLabel: string;
  weaponColor: string;
  victim: string;
  hs: boolean;
  tags: string[]; // why it's worth a look, strongest first
  weight: number; // ranking score
  extraKills?: number; // other flagged kills in the same round, folded into this row
  kx: number; // killer position (world space) — drawn on the evidence map
  ky: number;
  kz?: number; // heights — level-aware placement on two-level maps
  vx: number; // victim position
  vy: number;
  vz?: number;
}

const ONE_TAP = /deagle|revolver|awp|ssg08|scar20|g3sg1/i;

/**
 * Rank a player's kills into review-worthy "moments".
 *
 * A kill is FLAGGED only when it carries at least one PRIMARY tell — something
 * genuinely anomalous, aligned with the CheatMeter's aim-anomaly philosophy:
 *   • snap kill(s) this round — superhuman correction from a far crosshair
 *   • extreme pre-aim         — crosshair already on target when the enemy
 *                               appeared (round avg < 3°; ordinary angle-
 *                               holding runs far higher)
 *   • trigger-like reaction   — THIS kill's spotted→kill under 180 ms
 *   • killed while flashed    — landed the kill blind (parser's bl flag)
 *   • wallbang / through-smoke HEADSHOT — hitting a head you can't see
 *   • anomalous round accuracy — ≥70% of ≥10 bullets hit
 *
 * Headshots, one-taps, multi-kill rounds, plain wallbangs/smoke kills and
 * ordinary reactions (180-260 ms) only ADD ranking weight — they can never
 * flag a kill by themselves, because strong players produce those all game
 * (that would be flagging volume, which this tab promises not to do).
 *
 * Only ENEMY kills count (a teamkill is not evidence), the reaction tag
 * prefers the kill's own measured reaction over the round average (~ marks
 * the fallback), and a multi-kill round collapses to ONE row (its strongest
 * kill) so the list never repeats identical tag sets.
 */
export function cheatMoments(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  playerIdx: number,
  limit = 12,
): CheatMoment[] {
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const sideOf = (r: ReplayRound, i: number) =>
    r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : meta.players[i]?.team ?? "";
  const out: CheatMoment[] = [];

  rounds.forEach((r, roundIdx) => {
    const st = r.stats?.find((s) => s.i === playerIdx);
    // round-level tells (shared by every kill the player got this round)
    const roundTags: string[] = [];
    let roundWeight = 0;
    let roundPrimary = false;
    let roundAvgReact = 0;
    if (st) {
      if ((st.snap ?? 0) > 0) {
        roundTags.push(st.snap && st.snap > 1 ? `${st.snap} snap kills` : "snap kill");
        roundWeight += 5 * Math.min(3, st.snap ?? 1);
        roundPrimary = true;
      }
      if (st.aimN && st.aimN > 0) {
        const preaim = (st.preaim ?? 0) / st.aimN;
        roundAvgReact = (st.rctMs ?? 0) / st.aimN;
        // a single sampled kill under 3° is just holding an angle; the tell is
        // a SUSTAINED round — 2+ sampled kills averaging under 2°
        if (preaim > 0 && preaim < 3) {
          roundTags.push(`${preaim.toFixed(1)}° pre-aim`);
          if (st.aimN >= 2 && preaim < 2) {
            roundWeight += preaim < 1 ? 5 : 3;
            roundPrimary = true;
          } else {
            roundWeight += 1;
          }
        }
      }
      if (st.shots && st.shots >= 10) {
        const acc = ((st.hits ?? 0) / st.shots) * 100;
        if (acc >= 70) {
          roundTags.push(`${acc.toFixed(0)}% accuracy`);
          roundWeight += 2.5;
          roundPrimary = true;
        }
      }
    }

    // enemy kills only — a teamkill is never review-worthy aim evidence
    const kills = (r.kills ?? []).filter(
      (k) => k.k === playerIdx && k.v >= 0 && k.v !== k.k && sideOf(r, k.v) !== sideOf(r, k.k),
    );
    const multi = kills.length >= 3;
    const rows: CheatMoment[] = [];
    for (const k of kills) {
      const wm = weaponMeta(k.w);
      const tags = [...roundTags];
      let weight = roundWeight;
      let primary = roundPrimary;

      // reaction: prefer THIS kill's measured spotted→kill time; fall back to
      // the round average (marked ~) when this kill has no aim sample. Only
      // true trigger territory (<120ms — faster than a prepared human) is a
      // primary tell; 120-260 is fast-but-plausible (peeker's advantage,
      // prefires) and merely adds weight when something else flagged the kill.
      const react = k.rct ?? 0;
      if (react > 0 && react < 260) {
        tags.push(`${react.toFixed(0)}ms reaction`);
        if (react < 120) {
          weight += 5;
          primary = true;
        } else {
          weight += react < 180 ? 2.5 : 1.5;
        }
      } else if (k.rct == null && roundAvgReact > 0 && roundAvgReact < 120) {
        tags.push(`~${roundAvgReact.toFixed(0)}ms reaction`);
        weight += 4;
        primary = true;
      }
      // Parser's "no spotted record" flag. Validated on real demos: the CS2
      // spotted mask misses ~29% of ordinary fast kills, so this is NEVER a
      // primary tell on its own — it corroborates (adds weight + a tag) when
      // something else flags the kill, and reads strongest on through-cover
      // kills below.
      if (k.us) {
        tags.push("never spotted the victim");
        weight += 1.5;
      }
      // landing a kill WHILE FLASHED — tracking through a white screen
      if (k.bl) {
        tags.push("killed while flashed");
        weight += 4;
        primary = true;
      }
      // hitting what you can't see: wallbang / smoke kills are spam-luck on
      // their own, but a HEADSHOT through cover is a real tell
      if (k.wb) {
        tags.push(k.hs ? "headshot through a wall" : "through a wall");
        weight += k.hs ? 3.5 : 1.5;
        if (k.hs) primary = true;
      }
      if (k.ts) {
        tags.push(k.hs ? "headshot through smoke" : "through smoke");
        weight += k.hs ? 3.5 : 1.5;
        if (k.hs) primary = true;
      }
      // modifiers — ranking weight only, never a flag by themselves
      if (k.hs) {
        tags.push("headshot");
        weight += 1;
        if (ONE_TAP.test(k.w)) {
          tags.push(`${wm.label} one-tap`);
          weight += 1.5;
        }
      }
      if (multi) {
        tags.push(`${kills.length}K round`);
        weight += 1;
      }
      // a kill is flagged only when a PRIMARY tell backs it
      if (!primary) continue;
      rows.push({
        roundIdx,
        roundN: r.n,
        t: k.t,
        weaponRaw: k.w,
        weaponLabel: wm.label,
        weaponColor: wm.color,
        victim: name(k.v),
        hs: !!k.hs,
        tags: [...new Set(tags)],
        weight,
        kx: k.kx,
        ky: k.ky,
        kz: k.kz,
        vx: k.vx,
        vy: k.vy,
        vz: k.vz,
      });
    }
    // one row per round: keep the strongest kill, fold the rest into a count
    if (rows.length > 1) {
      rows.sort((a, b) => b.weight - a.weight || a.t - b.t);
      const keep = rows[0];
      keep.extraKills = rows.length - 1;
      out.push(keep);
    } else if (rows.length === 1) {
      out.push(rows[0]);
    }
  });

  return out.sort((a, b) => b.weight - a.weight || a.roundN - b.roundN || a.t - b.t).slice(0, limit);
}

/** Whether any per-round aim data backs the evidence (vs. older parses). */
export function hasAimData(rounds: ReplayRound[]): boolean {
  return rounds.some((r) => (r.stats ?? []).some((s) => (s.aimN ?? 0) > 0 || (s.snap ?? 0) > 0));
}
