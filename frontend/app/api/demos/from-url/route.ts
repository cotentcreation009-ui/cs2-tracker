import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Ask the backend to fetch + parse a demo from a remote URL (server-side
// download). Quota is charged here, so forward the real client IP.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const fwd = trustedClientIp(req);
  try {
    const res = await fetch(`${API_BASE}/api/demos/from-url`, {
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
