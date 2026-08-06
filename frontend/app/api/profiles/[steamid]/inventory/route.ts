import { API_BASE, internalHeaders } from "@/lib/api";

// Passthrough for the CS2 skin-inventory showcase (Steam items + Skinport
// prices, aggregated server-side). Steam rate-limits inventory reads hard,
// so let the edge hold successful responses for a while.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string }> },
): Promise<Response> {
  const { steamid } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/players/${encodeURIComponent(steamid)}/inventory`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    // The backend distinguishes "real inventory" (cache for a while) from
    // "Steam turned us away" (no-store) — and both arrive as HTTP 200, so
    // res.ok can't tell them apart. Inventing a cache header here once made
    // browsers hold the FAILURE for five minutes: the panel kept showing
    // "fetching" long after the backend had the data. Pass the backend's
    // header through instead; it knows which case this is.
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": "application/json",
        "cache-control":
          res.headers.get("cache-control") ??
          (res.ok ? "public, max-age=300, s-maxage=600" : "public, s-maxage=60"),
      },
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
