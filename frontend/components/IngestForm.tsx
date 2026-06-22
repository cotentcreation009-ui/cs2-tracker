"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { IngestJob } from "@/lib/types";

type Mode = "demoPath" | "demoUrl" | "shareCode";

const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: "demoPath", label: "File path", placeholder: "/demos/match.dem" },
  { key: "demoUrl", label: "URL", placeholder: "https://…/match.dem.bz2" },
  { key: "shareCode", label: "Share code", placeholder: "CSGO-xxxxx-xxxxx-…" },
];

const statusTone: Record<string, string> = {
  queued: "bg-mid/15 text-mid",
  running: "bg-brand/15 text-brand",
  done: "bg-good/15 text-good",
  failed: "bg-bad/15 text-bad",
};

export function IngestForm({
  signedInAs = null,
}: {
  signedInAs?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("demoPath");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("local");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<IngestJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Poll the job status until it is terminal.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const j = (await res.json()) as IngestJob;
        if (!active) return;
        setJob(j);
        if (j.status === "done" || j.status === "failed") {
          clearInterval(iv);
        }
      } catch {
        /* transient; keep polling */
      }
    };
    const iv = setInterval(tick, 1500);
    tick();
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [jobId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJob(null);
    setJobId(null);
    const v = value.trim();
    if (!v) {
      setError("Enter a value first.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, string> = { source };
      body[mode] = v;
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `request failed (${res.status})`);
        return;
      }
      setJobId(data.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const active = MODES.find((m) => m.key === mode)!;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card-2 space-y-4 px-5 py-5">
        <div className="inline-flex rounded-lg border border-line bg-panel p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === m.key
                  ? "bg-brand/20 text-brand"
                  : "text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div>
          <label className="stat-label">{active.label}</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={active.placeholder}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-line bg-panel py-2 px-3 text-sm outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="stat-label">Source</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-panel py-2 px-3 text-sm outline-none transition focus:border-brand/60"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-bg transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Queueing…" : "Ingest"}
          </button>
        </div>

        {mode === "shareCode" && (
          <p className="text-xs text-faint">
            Share-code ingest needs the Game Coordinator client (roadmap). Use a
            file path or URL for now.
          </p>
        )}
        {signedInAs ? (
          <p className="text-xs text-faint">
            Attributed to{" "}
            <span className="font-medium text-muted">{signedInAs}</span>.
          </p>
        ) : (
          <p className="text-xs text-faint">
            <a href="/api/auth/steam/login" className="text-brand hover:underline">
              Sign in through Steam
            </a>{" "}
            to attribute ingests to your profile.
          </p>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>

      {(jobId || job) && (
        <div className="card px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="stat-label">Job</div>
              <div className="font-mono text-xs text-faint">{jobId}</div>
            </div>
            <span
              className={`pill ${statusTone[job?.status ?? "queued"] ?? "bg-panel2 text-muted"}`}
            >
              {job?.status ?? "queued"}
            </span>
          </div>

          {job?.status === "done" && job.matchId != null && (
            <Link
              href={`/matches/${job.matchId}`}
              className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
            >
              View match #{job.matchId} →
            </Link>
          )}
          {job?.status === "failed" && job.error && (
            <p className="mt-2 break-words text-sm text-bad">{job.error}</p>
          )}
          {(!job || job.status === "queued" || job.status === "running") && (
            <p className="mt-2 text-sm text-muted">
              Waiting for a worker to pick this up…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
