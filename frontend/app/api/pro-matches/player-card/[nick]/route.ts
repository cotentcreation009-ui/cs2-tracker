import { API_BASE, internalHeaders } from "@/lib/api";

// Passthrough for pro-player Liquipedia identity cards (real name, country,
// role — backend resolves + caches for 14 days). Long edge cache to match.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ nick: string }> },
): Promise<Response> {
  const { nick } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/player-card/${encodeURIComponent(nick)}`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": res.ok
          ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
          : "public, s-maxage=1800",
      },
    });
  } catch {
    return Response.json({ found: false }, { status: 502 });
  }
}
