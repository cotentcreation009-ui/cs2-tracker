import { NextResponse } from "next/server";
import {
  getLeetify,
  getFaceit,
  getSteamExtras,
  resolveFaceitNickname,
  trustedClientIp,
} from "@/lib/api";
import { computeSuspicion } from "@/lib/suspicion";
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
    // shows a neutral "view on StatRun" chip instead of a fake score).
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
  };

  return NextResponse.json(payload, {
    headers: { ...CORS, "Cache-Control": "public, max-age=60" },
  });
}
