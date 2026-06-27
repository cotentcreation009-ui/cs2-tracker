"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DEMO_BYTES,
  WARN_DEMO_BYTES,
  mb,
  parseDemoFile,
  parseDemoFromUrl,
} from "@/lib/demo/parseClient";
import {
  deleteMatch,
  listMatches,
  renameMatch,
  saveMatch,
  type MatchSummary,
} from "@/lib/demo/store";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { mapLabel } from "@/lib/format";

export default function DemosPage() {
  const [list, setList] = useState<MatchSummary[]>([]);
  const [parsing, setParsing] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const acRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await listMatches());
    } catch {
      /* IndexedDB unavailable (private mode) — leave empty */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith(".dem")) {
        setError("That's not a .dem file.");
        return;
      }
      if (file.size > MAX_DEMO_BYTES) {
        setError(
          `That demo is ${mb(file.size)} — over the ${mb(MAX_DEMO_BYTES)} in-browser limit. Try a smaller/competitive demo.`,
        );
        return;
      }
      setParsing(true);
      setPhase("uploading…");
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const { meta, rounds } = await parseDemoFile(file, {
          onPhase: (p) => setPhase(p),
          signal: ac.signal,
        });
        const name = file.name.replace(/\.dem$/i, "");
        await saveMatch(meta, rounds, name);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== "cancelled") setError(msg);
      } finally {
        setParsing(false);
        setPhase("");
        acRef.current = null;
      }
    },
    [refresh],
  );

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = "";
  };

  const handleUrl = useCallback(async () => {
    const u = url.trim();
    if (!u || parsing) return;
    setError(null);
    setParsing(true);
    setPhase("queueing…");
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const { meta, rounds } = await parseDemoFromUrl(u, {
        onPhase: (p) => setPhase(p),
        signal: ac.signal,
      });
      const name =
        (u.split("?")[0].split("/").pop() || "demo").replace(
          /\.dem(\.(bz2|gz))?$/i,
          "",
        ) || "Demo";
      await saveMatch(meta, rounds, name);
      setUrl("");
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "cancelled") setError(msg);
    } finally {
      setParsing(false);
      setPhase("");
      acRef.current = null;
    }
  }, [url, parsing, refresh]);

  return (
    <div className="space-y-6">
      {/* hero */}
      <section className="card-2 relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero-holo.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.18]"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(4,6,14,0.35), rgba(14,23,48,0.94))",
            }}
          />
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-3 px-5 py-6">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Demo analysis{" "}
              <span className="pill bg-brand/15 align-middle text-brand">BETA</span>
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              Upload a CS2 <span className="font-mono text-ink/80">.dem</span> — we
              parse it on our servers into a 2D radar replay with route, weapon and
              player analysis. The raw demo is deleted right after parsing.
            </p>
          </div>
          <Link href="/demos/zones" className="btn btn-ghost shrink-0 text-sm">
            Zone editor
          </Link>
        </div>
      </section>

      {/* dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !parsing) void handleFile(f);
        }}
        className={`card-2 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center transition ${
          dragOver
            ? "border-brand/70 bg-brand/5 ring-2 ring-brand/30"
            : "hover:border-line/80"
        }`}
      >
        {parsing ? (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand">
              <svg viewBox="0 0 24 24" className="h-6 w-6 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-ink">{phase || "working…"}</div>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-panel">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-linear-to-r from-brand to-brand2" />
            </div>
            <div className="text-[11px] text-faint">
              Large demos can take a minute or two.
            </div>
            <button
              type="button"
              onClick={() => acRef.current?.abort()}
              className="btn btn-ghost mt-1"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
              </svg>
            </div>
            <div className="text-base font-semibold text-ink">
              Drop a <span className="font-mono text-brand">.dem</span> to analyze
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn btn-primary"
            >
              Choose a demo file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".dem"
              onChange={onPick}
              className="hidden"
            />
            <div className="text-[11px] text-faint">
              Parsed on our servers · up to {mb(MAX_DEMO_BYTES)} · demos over{" "}
              {mb(WARN_DEMO_BYTES)} take a little longer
            </div>
          </>
        )}
      </div>

      {/* parse from a link — server fetches the demo, no local file needed */}
      <div className="card-2 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
          Or parse from a link
        </div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleUrl();
          }}
          placeholder="https://…/match.dem  ·  FACEIT demo link or GOTV .dem/.bz2"
          disabled={parsing}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink placeholder:text-faint disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleUrl()}
          disabled={parsing || !url.trim()}
          className="btn btn-ghost shrink-0 text-sm disabled:opacity-40"
        >
          Parse link
        </button>
      </div>

      {error && (
        <div className="card flex items-center gap-2 border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
          </svg>
          {error}
        </div>
      )}

      {/* library */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <span className="h-3.5 w-1 rounded-full bg-linear-to-b from-brand to-brand2" />
          Your match library
          {list.length > 0 && (
            <span className="pill bg-panel text-faint">{list.length}</span>
          )}
        </h2>
        {list.length === 0 ? (
          <div className="card px-4 py-10 text-center text-sm text-muted">
            No demos yet — upload one above to get started.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((m) => {
              const calibrated = hasCalibration(m.meta.map);
              return (
                <li key={m.id} className="card lift group overflow-hidden p-0">
                  <Link href={`/demos/${m.id}`} className="block">
                    <div className="relative aspect-16/10 overflow-hidden bg-panel2">
                      {calibrated ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={radarImage(m.meta.map)}
                          alt={mapLabel(m.meta.map)}
                          className="absolute inset-0 h-full w-full object-cover opacity-60 transition duration-300 group-hover:scale-105 group-hover:opacity-80"
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center bg-linear-to-br from-panel2 to-panel text-3xl text-faint">
                          ◎
                        </div>
                      )}
                      <div className="absolute inset-0 bg-linear-to-t from-[rgba(4,6,14,0.95)] via-[rgba(4,6,14,0.30)] to-transparent" />
                      <div className="absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
                        <span className="truncate text-sm font-bold text-ink drop-shadow">
                          {m.name}
                        </span>
                        <span className="pill shrink-0 bg-black/40 capitalize text-ink backdrop-blur">
                          {mapLabel(m.meta.map)}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span className="tabular-nums">{m.meta.rounds} rounds</span>
                      <span className="tabular-nums">
                        {m.meta.players.length} players
                      </span>
                      <span>{new Date(m.savedAt).toLocaleDateString()}</span>
                      {!calibrated && (
                        <span className="text-mid">radar uncalibrated</span>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Link
                        href={`/demos/${m.id}`}
                        className="btn btn-primary px-3 py-1.5 text-xs"
                      >
                        Open replay
                      </Link>
                      <button
                        type="button"
                        onClick={async () => {
                          const n = window.prompt("Rename match", m.name);
                          if (n && n.trim()) {
                            await renameMatch(m.id, n.trim());
                            void refresh();
                          }
                        }}
                        className="btn btn-ghost px-3 py-1.5 text-xs"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteMatch(m.id);
                          void refresh();
                        }}
                        className="btn btn-ghost ml-auto px-3 py-1.5 text-xs text-muted hover:text-bad"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
