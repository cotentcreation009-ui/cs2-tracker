import { NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";

// Same-origin proxy so the browser can enqueue a parse job without the backend
// needing a public CORS surface.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await fetch(`${API_BASE}/api/ingest/demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `backend unreachable: ${(e as Error).message}` },
      { status: 502 },
    );
  }
}
