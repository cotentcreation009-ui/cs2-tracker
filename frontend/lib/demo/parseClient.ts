// Orchestrates server-side demo parsing from the browser.
//
// Primary path (object storage configured): ask the backend to presign a URL,
// PUT the .dem *directly* to the bucket (bypassing our servers and Cloudflare's
// upload-size limit — this is how 300MB+ demos work), then trigger parsing.
//
// Fallback path (no object storage): POST the demo through our server as
// multipart, capped well under Cloudflare's 100MB limit.
//
// Both paths converge on the same poll + fetch, returning the same
// { meta, rounds } the views consume — callers don't change.
import type { ReplayMeta, ReplayRound } from "./types";

// Optimistic client-side ceiling for an instant sanity check before we even ask
// the backend. The backend enforces the real per-path cap (and rejects oversize
// uploads with a clear error), so this only stops absurd files early.
export const MAX_DEMO_BYTES = 600 * 1024 * 1024;
// Above this the upload/parse just takes longer; we surface a gentle warning.
export const WARN_DEMO_BYTES = 200 * 1024 * 1024;

export interface ParseHandlers {
  onReady?: () => void; // upload accepted; server has started parsing
  onProgress?: (rounds: number) => void; // kept for API compatibility (unused)
  onPhase?: (phase: string) => void; // human-readable status updates
  onUploadProgress?: (fraction: number) => void; // 0..1 bytes sent (upload phase)
  signal?: AbortSignal;
}

export interface ParseResult {
  meta: ReplayMeta;
  rounds: ReplayRound[];
}

interface PresignResp {
  mode: "gcs" | "direct";
  id?: string;
  url?: string;
  contentType?: string;
  maxBytes?: number;
  error?: string;
}

interface DemoStatus {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  map: string;
  filename: string;
  error?: string;
}

export function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("cancelled"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function errText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `${fallback} (${res.status})`;
}

interface XhrResult {
  status: number;
  responseText: string;
}

// fetch() exposes no upload-progress events, so uploads that need a real byte
// percentage go through XMLHttpRequest, which fires upload.onprogress. Rejects
// with Error("cancelled") on abort and Error("network") on transport failure so
// callers can map those to friendly, path-specific messages.
function xhrUpload(opts: {
  url: string;
  method: "PUT" | "POST";
  body: Blob | FormData;
  headers?: Record<string, string>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method, opts.url, true);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    if (opts.onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress!(e.loaded / e.total);
      };
    }
    const onAbort = () => xhr.abort();
    xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText });
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("cancelled"));
    xhr.onloadend = () => opts.signal?.removeEventListener("abort", onAbort);
    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return reject(new Error("cancelled"));
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.send(opts.body);
  });
}

// Uploads the demo (via object storage if available, else through our server)
// and returns the parse-job id to poll.
async function uploadAndQueue(
  file: File,
  handlers: ParseHandlers,
): Promise<string> {
  const { signal } = handlers;
  const contentType = file.type || "application/octet-stream";

  const pres = await fetch("/api/demos/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      size: file.size,
    }),
    signal,
  });
  if (!pres.ok) throw new Error(await errText(pres, "could not start upload"));
  const info = (await pres.json()) as PresignResp;

  // Primary: direct-to-object-storage upload (XHR so we get real byte progress).
  if (info.mode === "gcs" && info.url && info.id) {
    handlers.onPhase?.("uploading…");
    let put: XhrResult;
    try {
      put = await xhrUpload({
        url: info.url,
        method: "PUT",
        body: file,
        headers: { "content-type": info.contentType || contentType },
        onProgress: handlers.onUploadProgress,
        signal,
      });
    } catch (e) {
      // A thrown request here is a cancel, or (most often) a CORS/network
      // failure on the direct-to-storage PUT — normalize both so the UI shows
      // something sensible instead of a raw transport error.
      if ((e as Error).message === "cancelled" || signal?.aborted) {
        throw new Error("cancelled");
      }
      throw new Error("Upload to storage failed — please try again.");
    }
    if (put.status < 200 || put.status >= 300) {
      throw new Error(`Upload to storage failed (${put.status}).`);
    }
    handlers.onUploadProgress?.(1);
    handlers.onPhase?.("queueing…");
    const trig = await fetch("/api/demos/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: info.id }),
      signal,
    });
    if (!trig.ok) throw new Error(await errText(trig, "could not start parsing"));
    return info.id;
  }

  // Fallback: multipart through our server (size-limited).
  const cap = info.maxBytes ?? 0;
  if (cap > 0 && file.size > cap) {
    throw new Error(
      `That demo is ${mb(file.size)} — too large for upload here (limit ${mb(cap)}).`,
    );
  }
  handlers.onPhase?.("uploading…");
  const form = new FormData();
  form.append("demo", file, file.name);
  let up: XhrResult;
  try {
    up = await xhrUpload({
      url: "/api/demos/upload",
      method: "POST",
      body: form, // browser sets the multipart content-type + boundary
      onProgress: handlers.onUploadProgress,
      signal,
    });
  } catch (e) {
    if ((e as Error).message === "cancelled" || signal?.aborted) throw new Error("cancelled");
    throw new Error("upload failed");
  }
  if (up.status < 200 || up.status >= 300) {
    let msg = `upload failed (${up.status})`;
    try {
      const b = JSON.parse(up.responseText) as { error?: string };
      if (b.error) msg = b.error;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  handlers.onUploadProgress?.(1);
  const { id } = JSON.parse(up.responseText) as { id: string };
  return id;
}

export async function parseDemoFile(
  file: File,
  handlers: ParseHandlers = {},
): Promise<ParseResult> {
  if (file.size > MAX_DEMO_BYTES) {
    throw new Error(
      `That demo is ${mb(file.size)} — over the ${mb(MAX_DEMO_BYTES)} limit.`,
    );
  }
  // 1. Upload + queue (object storage or multipart fallback). 2+3 shared below.
  const id = await uploadAndQueue(file, handlers);
  return pollAndFetch(id, handlers);
}

// Parse a demo the server fetches from a remote URL (e.g. a FACEIT demo link or
// a Valve GOTV .dem/.bz2) — the user never needs the file on their machine.
export async function parseDemoFromUrl(
  url: string,
  handlers: ParseHandlers = {},
): Promise<ParseResult> {
  const { signal } = handlers;
  handlers.onPhase?.("queueing…");
  const res = await fetch("/api/demos/from-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
    signal,
  });
  if (!res.ok) throw new Error(await errText(res, "could not start parsing"));
  const { id } = (await res.json()) as { id: string };
  return pollAndFetch(id, handlers);
}

// Analyze a match listed on a profile by its Leetify game id — the server looks
// the match up, resolves its demo (FACEIT Download API or the Valve GC bot) and
// parses it. One click, no file handling for the user. `row` carries the
// clicked row's identity so legacy-Leetify accounts can fall back to the Game
// Coordinator (the bot matches the row against the player's recent matches).
export async function analyzeMatch(
  gameId: string,
  row: { steamId: string; finishedAt: string; score?: number[] },
  handlers: ParseHandlers = {},
): Promise<ParseResult> {
  const { signal } = handlers;
  handlers.onPhase?.("finding demo…");
  const res = await fetch("/api/demos/analyze-match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId,
      steamId: row.steamId,
      finishedAt: row.finishedAt,
      score: row.score,
    }),
    signal,
  });
  if (!res.ok) throw new Error(await errText(res, "could not start analysis"));
  const { id } = (await res.json()) as { id: string };
  return pollAndFetch(id, handlers);
}

// Poll a parse job to completion, then fetch + shape the result. Shared by the
// upload and from-URL paths.
async function pollAndFetch(
  id: string,
  handlers: ParseHandlers,
): Promise<ParseResult> {
  const { signal } = handlers;
  handlers.onReady?.();
  handlers.onPhase?.("parsing on our servers…");
  let status: DemoStatus;
  const maxAttempts = 180; // ~6 min at 2s — beyond which the worker is likely down
  for (let attempt = 0; ; attempt++) {
    await delay(2000, signal);
    const r = await fetch(`/api/demos/${id}`, { signal, cache: "no-store" });
    if (!r.ok) throw new Error(await errText(r, "status check failed"));
    status = (await r.json()) as DemoStatus;
    if (status.status === "done") break;
    if (status.status === "failed") {
      throw new Error(status.error || "the server could not parse that demo");
    }
    if (attempt >= maxAttempts) {
      throw new Error(
        "Parsing is taking longer than expected — the server may be busy. Try again shortly.",
      );
    }
  }
  handlers.onPhase?.("loading result…");
  const dr = await fetch(`/api/demos/${id}/data`, { signal });
  if (!dr.ok) throw new Error(await errText(dr, "could not load result"));
  const m = (await dr.json()) as ReplayMeta & { roundData?: ReplayRound[] };
  const meta: ReplayMeta = {
    map: m.map,
    tickRate: m.tickRate,
    frameHz: m.frameHz,
    players: m.players ?? [],
    rounds: m.rounds,
  };
  return { meta, rounds: m.roundData ?? [] };
}
