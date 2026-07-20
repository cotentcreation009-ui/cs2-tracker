"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DEMO_BYTES,
  WARN_DEMO_BYTES,
  mb,
  parseDemoFile,
  parseDemoFromUrl,
  type ParseHandlers,
} from "@/lib/demo/parseClient";
import { computePercent, phaseOf, type UploadPhase } from "@/lib/demo/uploadProgress";
import {
  deleteMatch,
  listMatches,
  renameMatch,
  saveMatch,
  type MatchSummary,
} from "@/lib/demo/store";
import { hasCalibration, radarImage } from "@/lib/maps/calibration";
import { mapLabel } from "@/lib/format";

export function DemosClient() {
  const [list, setList] = useState<MatchSummary[]>([]);
  const [parsing, setParsing] = useState(false);
  const [phase, setPhase] = useState(""); // human label
  const [percent, setPercent] = useState(0); // 0..100, monotonic
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const acRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // progress model state: current phase, real upload fraction, and when the
  // (time-eased) parse phase began. percentRef enforces monotonicity.
  const lifeRef = useRef<UploadPhase>("idle");
  const uploadFracRef = useRef(0);
  const parseStartRef = useRef(0);
  const hasUploadRef = useRef(true);
  const percentRef = useRef(0);

  const recompute = useCallback(() => {
    const p = computePercent({
      phase: lifeRef.current,
      uploadFraction: uploadFracRef.current,
      parseElapsedMs: parseStartRef.current ? Date.now() - parseStartRef.current : 0,
      hasUpload: hasUploadRef.current,
    });
    if (p > percentRef.current) percentRef.current = p;
    setPercent(Math.min(100, Math.round(percentRef.current)));
  }, []);

  // resets the progress model at the start of a new upload/parse
  const beginProgress = useCallback((hasUpload: boolean) => {
    lifeRef.current = hasUpload ? "uploading" : "queueing";
    uploadFracRef.current = 0;
    parseStartRef.current = 0;
    hasUploadRef.current = hasUpload;
    percentRef.current = 0;
    setPercent(0);
  }, []);

  // shared onPhase/onUploadProgress handlers for both the file and URL paths
  const progressHandlers = useCallback(
    (): Pick<ParseHandlers, "onPhase" | "onUploadProgress"> => ({
      onPhase: (label) => {
        setPhase(label);
        const ph = phaseOf(label);
        lifeRef.current = ph;
        if (ph === "parsing" && !parseStartRef.current) parseStartRef.current = Date.now();
        recompute();
      },
      onUploadProgress: (f) => {
        uploadFracRef.current = f;
        recompute();
      },
    }),
    [recompute],
  );

  // during the parse phase the bar advances on a time curve — tick it forward
  useEffect(() => {
    if (!parsing || phaseOf(phase) !== "parsing") return;
    const iv = setInterval(recompute, 250);
    return () => clearInterval(iv);
  }, [parsing, phase, recompute]);

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
      beginProgress(true);
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const { meta, rounds } = await parseDemoFile(file, {
          ...progressHandlers(),
          signal: ac.signal,
        });
        setPhase("saving…");
        lifeRef.current = "saving";
        recompute();
        const name = file.name.replace(/\.dem$/i, "");
        await saveMatch(meta, rounds, name);
        lifeRef.current = "done";
        percentRef.current = 100;
        setPercent(100);
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
    [refresh, beginProgress, progressHandlers, recompute],
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
    beginProgress(false); // server fetches the demo — no client upload phase
    const ac = new AbortController();
    acRef.current = ac;
    try {
      const { meta, rounds } = await parseDemoFromUrl(u, {
        ...progressHandlers(),
        signal: ac.signal,
      });
      setPhase("saving…");
      lifeRef.current = "saving";
      recompute();
      // Display name: FACEIT room links get "FACEIT <id>"; file URLs use the
      // basename with the (possibly compressed) .dem extension stripped.
      const roomMatch = u.match(/\/room\/([0-9]+-[0-9a-f-]{36})/i) ?? u.match(/^([0-9]+-[0-9a-f-]{36})$/i);
      const name = roomMatch
        ? `FACEIT ${roomMatch[1].slice(0, 10)}…`
        : (u.split("?")[0].split("/").pop() || "demo").replace(
            /\.dem(\.(bz2|gz|zst))?$/i,
            "",
          ) || "Demo";
      await saveMatch(meta, rounds, name);
      lifeRef.current = "done";
      percentRef.current = 100;
      setPercent(100);
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
  }, [url, parsing, refresh, beginProgress, progressHandlers, recompute]);

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
            <div className="relative grid h-14 w-14 place-items-center">
              {/* circular percentage ring */}
              <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-panel" />
                <circle
                  cx="18"
                  cy="18"
                  r="16"
                  fill="none"
                  stroke="url(#demoProgress)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 16}
                  strokeDashoffset={2 * Math.PI * 16 * (1 - percent / 100)}
                  style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
                />
                <defs>
                  <linearGradient id="demoProgress" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" />
                    <stop offset="100%" stopColor="var(--color-brand2)" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="text-xs font-bold tabular-nums text-ink">{percent}%</span>
            </div>
            <div className="text-sm font-semibold text-ink">{phase || "working…"}</div>
            <div
              className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-panel"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Demo processing progress"
            >
              <div
                className="relative h-full overflow-hidden rounded-full bg-linear-to-r from-brand to-brand2"
                style={{ width: `${percent}%`, transition: "width 0.3s ease-out" }}
              >
                {/* sweeping sheen so the bar reads as active even while the
                    parse phase eases slowly toward its ceiling */}
                <div className="progress-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-white/25 to-transparent" />
              </div>
            </div>
            <div className="text-[11px] text-faint">
              {phaseOf(phase) === "uploading"
                ? "Uploading your demo to our servers…"
                : phaseOf(phase) === "parsing"
                  ? "Parsing on our servers — large demos can take a minute or two."
                  : "Large demos can take a minute or two."}
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

      {/* parse from a link — server fetches the demo, no local file needed.
          Accepts a FACEIT match-room link (resolved to its demo via the FACEIT
          API) or a direct .dem/.bz2/.gz/.zst URL. */}
      <div className="card-2 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">
          Or parse from a link
        </div>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleUrl();
          }}
          placeholder="FACEIT match link (faceit.com/…/room/…)  ·  or a direct .dem/.bz2/.zst URL"
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
