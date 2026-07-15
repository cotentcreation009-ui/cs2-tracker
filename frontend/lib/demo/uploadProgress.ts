// Maps the multi-phase upload → queue → parse → load lifecycle to a single
// monotonic 0..100 percentage for the demo upload progress bar.
//
// Only the UPLOAD phase has a true measurement (XHR upload byte events). The
// server-side parse is status-only (queued/running/done — no percentage), so it
// advances on an eased time curve that approaches, but never reaches, a ceiling
// until the server actually reports "done". This keeps the bar always-moving
// and honest: it never claims parse progress it can't see, and never regresses.

export type UploadPhase =
  | "idle"
  | "uploading"
  | "queueing"
  | "parsing"
  | "loading"
  | "saving"
  | "done";

// Map the human onPhase() strings the parse client emits to a lifecycle phase.
export function phaseOf(label: string): UploadPhase {
  const l = label.toLowerCase();
  if (l.startsWith("upload")) return "uploading";
  if (l.startsWith("queue")) return "queueing";
  if (l.startsWith("pars")) return "parsing";
  if (l.startsWith("load")) return "loading";
  if (l.startsWith("sav")) return "saving";
  return "idle";
}

// Segment ceilings for the file-upload path (upload is real, so it earns the
// biggest slice). Parse eases from PARSE_FROM toward PARSE_CEIL.
const UPLOAD_CEIL = 70;
const QUEUE_AT = 74;
const PARSE_FROM = 76;
const PARSE_CEIL = 97;
const LOAD_AT = 98;
const SAVE_AT = 99;
// Parse easing time constant — larger = slower creep. Tuned so a typical
// ~20-40s MM-demo parse sits around the mid-80s%.
const PARSE_TAU_MS = 22000;

export interface ProgressInput {
  phase: UploadPhase;
  uploadFraction: number; // 0..1 real bytes sent (uploading phase only)
  parseElapsedMs: number; // ms since the parsing phase began
  hasUpload: boolean; // false for URL / FACEIT paths (server fetches the demo)
}

// The instantaneous target percent for a phase. Callers should clamp this to be
// monotonic (never let the displayed value go backwards).
export function computePercent(i: ProgressInput): number {
  switch (i.phase) {
    case "uploading":
      // at least 1% so the bar is visibly alive before the first progress event
      return clamp(i.uploadFraction * UPLOAD_CEIL, 1, UPLOAD_CEIL);
    case "queueing":
      return i.hasUpload ? QUEUE_AT : 5;
    case "parsing": {
      const base = i.hasUpload ? PARSE_FROM : 6;
      const eased = (PARSE_CEIL - base) * (1 - Math.exp(-Math.max(0, i.parseElapsedMs) / PARSE_TAU_MS));
      return base + eased;
    }
    case "loading":
      return LOAD_AT;
    case "saving":
      return SAVE_AT;
    case "done":
      return 100;
    default:
      return 0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
