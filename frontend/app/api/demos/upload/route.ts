import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Same-origin upload proxy: the browser POSTs the .dem here and we stream it
// straight through to the (internal-only) Go backend with the internal token.
// Streaming (duplex: "half") avoids buffering a multi-hundred-MB demo in memory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  const fwd = trustedClientIp(req);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/demos/upload`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        ...(fwd ? { "x-real-ip": fwd } : {}),
        ...internalHeaders(),
      },
      body: req.body,
      // duplex is required by Node's fetch to stream a request body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (err) {
    return Response.json(
      { error: `cannot reach backend (${(err as Error).message})` },
      { status: 502 },
    );
  }
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
