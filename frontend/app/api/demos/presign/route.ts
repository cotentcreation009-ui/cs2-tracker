import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Ask the backend for a direct-to-object-storage upload URL (or a signal to use
// the multipart fallback). Forwards the real client IP so the backend's per-IP
// quota counts the uploader, not this proxy.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const fwd = trustedClientIp(req);
  try {
    const res = await fetch(`${API_BASE}/api/demos/presign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(fwd ? { "x-real-ip": fwd } : {}),
        ...internalHeaders(),
      },
      body,
    });
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
