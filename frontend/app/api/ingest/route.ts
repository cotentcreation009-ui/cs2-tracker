import { NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";
import { getSession } from "@/lib/session";

// Same-origin proxy so the browser can enqueue a parse job without the backend
// needing a public CORS surface. When the user is signed in, the job is
// attributed to their Steam account via X-CS2-User — derived from the *verified*
// session cookie here on the server, never from anything the client sent.
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
  const session = await getSession();
  if (session) headers["X-CS2-User"] = session.steamId64;

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
