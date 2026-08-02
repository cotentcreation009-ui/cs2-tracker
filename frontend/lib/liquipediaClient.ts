// Browser-side Liquipedia photo resolution — the fallback when our backend
// can't fetch (Liquipedia rate-limits datacenter IPs, so the GCE VM gets 429s
// while residential visitor IPs are fine).
//
// Requests are BATCHED: avatars that mount together are collected for 250ms,
// then resolved for the whole group in two API calls (MediaWiki accepts up to
// 50 titles per query) — a full lineup resolves in ~3s instead of a serial
// per-player queue.
//
// Terms compliance (liquipedia.net/api-terms-of-use), per visiting client:
//  - calls are spaced >2s apart (their 1-req/2s limit); batching means a page
//    needs only 2-3 calls total
//  - results cache in localStorage for 14 days (misses 3 days)
//  - the browser sends gzip Accept-Encoding automatically
// The CC BY-SA attribution is rendered next to every table that shows photos.

const API = "https://liquipedia.net/counterstrike/api.php";
const CACHE_PREFIX = "lp:img2:";
const HIT_TTL_MS = 14 * 864e5;
const MISS_TTL_MS = 3 * 864e5;
const GAP_MS = 2100;
const BATCH_WAIT_MS = 250;
const MAX_TITLES = 50;

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

const STEAM_PREFIX = "lp:steam:";
const STEAM_HIT_TTL_MS = 30 * 864e5;
const STEAM_MISS_TTL_MS = 7 * 864e5;

// Resolve a pro player's SteamID64 from their Liquipedia page's external
// links (player infoboxes link steamcommunity.com/profiles/<id64>). Cached in
// localStorage; paced on the same shared queue as photo lookups.
export function resolvePlayerSteamId(nick: string): Promise<string | null> {
  try {
    const raw = localStorage.getItem(STEAM_PREFIX + nick.toLowerCase());
    if (raw) {
      const v = JSON.parse(raw) as { u: string | null; t: number };
      const ttl = v.u ? STEAM_HIT_TTL_MS : STEAM_MISS_TTL_MS;
      if (typeof v.t === "number" && Date.now() - v.t <= ttl) return Promise.resolve(v.u);
    }
  } catch {
    // fall through to a live lookup
  }
  return (async () => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      redirects: "1",
      titles: nick,
      prop: "extlinks",
      ellimit: "500",
    });
    try {
      const res = await pacedFetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = (await res.json()) as {
        query?: { pages?: Record<string, { extlinks?: { "*"?: string }[] }> };
      };
      let id: string | null = null;
      for (const p of Object.values(d.query?.pages ?? {})) {
        for (const l of p.extlinks ?? []) {
          const m = /steamcommunity\.com\/profiles\/(7656\d{13})/.exec(l["*"] ?? "");
          if (m) {
            id = m[1];
            break;
          }
        }
        if (id) break;
      }
      try {
        localStorage.setItem(STEAM_PREFIX + nick.toLowerCase(), JSON.stringify({ u: id, t: Date.now() }));
      } catch {
        // uncached is fine
      }
      return id;
    } catch {
      return null; // transient — retry on a later view
    }
  })();
}

// ---- Player identity cards (infobox wikitext) ------------------------------
// Browser-side fallback for /api/pro-matches/player-card — same reason as
// photos: Liquipedia 429s the VM's datacenter IP, visitor IPs are fine.
// Batched: one revisions query fetches wikitext for up to 50 pages, parsed
// into {name, country, role, …} locally. CC BY-SA 3.0, attributed in the UI.

export interface LpPlayerCard {
  found: boolean;
  name?: string;
  country?: string;
  countryCode?: string;
  role?: string;
  birthDate?: string;
  team?: string;
}

const CARD_PREFIX = "lp:card1:";

export function resolvePlayerCard(nick: string): Promise<LpPlayerCard | null> {
  const key = nick.toLowerCase();
  try {
    const raw = localStorage.getItem(CARD_PREFIX + key);
    if (raw) {
      const v = JSON.parse(raw) as { c: LpPlayerCard | null; t: number };
      const ttl = v.c?.found ? HIT_TTL_MS : MISS_TTL_MS;
      if (typeof v.t === "number" && Date.now() - v.t <= ttl) return Promise.resolve(v.c);
    }
  } catch {
    // fall through to a live lookup
  }
  const existing = cardInflight.get(key);
  if (existing) return existing;
  const p = new Promise<LpPlayerCard | null>((resolve) => {
    cardPending.push({ nick, resolve });
    if (cardTimer == null) cardTimer = setTimeout(flushCardBatch, BATCH_WAIT_MS);
  });
  cardInflight.set(key, p);
  void p.finally(() => cardInflight.delete(key));
  return p;
}

type CardPending = { nick: string; resolve: (c: LpPlayerCard | null) => void };
let cardPending: CardPending[] = [];
let cardTimer: ReturnType<typeof setTimeout> | null = null;
const cardInflight = new Map<string, Promise<LpPlayerCard | null>>();

function writeCardCache(nick: string, c: LpPlayerCard | null): void {
  try {
    localStorage.setItem(CARD_PREFIX + nick.toLowerCase(), JSON.stringify({ c, t: Date.now() }));
  } catch {
    // uncached is fine
  }
}

function flushCardBatch(): void {
  cardTimer = null;
  const batch = cardPending.splice(0, MAX_TITLES);
  if (batch.length === 0) return;
  batchChain = batchChain.then(() => execCardBatch(batch)).catch(() => {});
  if (cardPending.length > 0) cardTimer = setTimeout(flushCardBatch, 0);
}

async function execCardBatch(batch: CardPending[]): Promise<void> {
  const byNick = new Map<string, CardPending[]>();
  for (const b of batch) {
    const k = b.nick.toLowerCase();
    const arr = byNick.get(k) ?? [];
    arr.push(b);
    byNick.set(k, arr);
  }
  const nicks = [...byNick.values()].map((arr) => arr[0].nick);
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      redirects: "1",
      titles: nicks.join("|"),
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
    });
    const res = await pacedFetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const d = (await res.json()) as {
      query?: {
        redirects?: { from?: string; to?: string }[];
        pages?: { title?: string; missing?: boolean; revisions?: { slots?: { main?: { content?: string } } }[] }[];
      };
    };
    // map each requested nick to its (possibly redirected) page title
    const redirect = new Map<string, string>();
    for (const r of d.query?.redirects ?? []) {
      if (r.from && r.to) redirect.set(r.from.toLowerCase(), r.to.toLowerCase());
    }
    const byTitle = new Map<string, string>();
    for (const p of d.query?.pages ?? []) {
      if (!p.title || p.missing) continue;
      const text = p.revisions?.[0]?.slots?.main?.content ?? "";
      if (text) byTitle.set(p.title.toLowerCase(), text);
    }
    for (const [k, arr] of byNick) {
      const title = redirect.get(k) ?? k;
      const text = byTitle.get(title) ?? byTitle.get(k) ?? "";
      const card = text ? parseInfobox(text) : { found: false };
      writeCardCache(arr[0].nick, card);
      for (const b of arr) b.resolve(card);
    }
  } catch {
    // network/429 — resolve null without caching so a later view retries
    for (const arr of byNick.values()) for (const b of arr) b.resolve(null);
  }
}

// JS port of the backend's tolerant "Infobox player" parser.
function parseInfobox(wikitext: string): LpPlayerCard {
  const start = wikitext.search(/\{\{Infobox\s+player/i);
  if (start < 0) return { found: false };
  const window = wikitext.slice(start, start + 8000);
  const fields = new Map<string, string>();
  for (const lineRaw of window.split("\n")) {
    const line = lineRaw.trim();
    if (!line.startsWith("|")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(1, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key && val && !fields.has(key)) fields.set(key, val);
  }
  const clean = (s?: string): string =>
    (s ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^/>]*\/>|<[^>]+>/g, "")
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1")
      .replace(/\{\{[^{}]*\}\}/g, "")
      .replace(/'''|''|[{}]/g, "")
      .replace(/^\|+|\|+$/g, "")
      .trim()
      .slice(0, 80);
  const country = clean(fields.get("country") ?? fields.get("nationality"));
  const birthRaw = fields.get("birth_date") ?? fields.get("birthdate") ?? fields.get("birth") ?? "";
  const bm = /(\d{4})[|-](\d{1,2})[|-](\d{1,2})/.exec(birthRaw);
  return {
    found: true,
    name: clean(fields.get("romanized_name")) || clean(fields.get("name")),
    country,
    countryCode: LP_ISO[country.toLowerCase()] ?? "",
    role: foldRole(clean(fields.get("role") ?? fields.get("roles"))),
    birthDate: bm ? `${bm[1]}-${bm[2].padStart(2, "0")}-${bm[3].padStart(2, "0")}` : undefined,
    team: clean(fields.get("team")) || undefined,
  };
}

function foldRole(r: string): string {
  switch (r.toLowerCase()) {
    case "": return "";
    case "awp": case "awper": case "sniper": return "AWPer";
    case "igl": case "in-game leader": case "in game leader": case "captain": return "IGL";
    case "rifler": return "Rifler";
    case "coach": case "head coach": return "Coach";
    case "entry fragger": case "entry": return "Entry";
    case "support": return "Support";
    case "lurker": return "Lurker";
    default: return r.slice(0, 24);
  }
}

const LP_ISO: Record<string, string> = {
  argentina: "AR", australia: "AU", austria: "AT", belarus: "BY", belgium: "BE",
  "bosnia and herzegovina": "BA", brazil: "BR", bulgaria: "BG", canada: "CA",
  chile: "CL", china: "CN", croatia: "HR", "czech republic": "CZ", czechia: "CZ",
  denmark: "DK", estonia: "EE", finland: "FI", france: "FR", germany: "DE",
  greece: "GR", hungary: "HU", iceland: "IS", india: "IN", indonesia: "ID",
  israel: "IL", italy: "IT", japan: "JP", jordan: "JO", kazakhstan: "KZ",
  kosovo: "XK", latvia: "LV", lithuania: "LT", malaysia: "MY", mexico: "MX",
  mongolia: "MN", montenegro: "ME", morocco: "MA", netherlands: "NL",
  "new zealand": "NZ", "north macedonia": "MK", norway: "NO", peru: "PE",
  poland: "PL", portugal: "PT", romania: "RO", russia: "RU", serbia: "RS",
  singapore: "SG", slovakia: "SK", slovenia: "SI", "south africa": "ZA",
  "south korea": "KR", spain: "ES", sweden: "SE", switzerland: "CH",
  taiwan: "TW", thailand: "TH", turkey: "TR", ukraine: "UA",
  "united kingdom": "GB", "united states": "US", uruguay: "UY",
  uzbekistan: "UZ", vietnam: "VN",
};

export function invalidatePlayerPhoto(nick: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + nick.toLowerCase());
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Global pacing shared by every call this tab makes.
let lastCall = 0;
async function pacedFetch(url: string): Promise<Response> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  return fetch(url);
}

type Pending = { nick: string; resolve: (u: string | null) => void };
let pending: Pending[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchChain: Promise<void> = Promise.resolve();
const inflight = new Map<string, Promise<string | null>>();

export function resolvePlayerPhoto(nick: string): Promise<string | null> {
  const key = nick.toLowerCase();
  const cached = readCache(nick);
  if (cached) return Promise.resolve(cached.u);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = new Promise<string | null>((resolve) => {
    pending.push({ nick, resolve });
    if (batchTimer == null) batchTimer = setTimeout(flushBatch, BATCH_WAIT_MS);
  });
  inflight.set(key, p);
  void p.finally(() => inflight.delete(key));
  return p;
}

function flushBatch(): void {
  batchTimer = null;
  const batch = pending.splice(0, MAX_TITLES);
  if (batch.length === 0) return;
  batchChain = batchChain.then(() => execBatch(batch)).catch(() => {});
  if (pending.length > 0) batchTimer = setTimeout(flushBatch, 0);
}

async function execBatch(batch: Pending[]): Promise<void> {
  // dedupe nicks; an earlier batch may have resolved some already
  const byNick = new Map<string, Pending[]>();
  for (const b of batch) {
    const c = readCache(b.nick);
    if (c) {
      b.resolve(c.u);
      continue;
    }
    const k = b.nick.toLowerCase();
    const arr = byNick.get(k) ?? [];
    arr.push(b);
    byNick.set(k, arr);
  }
  if (byNick.size === 0) return;
  const nicks = [...byNick.values()].map((arr) => arr[0].nick);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { files, redirects } = await listPageFiles(nicks); // call 1 (+continuation)
      const bestByNick = pickBest(nicks, files, redirects);
      const wanted = [...new Set([...bestByNick.values()].filter((t): t is string => t !== null))];
      const urls = wanted.length > 0 ? await fileThumbUrls(wanted) : new Map<string, string>(); // call 2
      for (const [k, arr] of byNick) {
        const title = bestByNick.get(k) ?? null;
        const u = (title ? urls.get(title) : null) ?? null;
        writeCache(arr[0].nick, u);
        for (const b of arr) b.resolve(u);
      }
      return;
    } catch {
      // network/CORS/429 — retry the whole batch once before giving up
      if (attempt === 0) await sleep(1500);
    }
  }
  // both attempts failed — don't cache, fall back to placeholders
  for (const arr of byNick.values()) for (const b of arr) b.resolve(null);
}

// One query for ALL the players' pages → every file title used on them,
// plus the redirect map (a nick like "MartinezSa" can redirect to a page
// titled "Martinez" whose photo files are named after the TARGET title).
async function listPageFiles(
  nicks: string[],
): Promise<{ files: string[]; redirects: Map<string, string> }> {
  const files: string[] = [];
  const redirects = new Map<string, string>();
  let cont: string | null = null;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*", // anonymous CORS mode
      redirects: "1",
      titles: nicks.join("|"),
      prop: "images",
      imlimit: "500",
    });
    if (cont) params.set("imcontinue", cont);
    const res = await pacedFetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const d = (await res.json()) as {
      query?: {
        redirects?: { from?: string; to?: string }[];
        pages?: Record<string, { images?: { title?: string }[] }>;
      };
      continue?: { imcontinue?: string };
    };
    for (const r of d.query?.redirects ?? []) {
      if (r.from && r.to) redirects.set(r.from.toLowerCase(), r.to);
    }
    for (const p of Object.values(d.query?.pages ?? {})) {
      for (const im of p.images ?? []) if (im.title) files.push(im.title);
    }
    cont = d.continue?.imcontinue ?? null;
    if (!cont) break;
  }
  return { files, redirects };
}

// Same heuristic as the backend: files named "<Nick> at <Event>.jpg" (or "@"),
// newest year wins (that's the wiki infobox shot). Tries the nick and its
// redirect-target page title (a nick like "MartinezSa" can redirect to a page
// titled "Martinez" whose photo files are named after the TARGET title).
// Keyed by lowercase nick.
function pickBest(
  nicks: string[],
  files: string[],
  redirects: Map<string, string>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const nick of nicks) {
    const aliases = [nick];
    const target = redirects.get(nick.toLowerCase());
    if (target && target.toLowerCase() !== nick.toLowerCase()) aliases.push(target);
    let bestKey = "";
    let best: string | null = null;
    for (const alias of aliases) {
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^File:${esc}\\s*(?:at|@)\\s+.+\\.(?:jpe?g|png)$`, "i");
      for (const f of files) {
        if (!re.test(f)) continue;
        const years = f.match(/20\d\d/g);
        const key = `${years ? years[years.length - 1] : "0"}|${f}`;
        if (key > bestKey) {
          bestKey = key;
          best = f;
        }
      }
    }
    out.set(nick.toLowerCase(), best);
  }
  return out;
}

// One query for the chosen files → 256px thumbnail URLs, keyed by file title.
async function fileThumbUrls(titles: string[]): Promise<Map<string, string>> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    titles: titles.slice(0, MAX_TITLES).join("|"),
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "256",
  });
  const res = await pacedFetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const d = (await res.json()) as {
    query?: {
      normalized?: { from?: string; to?: string }[];
      pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string; url?: string }[] }>;
    };
  };
  // map normalized titles back to what we asked for
  const denorm = new Map<string, string>();
  for (const n of d.query?.normalized ?? []) {
    if (n.from && n.to) denorm.set(n.to, n.from);
  }
  const out = new Map<string, string>();
  for (const p of Object.values(d.query?.pages ?? {})) {
    const title = p.title ?? "";
    const u = p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url;
    if (!title || !u) continue;
    out.set(denorm.get(title) ?? title, u);
  }
  return out;
}
