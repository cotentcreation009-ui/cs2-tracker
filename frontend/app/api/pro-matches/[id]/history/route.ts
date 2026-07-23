import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for a series' recent-form + head-to-head. Fetched lazily by the detail
// page (below the live scoreboard). History changes slowly, so let the edge
// hold it briefly.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/${encodeURIComponent(id)}/history`,
      { headers: internalHeaders(), next: { revalidate: 60 } },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
