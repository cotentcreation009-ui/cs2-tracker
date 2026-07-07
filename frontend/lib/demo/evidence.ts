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
}

const ONE_TAP = /deagle|revolver|awp|ssg08|scar20|g3sg1/i;

/**
 * Rank a player's kills into review-worthy "moments". Rounds where their aim
 * aggregates look anomalous lift every kill in that round; each kill also earns
 * weight from its own tells (headshot, one-tap weapon, multi-kill round).
 */
export function cheatMoments(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  playerIdx: number,
  limit = 14,
): CheatMoment[] {
  const name = (i: number) => meta.players[i]?.name ?? `P${i + 1}`;
  const out: CheatMoment[] = [];

  rounds.forEach((r, roundIdx) => {
    const st = r.stats?.find((s) => s.i === playerIdx);
    // round-level aim flags (apply to every kill the player got this round)
    const roundTags: string[] = [];
    let roundWeight = 0;
    if (st) {
      if ((st.snap ?? 0) > 0) {
        roundTags.push(st.snap && st.snap > 1 ? `${st.snap} snap kills` : "snap kill");
        roundWeight += 5 * Math.min(3, st.snap ?? 1);
      }
      if (st.aimN && st.aimN > 0) {
        const preaim = (st.preaim ?? 0) / st.aimN;
        const react = (st.rctMs ?? 0) / st.aimN;
        if (preaim > 0 && preaim < 9) {
          roundTags.push(`${preaim.toFixed(1)}° pre-aim`);
          roundWeight += 3;
        }
        if (react > 0 && react < 260) {
          roundTags.push(`${react.toFixed(0)}ms reaction`);
          roundWeight += 2;
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

    const kills = (r.kills ?? []).filter((k) => k.k === playerIdx && k.v >= 0);
    const multi = kills.length >= 3;
    for (const k of kills) {
      const wm = weaponMeta(k.w);
      const tags = [...roundTags];
      let weight = roundWeight;
      if (k.hs) {
        tags.push("headshot");
        weight += 1.5;
        if (ONE_TAP.test(k.w)) {
          tags.push(`${wm.label} one-tap`);
          weight += 2.5;
        }
      }
      if (multi) {
        tags.push(`${kills.length}K round`);
        weight += 1;
      }
      // only surface kills that earned at least one flag
      if (tags.length === 0) continue;
      out.push({
        roundIdx,
        roundN: r.n,
        t: k.t,
        weaponRaw: k.w,
        weaponLabel: wm.label,
        weaponColor: wm.color,
        victim: name(k.v),
        hs: !!k.hs,
        // strongest tags first, de-duped
        tags: [...new Set(tags)],
        weight,
      });
    }
  });

  return out.sort((a, b) => b.weight - a.weight || a.roundN - b.roundN || a.t - b.t).slice(0, limit);
}

/** Whether any per-round aim data backs the evidence (vs. older parses). */
export function hasAimData(rounds: ReplayRound[]): boolean {
  return rounds.some((r) => (r.stats ?? []).some((s) => (s.aimN ?? 0) > 0 || (s.snap ?? 0) > 0));
}
