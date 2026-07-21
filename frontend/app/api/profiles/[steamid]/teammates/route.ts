import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for the FriendsPanel's lazy fetch — resolves a player's frequent
// teammates (with per-friend stats) on the backend, which caches every
// per-friend Leetify call alongside the profile pages'.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string }> },
): Promise<Response> {
  const { steamid } = await params;
  if (!/^\d{17}$/.test(steamid)) {
    return Response.json({ error: "invalid SteamID64" }, { status: 400 });
  }
  try {
    const res = await fetch(`${API_BASE}/api/players/${steamid}/teammates`, {
      headers: internalHeaders(),
      // friends lists move slowly — let the edge absorb repeat opens
      next: { revalidate: 300 },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
