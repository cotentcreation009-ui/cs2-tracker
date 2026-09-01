// Display adapters for the match-report bridge.
//
// A bridged player has no Leetify profile, but the panels on a profile page
// were all written against Leetify's shapes. Rather than fork every panel,
// the stored match rows are dressed in those shapes here — once, in one
// place — so a bridged profile renders through the SAME components a normal
// profile does, and drifts with them automatically.
//
// Display only. The suspicion score reads the BridgeAggregate through its own
// gated path in computeSuspicion; nothing synthesized here feeds scoring, so
// the no-override guarantee (a real profile scores identically with or without
// bridge data) is untouched.

import type { LeetifyProfile, LeetifyRecentMatch } from "./types";
import type { BridgeMatchRow } from "./api";
import type { BridgeAggregate } from "./suspicion";

/**
 * Dress stored match rows as Leetify recent-matches.
 *
 * Outcome comes from rounds won vs lost, and a row that cannot say — missing
 * rounds — is dropped rather than guessed. rank_type is set only for sources
 * that name themselves competitive; anything else lands in the "Other" queue
 * tab rather than being mislabelled Premier on an assumption.
 */
export function recentFromBridge(rows: BridgeMatchRow[]): LeetifyRecentMatch[] {
  return (rows ?? [])
    .filter((m) => m.mapName && (m.roundsCount ?? 0) > 0 && (m.roundsWon ?? 0) > 0)
    .map((m) => {
      const won = m.roundsWon!;
      const lost = m.roundsCount! - won;
      return {
        id: m.matchId,
        finished_at: m.finishedAt ?? "",
        data_source: m.dataSource ?? "matchmaking",
        outcome: won > lost ? "win" : won < lost ? "loss" : "tie",
        map_name: m.mapName!,
        leetify_rating: m.leetifyRating ?? 0,
        score: [won, lost] as [number, number],
        // Measured mapping: Leetify serves Premier games as "matchmaking"
        // and competitive as "matchmaking_competitive". Wingman/others stay
        // untyped and land in the Other tab rather than being mislabelled.
        rank_type:
          m.dataSource === "matchmaking"
            ? 11
            : m.dataSource?.includes("competitive")
              ? 12
              : undefined,
        kills: m.totalKills,
        deaths: m.totalDeaths,
        // Row units are the match endpoint's (seconds, fractions); the
        // recent-match shape wants the profile's (ms, percents).
        preaim: m.preaim ?? 0,
        reaction_time_ms: (m.reactionTime ?? 0) * 1000,
        accuracy_head: (m.accuracyHead ?? 0) * 100,
        accuracy_enemy_spotted: 0,
        spray_accuracy: 0,
      } as LeetifyRecentMatch;
    });
}

/**
 * A display-only stand-in for a Leetify profile, for panels that take the
 * whole profile object (the counter report).
 *
 * Every field a bridge cannot know is zero, and the panels those feed are all
 * threshold-gated, so absent signals hide rather than render as damning zeros.
 * Returns null under four matches — a counter report from two games would be
 * advice built on noise.
 */
export function pseudoProfileFromBridge(
  agg: BridgeAggregate | null | undefined,
  rows: BridgeMatchRow[],
): LeetifyProfile | null {
  if (!agg || agg.matches < 4) return null;
  const recent = recentFromBridge(rows);
  const decided = recent.filter((m) => m.outcome !== "tie");
  const wins = decided.filter((m) => m.outcome === "win").length;
  return {
    name: "",
    steam64_id: "",
    total_matches: agg.matches,
    kd: agg.kdRatio,
    winrate: decided.length ? wins / decided.length : 0,
    privacy_mode: "public",
    bans: [],
    rating: {
      aim: 0,
      positioning: 0,
      utility: 0,
      clutch: 0,
      opening: 0,
      ct_leetify: 0,
      t_leetify: 0,
    },
    stats: {
      accuracy_head: agg.accuracyHead ?? 0,
      accuracy_enemy_spotted: agg.spottedAcc ?? 0,
      preaim: agg.preaim ?? 0,
      reaction_time_ms: agg.reactionTimeMs ?? 0,
      spray_accuracy: agg.sprayAccuracy ?? 0,
      counter_strafing_good_shots_ratio: agg.counterStrafe ?? 0,
      ct_opening_duel_success_percentage: 0,
      t_opening_duel_success_percentage: 0,
      trade_kills_success_percentage: agg.tradesWonPct ?? 0,
      traded_deaths_success_percentage: 0,
      trade_kill_opportunities_per_round: 0,
      flashbang_hit_foe_per_flashbang: agg.flashPerThrow ?? 0,
      flashbang_leading_to_kill: 0,
      he_foes_damage_avg: agg.heDmgAvg ?? 0,
      utility_on_death_avg: 0,
    },
    ranks: {},
    recent_matches: recent,
  };
}
