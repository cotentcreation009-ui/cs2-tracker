import { API_BASE, internalHeaders } from "@/lib/api";

// Proxy for the live pro-matches board. The client SWR-polls this every 10s, so
// it must never be cached at the edge — always hit the Go backend for fresh
// scores. The backend returns { enabled, matches, updatedAt } and gates the
// whole feature on GRID_API_KEY (enabled:false with no key → tasteful "coming
// soon" state on the page), so this proxy just forwards whatever it gets.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${API_BASE}/api/pro-matches`, {
      headers: internalHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Degrade gracefully — the board treats this as "temporarily unavailable"
    // and keeps showing the last good data rather than crashing.
    return Response.json(
      { enabled: false, matches: [], error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
