"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DEMO_BYTES,
  WARN_DEMO_BYTES,
  mb,
  parseDemoFile,
} from "@/lib/demo/parseClient";
import {
  deleteMatch,
  listMatches,
  renameMatch,
  saveMatch,
  type MatchSummary,
} from "@/lib/demo/store";
import { hasCalibration } from "@/lib/maps/calibration";
import { mapLabel } from "@/lib/format";

export default function DemosPage() {
  const [list, setList] = useState<MatchSummary[]>([]);
  const [parsing, setParsing] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Demo analysis <span className="pill bg-brand/15 text-brand">BETA</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Upload a CS2 <span className="font-mono">.dem</span> — we parse it on
            our servers, then save it to your local library for radar replay and
            analysis. The raw demo is deleted right after parsing.
          </p>
        </div>
        <Link href="/demos/zones" className="btn btn-ghost shrink-0 text-sm">
          Zone editor
        </Link>
      </header>

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
        className={`card-2 flex flex-col items-center justify-center gap-3 px-6 py-10 text-center transition-colors ${
          dragOver ? "border-brand/60 bg-brand/5" : ""
        }`}
      >
        {parsing ? (
          <>
            <div className="text-sm font-medium text-ink">
              {phase || "working…"}
            </div>
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
            <div className="text-3xl opacity-40">⬆</div>
            <div className="text-sm text-muted">
              Drag a <span className="font-mono">.dem</span> here, or
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

      {error && (
        <div className="card border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {/* library */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
          Your match library{" "}
          {list.length > 0 && <span className="text-faint">· {list.length}</span>}
        </h2>
        {list.length === 0 ? (
          <div className="card px-4 py-6 text-sm text-muted">
            No demos yet — upload one above to get started.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((m) => (
              <li key={m.id} className="card lift px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{m.name}</span>
                  <span className="pill bg-panel capitalize text-muted">
                    {mapLabel(m.meta.map)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>{m.meta.rounds} rounds</span>
                  <span>{m.meta.players.length} players</span>
                  <span>{new Date(m.savedAt).toLocaleDateString()}</span>
                  {!hasCalibration(m.meta.map) && (
                    <span className="text-mid">radar uncalibrated</span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
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
                    className="btn btn-ghost px-3 py-1.5 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
