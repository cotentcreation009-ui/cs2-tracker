"use client";

import Link from "next/link";
import { useState } from "react";
import { ZoneEditor } from "@/components/demo/ZoneEditor";
import { mapLabel } from "@/lib/format";

const POOL = [
  "de_dust2", "de_mirage", "de_inferno", "de_nuke", "de_overpass",
  "de_ancient", "de_anubis", "de_vertigo", "de_train", "de_cache",
];

export default function ZonesPage() {
  const [map, setMap] = useState(POOL[0]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/demos" className="text-xs text-muted hover:text-ink">← Demos</Link>
          <h1 className="text-xl font-extrabold tracking-tight">Call-out zones</h1>
          <p className="text-xs text-muted">
            Built-in callouts ship for every map. Make your own set (in your language) or draw one from scratch — the active set labels positions &amp; utility everywhere.
          </p>
        </div>
        <select
          value={map}
          onChange={(e) => setMap(e.target.value)}
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm capitalize"
        >
          {POOL.map((m) => <option key={m} value={m}>{mapLabel(m)}</option>)}
        </select>
      </div>

      <ZoneEditor map={map} />
    </div>
  );
}
