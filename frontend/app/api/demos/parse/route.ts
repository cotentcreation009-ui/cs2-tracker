import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Tell the backend to enqueue parsing for a demo that was already uploaded
// directly to object storage via a presigned URL. Quota is charged here, so
// forward the real client IP (not the spoofable XFF).
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const fwd = trustedClientIp(req);
  try {
    const res = await fetch(`${API_BASE}/api/demos/parse`, {
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
