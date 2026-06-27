import { API_BASE, internalHeaders } from "@/lib/api";

// Same-origin proxy for the on-demand account lookups used by the client-side
// Account check panel. The client can't reach the gated backend directly (it has
// no internal token and API_BASE is server-only), so it calls these relative
// routes which inject the token server-side — same pattern as /api/ai/analyze.
export const dynamic = "force-dynamic";

const PANELS = new Set(["faceit", "leetify", "steam-stats", "steam-extras"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ steamid: string; panel: string }> },
): Promise<Response> {
  const { steamid, panel } = await params;
  if (!PANELS.has(panel)) {
    return Response.json({ error: "unknown panel" }, { status: 404 });
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/players/${encodeURIComponent(steamid)}/${panel}`,
      { headers: internalHeaders(), cache: "no-store" },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
}
