import { API_BASE, internalHeaders } from "@/lib/api";

// Binary passthrough for pro-player photos (backend resolves + caches the
// Liquipedia thumbnail). Long edge cache — the backend already holds bytes
// for 14 days, so let Cloudflare keep them for a week too.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ nick: string }> },
): Promise<Response> {
  const { nick } = await params;
  try {
    const res = await fetch(
      `${API_BASE}/api/pro-matches/player-image/${encodeURIComponent(nick)}`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    if (!res.ok) {
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "public, s-maxage=21600" },
      });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
