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
  vx: number; // victim position
  vy: number;
}

const ONE_TAP = /deagle|revolver|awp|ssg08|scar20|g3sg1/i;

/**
 * Rank a player's kills into review-worthy "moments". Rounds where their aim
 * aggregates look anomalous lift every kill in that round; each kill also earns
 * weight from its own tells (headshot, one-tap weapon, per-kill reaction,
 * multi-kill round). Only ENEMY kills count (a teamkill is not evidence), the
 * reaction tag prefers the kill's own measured reaction over the round average,
 * and a multi-kill round collapses to ONE row (its strongest kill) so the list
 * never repeats identical tag sets.
 */
export function cheatMoments(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  playerIdx: number,
  limit = 14,
): CheatMoment[] {
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const sideOf = (r: ReplayRound, i: number) =>
    r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : meta.players[i]?.team ?? "";
  const out: CheatMoment[] = [];

  rounds.forEach((r, roundIdx) => {
    const st = r.stats?.find((s) => s.i === playerIdx);
    // round-level aim flags (shared by every kill the player got this round)
    const roundTags: string[] = [];
    let roundWeight = 0;
    let roundAvgReact = 0;
    if (st) {
      if ((st.snap ?? 0) > 0) {
        roundTags.push(st.snap && st.snap > 1 ? `${st.snap} snap kills` : "snap kill");
        roundWeight += 5 * Math.min(3, st.snap ?? 1);
      }
      if (st.aimN && st.aimN > 0) {
        const preaim = (st.preaim ?? 0) / st.aimN;
        roundAvgReact = (st.rctMs ?? 0) / st.aimN;
        if (preaim > 0 && preaim < 9) {
          roundTags.push(`${preaim.toFixed(1)}° pre-aim`);
          roundWeight += 3;
        }
      }
      if (st.shots && st.shots >= 8) {
        const acc = ((st.hits ?? 0) / st.shots) * 100;
        if (acc >= 65) {
          roundTags.push(`${acc.toFixed(0)}% accuracy`);
          roundWeight += 2;
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
      // reaction: prefer THIS kill's measured spotted→kill time; fall back to
      // the round average (marked ~) when this kill has no aim sample
      const react = k.rct ?? 0;
      if (react > 0 && react < 260) {
        tags.push(`${react.toFixed(0)}ms reaction`);
        weight += react < 180 ? 3 : 2;
      } else if (k.rct == null && roundAvgReact > 0 && roundAvgReact < 260) {
        tags.push(`~${roundAvgReact.toFixed(0)}ms reaction`);
        weight += 2;
      }
      if (k.hs) {
        tags.push("headshot");
        weight += 1.5;
        if (ONE_TAP.test(k.w)) {
          tags.push(`${wm.label} one-tap`);
          weight += 2.5;
        }
      }
      if (k.wb) {
        tags.push("through a wall");
        weight += 2;
      }
      if (k.ts) {
        tags.push("through smoke");
        weight += 2;
      }
      if (multi) {
        tags.push(`${kills.length}K round`);
        weight += 1;
      }
      // only surface kills that earned at least one flag
      if (tags.length === 0) continue;
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
        vx: k.vx,
        vy: k.vy,
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
