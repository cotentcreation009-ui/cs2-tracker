import { NextResponse } from "next/server";
import { API_BASE } from "@/lib/api";

// Same-origin proxy for polling parse-job status from the browser.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const res = await fetch(
      `${API_BASE}/api/jobs/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
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
