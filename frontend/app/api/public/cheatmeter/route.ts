import { NextResponse } from "next/server";
import {
  getLeetify,
  getFaceit,
  getSteamExtras,
  resolveFaceitNickname,
  trustedClientIp,
} from "@/lib/api";
import { computeSuspicion } from "@/lib/suspicion";
import type { LeetifyProfile } from "@/lib/types";
import { rateLimitOK } from "@/lib/publicRateLimit";

// PUBLIC, unauthenticated, CORS-enabled CheatMeter summary for the browser
// extension. Given a SteamID64 (?steamid=) or a FACEIT nickname (?faceit=), it
// returns a compact risk read + ranks. Reuses the exact CheatMeter model
// (computeSuspicion) and the existing (internal, cached) backend calls — so
// there's no new public *backend* surface, just this thin Next route.
//
// Steam lifetime stats are deliberately skipped here (an extra Steam API call
// per player × 10 per room); the VAC-ban floor still comes through steam-extras.

export const dynamic = "force-dynamic";

const SITE = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");

// Mean Leetify rating over the recent window. Leetify reports it per match and
// never in aggregate, so the average is the only honest summary of it.
function avgLeetifyRating(p: LeetifyProfile | null): number | null {
  const rows = p?.recent_matches;
  if (!Array.isArray(rows) || !rows.length) return null;
  const vals = rows
    .map((m) => m?.leetify_rating)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!vals.length) return null;
  // Leetify reports this as a raw fraction; every CSRun surface that shows it
  // scales by 100 (see MapStrength / platformSplit). Returning the fraction
  // here printed "+0.02%" where Leetify itself says "+2.02%".
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const ip = trustedClientIp(req) || "anon";
  if (!rateLimitOK(ip)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: CORS });
  }

  const url = new URL(req.url);
  let steamid = (url.searchParams.get("steamid") || "").trim();
  const faceitNick = (url.searchParams.get("faceit") || "").trim();

  if (!/^\d{17}$/.test(steamid) && faceitNick) {
    steamid = (await resolveFaceitNickname(faceitNick)) || "";
  }
  if (!/^\d{17}$/.test(steamid)) {
    return NextResponse.json(
      { error: "provide a 17-digit steamid or a faceit nickname" },
      { status: 400, headers: CORS },
    );
  }

  const [leetify, faceit, steamExtras] = await Promise.all([
    getLeetify(steamid),
    getFaceit(steamid),
    getSteamExtras(steamid),
  ]);

  const sus = computeSuspicion(leetify, faceit, null, steamExtras);
  const banned =
    !!steamExtras?.vacBanned ||
    (steamExtras?.numberOfVacBans ?? 0) > 0 ||
    (steamExtras?.numberOfGameBans ?? 0) > 0;

  const payload = {
    steamId64: steamid,
    profileUrl: `${SITE}/profiles/${steamid}`,
    name: leetify?.name || faceit?.nickname || null,
    // Null when there isn't enough data to say anything (the extension then
    // shows a neutral "view on CSRun" chip instead of a fake score).
    cheat:
      sus && sus.hasEnough
        ? {
            score: Math.round(sus.score),
            band: sus.band,
            confidence: Math.round(sus.confidence),
            lowConfidence: sus.lowConfidence,
          }
        : null,
    premier: leetify?.ranks?.premier ?? null,
    faceitLevel: faceit?.skillLevel || leetify?.ranks?.faceit || null,
    faceitElo: faceit?.elo || leetify?.ranks?.faceit_elo || null,
    kd: faceit?.kdRatio || leetify?.kd || null,
    gap: sus?.gap ?? null,
    banned,
    // extras the extension's match-room panel renders (all already fetched)
    country: faceit?.country || null,
    winRatePct: faceit?.winRatePct || null,
    winStreak: faceit?.currentWinStreak ?? null,
    recentResults: faceit?.recentResults?.slice(0, 5) ?? null,
    leetifyAim: leetify?.rating?.aim ?? null,

    // The full per-player read the extension's match-room strip renders. Every
    // field below comes out of the two profiles already fetched above, so this
    // adds no network cost at all — the route was simply discarding most of
    // what it had. Nulls are honest: the strip omits what it does not get.
    stats: {
      // FACEIT lifetime
      matches: faceit?.matches ?? null,
      winRatePct: faceit?.winRatePct ?? null,
      kd: faceit?.kdRatio ?? null,
      hsPct: faceit?.hsPct ?? null,
      avgKills: faceit?.avgKills ?? null,
      longestWinStreak: faceit?.longestWinStreak ?? null,
      // Last-30 aggregate from the Data API's named per-match fields — the
      // only place ADR, kills-per-round and assists actually exist for an
      // arbitrary player. Absent rather than guessed when FACEIT withholds it.
      adr: faceit?.recent?.ADR || null,
      kr: faceit?.recent?.KR || null,
      avgAssists: faceit?.recent?.Assists ?? null,
      avgDeaths: faceit?.recent?.Deaths ?? null,
      recentKills: faceit?.recent?.Kills ?? null,
      recentMatches: faceit?.recent?.Matches ?? null,
      rating: faceit?.recent?.Rating || null,
      // Leetify — what Repeek shows as "Swing" is Leetify's own rating, and we
      // have it per match, so the mean over the recent window is the same read.
      swing: avgLeetifyRating(leetify),
      totalMatches: leetify?.total_matches ?? null,
      aim: leetify?.rating?.aim ?? null,
      positioning: leetify?.rating?.positioning ?? null,
      utility: leetify?.rating?.utility ?? null,
      clutch: leetify?.rating?.clutch ?? null,
      opening: leetify?.rating?.opening ?? null,
      // Leetify aim detail — nothing comparable exists in Repeek
      preaim: leetify?.stats?.preaim ?? null,
      reactionMs: leetify?.stats?.reaction_time_ms ?? null,
      sprayAccuracy: leetify?.stats?.spray_accuracy ?? null,
      accuracyHead: leetify?.stats?.accuracy_head ?? null,
      openingCt: leetify?.stats?.ct_opening_duel_success_percentage ?? null,
      openingT: leetify?.stats?.t_opening_duel_success_percentage ?? null,
      tradedDeaths: leetify?.stats?.traded_deaths_success_percentage ?? null,
      avgPartySize: leetify?.avg_party_size ?? null,
      peakPremier: leetify?.peak_premier ?? null,
      firstMatch: leetify?.first_match_date ?? null,
    },
  };

  return NextResponse.json(payload, {
    headers: { ...CORS, "Cache-Control": "public, max-age=60" },
  });
}
