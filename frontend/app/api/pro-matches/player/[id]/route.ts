import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for the per-player stats drill-down (official GRID aggregates across
// comparison windows). Backend caches each cell 12h; hold at the edge briefly.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/player/${encodeURIComponent(id)}`,
      { headers: internalHeaders(), next: { revalidate: 300 } },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=600, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
