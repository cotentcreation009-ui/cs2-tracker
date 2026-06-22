import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

// Same-origin proxy so the browser can enqueue a parse job without the backend
// needing a public CORS surface. We forward the signed session token as
// X-CS2-Session (read from the httpOnly cookie here on the server); the backend
// verifies it against the shared secret and records the submitter. We never let
// the client set this header — it's taken only from the cookie.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) headers["X-CS2-Session"] = token;

  try {
    const res = await fetch(`${API_BASE}/api/ingest/demo`, {
      method: "POST",
      headers,
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
