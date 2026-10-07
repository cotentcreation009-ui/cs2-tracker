import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// The demo FILE for one listed game, over this https origin. Valve serves
// replays over plain http, and Chrome refuses every download an https page
// starts towards an http host (same-tab link, scripted tab, redirect chain —
// all inspected), so the backend fetches the replay from Valve and streams it
// through; this handler passes that stream on byte for byte, never buffering
// a 100–400 MB body. A FACEIT demo comes back as a 302 to its signed https
// link, which is handed to the browser to follow itself. Range goes up and
// 206/Content-Range come down so a browser can resume. The backend fences the
// streams per visitor, so forward the real IP.
export const dynamic = "force-dynamic";

// Headers the browser needs from the backend's answer; nothing else leaks.
const PASS = [
  "content-type",
  "content-disposition",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "last-modified",
  "etag",
  "location",
  "retry-after",
  "x-content-type-options",
];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ steamid: string; gameId: string }> },
): Promise<Response> {
  const { steamid, gameId } = await params;
  const fwd = trustedClientIp(req);
  // finishedAt / score: only used for legacy-format rows (see the backend).
  const qs = new URL(req.url).search;
  const headers: Record<string, string> = { ...(fwd ? { "x-real-ip": fwd } : {}), ...internalHeaders() };
  for (const h of ["range", "if-range"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/players/${encodeURIComponent(steamid)}/leetify-game/${encodeURIComponent(gameId)}/demo/file${qs}`,
      {
        headers,
        cache: "no-store",
        // A FACEIT answer is a redirect for the BROWSER to follow, not us.
        redirect: "manual",
        signal: req.signal,
      },
    );
    const out = new Headers({ "cache-control": "no-store" });
    for (const h of PASS) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    return Response.json(
      { available: false, code: "backend_unreachable", reason: `cannot reach backend (${(err as Error).message})` },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
