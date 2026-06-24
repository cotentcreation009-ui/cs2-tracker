import { NextResponse } from "next/server";
import { API_BASE, internalHeaders } from "@/lib/api";

// Same-origin proxy so the client search box can autocomplete without the
// backend needing a public CORS surface. Short-cached for repeated prefixes.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ players: [] });
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=8`,
      { next: { revalidate: 60 }, headers: internalHeaders() },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ players: [] });
  }
}
