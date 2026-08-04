import { API_BASE, internalHeaders } from "@/lib/api";

// Passthrough for one player's deep per-game scoreboard line (ADR / KAST /
// rating…), fetched when a match row expands. The backend caches hits for a
// week — a finished game never changes — so let the edge keep them too.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string; gameId: string }> },
): Promise<Response> {
  const { steamid, gameId } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/players/${encodeURIComponent(steamid)}/leetify-game/${encodeURIComponent(gameId)}`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": res.ok
          ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800"
          : "public, s-maxage=600",
      },
    });
  } catch {
    return Response.json({ found: false }, { status: 502 });
  }
}
