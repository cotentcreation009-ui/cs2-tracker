// Browser-side Liquipedia photo resolution — the fallback when our backend
// can't fetch (Liquipedia rate-limits datacenter IPs, so the GCE VM gets 429s
// while residential visitor IPs are fine).
//
// Terms compliance (liquipedia.net/api-terms-of-use), per visiting client:
//  - requests are queued with a >2s gap (their 1-req/2s limit)
//  - results cache in localStorage for 14 days (misses 3 days)
//  - the browser sends gzip Accept-Encoding automatically
// The CC BY-SA attribution is rendered next to every table that shows photos.

const API = "https://liquipedia.net/counterstrike/api.php";
const CACHE_PREFIX = "lp:img:";
const HIT_TTL_MS = 14 * 864e5;
const MISS_TTL_MS = 3 * 864e5;
const GAP_MS = 2100;

type CacheEntry = { u: string | null; t: number };

function readCache(nick: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + nick.toLowerCase());
    if (!raw) return null;
    const v = JSON.parse(raw) as CacheEntry;
    const ttl = v.u ? HIT_TTL_MS : MISS_TTL_MS;
    if (typeof v.t !== "number" || Date.now() - v.t > ttl) return null;
    return v;
  } catch {
    return null;
  }
}

function writeCache(nick: string, u: string | null): void {
  try {
    localStorage.setItem(CACHE_PREFIX + nick.toLowerCase(), JSON.stringify({ u, t: Date.now() }));
  } catch {
    // storage full/blocked — resolution still worked, just uncached
  }
}

// One shared queue so simultaneous avatar mounts space their API calls out.
let chain: Promise<void> = Promise.resolve();
let lastCall = 0;
const inflight = new Map<string, Promise<string | null>>();

export function resolvePlayerPhoto(nick: string): Promise<string | null> {
  const key = nick.toLowerCase();
  const cached = readCache(nick);
  if (cached) return Promise.resolve(cached.u);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = new Promise<string | null>((resolve) => {
    chain = chain.then(async () => {
      // re-check: an earlier queued call may have resolved this nick
      const c = readCache(nick);
      if (c) {
        resolve(c.u);
        return;
      }
      const wait = lastCall + GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      try {
        const u = await lookup(nick);
        writeCache(nick, u);
        resolve(u);
      } catch {
        // network/CORS/429 — don't cache, just fall back to initials
        resolve(null);
      }
    });
  });
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  return p;
}

// Same heuristic as the backend: the player's page → files named
// "<Nick> at <Event>.jpg" (or "@") → newest year wins (the infobox shot).
async function lookup(nick: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*", // anonymous CORS mode
    redirects: "1",
    titles: nick,
    generator: "images",
    gimlimit: "50",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "256",
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const d = (await res.json()) as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string; url?: string }[] }> };
  };
  const esc = nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^File:${esc}\\s*(?:at|@)\\s+.+\\.(?:jpe?g|png)$`, "i");
  let bestKey = "";
  let bestUrl: string | null = null;
  for (const p of Object.values(d.query?.pages ?? {})) {
    const title = p.title ?? "";
    if (!re.test(title)) continue;
    const ii = p.imageinfo?.[0];
    const u = ii?.thumburl || ii?.url;
    if (!u) continue;
    const years = title.match(/20\d\d/g);
    const key = `${years ? years[years.length - 1] : "0"}|${title}`;
    if (key > bestKey) {
      bestKey = key;
      bestUrl = u;
    }
  }
  return bestUrl;
}
