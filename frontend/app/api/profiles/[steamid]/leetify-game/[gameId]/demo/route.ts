import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Where one listed game's demo can be downloaded: the backend resolves it the
// way one-click analysis does (Valve replay URL via the Steam bot, or FACEIT's
// signed link) and answers with the link or the reason there is none. Only the
// link passes through here — the browser fetches the demo itself from Valve or
// FACEIT. The backend rate-limits this per visitor, so forward the real IP.
// Never cached: a FACEIT link is signed and short-lived.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ steamid: string; gameId: string }> },
): Promise<Response> {
  const { steamid, gameId } = await params;
  const fwd = trustedClientIp(req);
  // finishedAt / score: only used for legacy-format rows (see the backend).
  const qs = new URL(req.url).search;
  try {
    const res = await fetch(
      `${API_BASE}/api/players/${encodeURIComponent(steamid)}/leetify-game/${encodeURIComponent(gameId)}/demo${qs}`,
      {
        headers: { ...(fwd ? { "x-real-ip": fwd } : {}), ...internalHeaders() },
        cache: "no-store",
      },
    );
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
