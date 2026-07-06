// Tiny in-memory per-IP rate limiter for the PUBLIC (extension-facing) API. The
// frontend runs as a single instance behind Caddy, so an in-process token
// window is enough to blunt abuse of the unauthenticated endpoint; the backend's
// profile cache absorbs the rest. Not a security boundary on its own — a
// convenience throttle.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120; // a 10-player FACEIT room is one burst; ~12 rooms/min/IP
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimitOK(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.reset) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    return true;
  }
  if (e.count >= MAX_PER_WINDOW) return false;
  e.count++;
  return true;
}
