"use client";

// "Your form" — the library's identity + trends card. Mark yourself once
// (auto-suggested from roster frequency: your id is in every demo you save)
// and the library turns into a form tracker: K/D, ADR, HS% and reaction
// sparklines across your saved demos, W-L record, and per-map form.

import { useEffect, useMemo, useState } from "react";
import { getMatch, type MatchSummary } from "@/lib/demo/store";
import {
  demoDigest,
  getMe,
  loadDigest,
  saveDigest,
  setMe,
  suggestMe,
  type DemoDigest,
  type MeIdentity,
} from "@/lib/demo/me";
import { mapLabel } from "@/lib/format";

const DISMISS_KEY = "demos:me-suggest-dismissed";

interface Row {
  id: string;
  name: string;
  savedAt: number;
  map: string;
  d: DemoDigest;
}

function Spark({
  label,
  rows,
  value,
  fmt,
  goodUp = true,
}: {
  label: string;
  rows: Row[];
  value: (d: DemoDigest) => number | null;
  fmt: (v: number) => string;
  goodUp?: boolean;
}) {
  const pts = rows
    .map((r, i) => ({ i, r, v: value(r.d) }))
    .filter((p): p is { i: number; r: Row; v: number } => p.v != null);
  if (pts.length < 2) return null;
  const W = 220;
  const H = 26;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, 1e-3);
  const x = (i: number) => (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * W);
  const y = (v: number) => H - 3 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (H - 6);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1].v;
  const first = pts[0].v;
  const trendUp = last >= first;
  const trendGood = goodUp ? trendUp : !trendUp;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wide text-faint">{label}</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6.5 min-w-0 flex-1" aria-label={`${label} per demo`}>
        <polyline points={line} fill="none" stroke="#7f8ea3" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => (
          <rect key={p.i} x={x(p.i) - W / (2 * rows.length)} y={0} width={W / rows.length} height={H} fill="transparent">
            <title>{`${p.r.name} · ${new Date(p.r.savedAt).toLocaleDateString()} · ${fmt(p.v)}${p.r.d.matchWon == null ? "" : p.r.d.matchWon ? " · won" : " · lost"}`}</title>
          </rect>
        ))}
      </svg>
      <span className={`w-13 shrink-0 text-right text-[11px] font-semibold tabular-nums ${trendGood ? "text-good" : "text-bad"}`}>
        {fmt(last)}
      </span>
    </div>
  );
}

export function YourForm({ summaries }: { summaries: MatchSummary[] }) {
  const [me, setMeState] = useState<MeIdentity | null>(null);
  const [dismissed, setDismissed] = useState(true); // SSR-safe: suggest only after mount
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    setMeState(getMe());
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const suggestion = useMemo(() => {
    const top = suggestMe(summaries)[0];
    return top && top.demos >= 2 ? top : null;
  }, [summaries]);

  // build digests: cached per (demo, steamId); only cache misses read rounds
  useEffect(() => {
    if (!me) {
      setRows(null);
      return;
    }
    let alive = true;
    (async () => {
      const out: Row[] = [];
      for (const s of [...summaries].sort((a, b) => a.savedAt - b.savedAt)) {
        if (!s.meta.players?.some((p) => p.steamId === me.steamId)) continue;
        let d = loadDigest(s.id, me.steamId);
        if (!d) {
          const m = await getMatch(s.id).catch(() => null);
          if (!m) continue;
          d = demoDigest(m.summary.meta, m.rounds, me.steamId);
          if (d) saveDigest(s.id, me.steamId, d);
        }
        if (d) out.push({ id: s.id, name: s.name, savedAt: s.savedAt, map: s.meta.map, d });
      }
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, [me, summaries]);

  const record = useMemo(() => {
    if (!rows) return null;
    const w = rows.filter((r) => r.d.matchWon === true).length;
    const l = rows.filter((r) => r.d.matchWon === false).length;
    const byMap = new Map<string, { kills: number; deaths: number; n: number }>();
    for (const r of rows) {
      const m = byMap.get(r.map) ?? { kills: 0, deaths: 0, n: 0 };
      m.kills += r.d.kills;
      m.deaths += r.d.deaths;
      m.n++;
      byMap.set(r.map, m);
    }
    const maps = [...byMap.entries()]
      .map(([map, m]) => ({ map, kd: m.kills / Math.max(1, m.deaths), n: m.n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 4);
    return { w, l, maps };
  }, [rows]);

  // no identity yet: one unobtrusive suggestion line (dismissible per session)
  if (!me) {
    if (!suggestion || dismissed) return null;
    return (
      <div className="card flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
        <span className="text-muted">
          Are you <span className="font-bold text-ink">{suggestion.name}</span>? They appear in{" "}
          <span className="tabular-nums">{suggestion.demos}</span> of your saved demos — mark yourself to unlock
          form trends across your library.
        </span>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => {
              const id = { steamId: suggestion.steamId, name: suggestion.name };
              setMe(id);
              setMeState(id);
            }}
            className="btn btn-primary px-2.5 py-1 text-xs"
          >
            ★ This is me
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              try {
                sessionStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* session only */
              }
            }}
            className="btn btn-ghost px-2.5 py-1 text-xs"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (!rows) return null; // digests still loading — the card pops in when ready
  if (rows.length < 2) {
    return (
      <div className="card flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-muted">
        <span>
          ★ You&apos;re <span className="font-bold text-ink">{me.name}</span> — analyze another of your demos and
          this becomes a form tracker (K/D, ADR, reaction trends across your library).
        </span>
        <button
          type="button"
          onClick={() => {
            setMe(null);
            setMeState(null);
          }}
          className="ml-auto shrink-0 text-faint underline decoration-dotted underline-offset-2 hover:text-ink"
        >
          not me
        </button>
      </div>
    );
  }

  return (
    <section className="card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="stat-label">Your form</span>
        <span className="text-xs font-bold text-ink">★ {me.name}</span>
        {record && (record.w > 0 || record.l > 0) && (
          <span className="pill bg-panel text-xs tabular-nums">
            <span className="text-good">{record.w}W</span>
            <span className="text-faint"> – </span>
            <span className="text-bad">{record.l}L</span>
          </span>
        )}
        <span className="text-[10px] text-faint">across {rows.length} demos · oldest → newest · hover a column</span>
        <button
          type="button"
          onClick={() => {
            setMe(null);
            setMeState(null);
          }}
          title="Clear the identity"
          className="ml-auto shrink-0 text-[10px] text-faint underline decoration-dotted underline-offset-2 hover:text-ink"
        >
          not me
        </button>
      </div>
      <div className="grid gap-x-6 gap-y-1.5 lg:grid-cols-2">
        <Spark label="K/D" rows={rows} value={(d) => d.kills / Math.max(1, d.deaths)} fmt={(v) => v.toFixed(2)} />
        <Spark label="ADR" rows={rows} value={(d) => d.adr} fmt={(v) => v.toFixed(0)} />
        <Spark label="HS %" rows={rows} value={(d) => d.hsPct} fmt={(v) => `${v.toFixed(0)}%`} />
        <Spark label="Reaction" rows={rows} value={(d) => d.reactionMs} fmt={(v) => `${v.toFixed(0)}ms`} goodUp={false} />
      </div>
      {record && record.maps.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[11px]">
          <span className="text-[10px] font-bold uppercase tracking-wide text-faint">By map</span>
          {record.maps.map((m) => (
            <span key={m.map} className="pill bg-panel tabular-nums text-muted" title={`${m.n} demo${m.n === 1 ? "" : "s"} on ${mapLabel(m.map)}`}>
              <span className="capitalize">{mapLabel(m.map)}</span>{" "}
              <span className={m.kd >= 1 ? "text-good" : "text-bad"}>{m.kd.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
