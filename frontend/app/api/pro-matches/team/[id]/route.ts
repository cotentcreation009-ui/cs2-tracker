import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for the pro-team page (roster + aggregated stats + results). Slow-
// moving data — let the edge hold it for a couple of minutes.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/team/${encodeURIComponent(id)}`,
      { headers: internalHeaders(), next: { revalidate: 120 } },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
