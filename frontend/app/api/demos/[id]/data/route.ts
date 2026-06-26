import { API_BASE, internalHeaders } from "@/lib/api";

// Fetch the normalized replay JSON for a finished demo. The backend stores it
// gzipped and sends Content-Encoding: gzip; Node's fetch transparently
// decompresses it, so we forward plain JSON to the browser.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/demos/${encodeURIComponent(id)}/data`,
      { headers: internalHeaders() },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
