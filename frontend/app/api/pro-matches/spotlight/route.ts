import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for the three spotlight rails (teams on the board, their rostered
// players, FACEIT's leaderboard). Explicit rather than left to the sibling
// [id] route: that one treats its segment as a seriesId, and "spotlight"
// happening to forward correctly would be luck, not design.
//
// Unlike the board this changes slowly — the backend caches rosters for 12h and
// the leaderboard for 30m — so a short shared cache here saves the Go service
// from a poll per visitor without ever showing a stale scoreline (there are no
// scores on it).
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const { search } = new URL(req.url); // ?region= picks the FACEIT leaderboard
    const res = await fetch(`${API_BASE}/api/pro-matches/spotlight${search}`, {
      headers: internalHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch {
    // The rails are an enhancement; an unreachable backend should leave the
    // match board alone rather than take the page down with it.
    return Response.json(
      { enabled: false, teams: [], players: [], faceit: [] },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
}
