import { API_BASE, internalHeaders, trustedClientIp } from "@/lib/api";

// Proxy a player summary to the backend's AI read endpoint (Vertex AI / Gemini,
// or Anthropic fallback). Rate-limited server-side; forward the real client IP
// for that limiter.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const fwd = trustedClientIp(req);
  try {
    const res = await fetch(`${API_BASE}/api/ai/analyze`, {
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
