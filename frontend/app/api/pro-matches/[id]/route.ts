import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for a single series' live state. The detail page polls this while a
// match is live. 404 (unknown series) is passed through unchanged so the client
// can render its "match not found" state. Never cached — scores must be fresh.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/${encodeURIComponent(id)}`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
