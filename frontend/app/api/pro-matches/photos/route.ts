import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Browsers report the pro-player photos they resolved from Liquipedia
// (lib/liquipediaClient.ts reportPlayerPhoto); the backend keeps them and the
// spotlight hands them to every later visitor. Forwarded as-is, with the real
// client IP so the backend's per-address cap applies to the visitor, not to
// this proxy.
export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  if (body.length > MAX_BODY) {
    return Response.json({ error: "report too large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  const ip = trustedClientIp(req);
  try {
    const res = await fetch(`${API_BASE}/api/pro-matches/photos`, {
      method: "POST",
      headers: {
        ...internalHeaders(),
        "content-type": "application/json",
        ...(ip ? { "X-Real-IP": ip } : {}),
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    // A lost report costs nothing: the next visitor who resolves the photo
    // reports it again.
    return Response.json({ error: "backend unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
