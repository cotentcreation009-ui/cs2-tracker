"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getMatch } from "@/lib/demo/store";
import type { ReplayMeta, ReplayRound } from "@/lib/demo/types";
import { mapLabel } from "@/lib/format";
import { StrategyMap } from "@/components/demo/StrategyMap";

// Standalone heatmap route. The same view is also a tab inside the demo viewer
// (/demos/[id]); this page exists for direct/bookmarked links and reuses the
// shared StrategyMap component.
export default function StrategyMapPage() {
  const { id } = useParams<{ id: string }>();
  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [rounds, setRounds] = useState<ReplayRound[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getMatch(id);
        if (!alive || !m) return;
        setMeta(m.summary.meta);
        setRounds(m.rounds);
        setName(m.summary.name);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading)
    return <div className="card px-5 py-6 text-sm text-muted">Loading…</div>;
  if (!meta)
    return (
      <div className="card px-5 py-6 text-sm text-muted">
        Match not found.{" "}
        <Link href="/demos" className="text-brand hover:underline">
          Back to demos
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/demos/${id}`}
          className="text-xs text-muted hover:text-ink"
        >
          ← Replay
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight">
          Heatmap{" "}
          <span className="pill bg-panel capitalize text-muted">
            {mapLabel(meta.map)}
          </span>
        </h1>
      </div>
      <StrategyMap meta={meta} rounds={rounds} name={name} />
    </div>
  );
}
