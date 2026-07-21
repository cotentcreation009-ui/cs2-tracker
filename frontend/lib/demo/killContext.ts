// Shared kill-feed context: which kill opened the round (FIRST) and which
// kills avenged a teammate (TRADE). One definition, used by every feed
// (Routes, Replay).
//
// Trade semantics — one event pair, two views: when A kills B and C then
// kills A within the window, the feeds' TRADE pill marks C's kill (the
// avenging kill, what you see happen in a feed), while the Weapons tab's
// "traded" filter marks A's kill (the kill that GOT traded — the death-review
// view). Same pair, same window, same enemy-kill rules on both kills; the two
// surfaces intentionally tag opposite halves of it.
import type { ReplayRound } from "@/lib/demo/types";

// Window between the original kill and the avenging kill. Inclusive: a
// same-tick mutual frag is a trade. Must match WeaponInsights' TRADE_WINDOW.
export const TRADE_WINDOW = 5;

export interface KillContext {
  /** index (into round.kills) of the round's opening enemy kill, -1 if none */
  firstIdx: number;
  /** kill indices that avenged a teammate killed within TRADE_WINDOW */
  tradeIdxs: Set<number>;
}

const sideOf = (r: ReplayRound, i: number): "CT" | "T" | null =>
  r.ct?.includes(i) ? "CT" : r.t?.includes(i) ? "T" : null;

/** Compute FIRST/TRADE tags for one round's kill list. */
export function killContext(round: ReplayRound): KillContext {
  const kills = round.kills ?? [];
  let firstIdx = -1;
  let firstT = Infinity;
  const tradeIdxs = new Set<number>();
  for (let i = 0; i < kills.length; i++) {
    const k = kills[i];
    if (k.k < 0 || k.v < 0) continue;
    const ks = sideOf(round, k.k);
    if (!ks || ks === sideOf(round, k.v)) continue; // not an enemy kill
    if (k.t < firstT) {
      firstT = k.t;
      firstIdx = i;
    }
    // trade: this kill's victim scored an (enemy) kill just before it
    const avenged = kills.some(
      (k1) =>
        k1 !== k &&
        k1.k === k.v &&
        k1.v >= 0 &&
        sideOf(round, k1.v) !== null &&
        sideOf(round, k1.v) !== sideOf(round, k1.k) &&
        k1.t <= k.t &&
        k.t - k1.t <= TRADE_WINDOW,
    );
    if (avenged) tradeIdxs.add(i);
  }
  return { firstIdx, tradeIdxs };
}
