// Per-browser demo match library (IndexedDB). Summaries (light: meta + name +
// date) live in one store so the library list loads fast; the heavy per-round
// data lives in a separate store, loaded only when a match is opened.
import type { ReplayMeta, ReplayRound } from "./types";

const DB_NAME = "statrun-demos";
const VERSION = 1;
const SUMMARIES = "summaries";
const ROUNDS = "rounds";

export interface MatchSummary {
  id: string;
  name: string;
  savedAt: number;
  meta: ReplayMeta;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SUMMARIES))
        db.createObjectStore(SUMMARIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ROUNDS))
        db.createObjectStore(ROUNDS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMatch(
  meta: ReplayMeta,
  rounds: ReplayRound[],
  name: string,
): Promise<MatchSummary> {
  const id =
    (globalThis.crypto?.randomUUID?.() as string) ??
    `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const summary: MatchSummary = { id, name, savedAt: Date.now(), meta };

  const db = await openDB();
  const tx = db.transaction([SUMMARIES, ROUNDS], "readwrite");
  tx.objectStore(SUMMARIES).put(summary);
  tx.objectStore(ROUNDS).put({ id, rounds });
  await done(tx);
  db.close();
  return summary;
}

export async function listMatches(): Promise<MatchSummary[]> {
  const db = await openDB();
  const tx = db.transaction(SUMMARIES, "readonly");
  const all = await reqResult(
    tx.objectStore(SUMMARIES).getAll() as IDBRequest<MatchSummary[]>,
  );
  db.close();
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

// Go marshals empty slices as JSON null, so coerce every round's arrays to []
// (and nade thrower to a number) once on load — keeps the replay viewer and all
// analysis views null-safe no matter how sparse a round is. arr() also shields
// against non-array junk (a hand-edited import stored before validation
// existed): wrong-typed fields become empty instead of crashing every open.
function normalizeRound(r: ReplayRound | null | undefined): ReplayRound {
  const x = (r ?? {}) as ReplayRound;
  const arr = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
  return {
    ...x,
    ct: arr(x.ct),
    t: arr(x.t),
    frames: arr(x.frames),
    kills: arr(x.kills),
    nades: arr(x.nades).map((n) => ({ ...n, by: n.by ?? -1 })),
    bomb: arr(x.bomb),
    stats: arr(x.stats),
  };
}

export async function getMatch(
  id: string,
): Promise<{ summary: MatchSummary; rounds: ReplayRound[] } | null> {
  const db = await openDB();
  const tx = db.transaction([SUMMARIES, ROUNDS], "readonly");
  const summary = await reqResult(
    tx.objectStore(SUMMARIES).get(id) as IDBRequest<MatchSummary | undefined>,
  );
  const data = await reqResult(
    tx.objectStore(ROUNDS).get(id) as IDBRequest<{ rounds: ReplayRound[] } | undefined>,
  );
  db.close();
  if (!summary || !data) return null;
  return { summary, rounds: (data.rounds ?? []).map(normalizeRound) };
}

export async function renameMatch(id: string, name: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(SUMMARIES, "readwrite");
  const cur = await reqResult(
    tx.objectStore(SUMMARIES).get(id) as IDBRequest<MatchSummary | undefined>,
  );
  if (cur) tx.objectStore(SUMMARIES).put({ ...cur, name });
  await done(tx);
  db.close();
}

export async function deleteMatch(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([SUMMARIES, ROUNDS], "readwrite");
  tx.objectStore(SUMMARIES).delete(id);
  tx.objectStore(ROUNDS).delete(id);
  await done(tx);
  db.close();
  // Sweep this demo's derived localStorage caches (form digests, opponent
  // sightings) — orphaned keys otherwise accumulate forever and eventually
  // hit quota, silently killing all caching.
  if (typeof localStorage !== "undefined") {
    try {
      const prefixes = [`statrun:digest:${id}:`, `statrun:oppo:${id}:`];
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && prefixes.some((p) => k.startsWith(p))) doomed.push(k);
      }
      for (const k of doomed) localStorage.removeItem(k);
    } catch {
      /* quota / private mode */
    }
  }
}

// ---- export / import -------------------------------------------------------
// The library lives in one browser's IndexedDB — a cleared site-data toggle or
// a new machine loses everything. Export writes portable JSON (one demo or the
// whole library); import accepts either shape and always mints fresh ids, so
// re-importing can't clobber an existing match.

export interface ExportedMatch {
  kind: "statrun-demo";
  version: 1;
  name: string;
  savedAt: number;
  meta: ReplayMeta;
  rounds: ReplayRound[];
}

export interface ExportedLibrary {
  kind: "statrun-library";
  version: 1;
  exportedAt: number;
  demos: ExportedMatch[];
}

export async function exportMatch(id: string): Promise<ExportedMatch | null> {
  const m = await getMatch(id);
  if (!m) return null;
  return {
    kind: "statrun-demo",
    version: 1,
    name: m.summary.name,
    savedAt: m.summary.savedAt,
    meta: m.summary.meta,
    rounds: m.rounds,
  };
}

export async function exportLibrary(): Promise<ExportedLibrary> {
  const all = await listMatches();
  const demos: ExportedMatch[] = [];
  for (const s of all) {
    const em = await exportMatch(s.id);
    if (em) demos.push(em);
  }
  return { kind: "statrun-library", version: 1, exportedAt: Date.now(), demos };
}

/**
 * Validate a parsed import file into a list of matches. Accepts a single-demo
 * export, a whole-library export, or (leniently) a raw parser payload with
 * {map, players, rounds, roundData}. Throws with a human message otherwise.
 * Pure — no IndexedDB — so it is unit-testable and runs before any write.
 */
export function parseImportPayload(json: unknown): { name: string; savedAt: number; meta: ReplayMeta; rounds: ReplayRound[] }[] {
  // Everything here is persisted verbatim into IndexedDB and rendered by every
  // tab afterwards — one junk record that passes would crash the library or a
  // match page on EVERY visit, so shapes are validated per entry, not per file.
  const isPlayers = (p: unknown): p is ReplayMeta["players"] =>
    Array.isArray(p) &&
    p.every((e) => !!e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string");
  const isMeta = (m: unknown): m is ReplayMeta => {
    const x = m as ReplayMeta | null;
    return !!x && typeof x.map === "string" && isPlayers(x.players) && typeof x.rounds === "number";
  };
  const isRounds = (r: unknown): r is ReplayRound[] =>
    Array.isArray(r) && r.every((e) => !!e && typeof e === "object" && !Array.isArray(e));
  const one = (d: unknown, fallbackName: string) => {
    const x = d as Partial<ExportedMatch> | null;
    if (!x || !isMeta(x.meta) || !isRounds(x.rounds)) {
      throw new Error("Not a StatRun demo export — missing or malformed meta/rounds.");
    }
    return {
      name: typeof x.name === "string" && x.name.trim() ? x.name : fallbackName,
      savedAt: typeof x.savedAt === "number" ? x.savedAt : Date.now(),
      meta: x.meta,
      rounds: x.rounds,
    };
  };
  const j = json as { kind?: string; demos?: unknown[]; map?: string; roundData?: unknown } | null;
  if (!j || typeof j !== "object") throw new Error("Not a JSON object.");
  if (j.kind === "statrun-library") {
    if (!Array.isArray(j.demos) || !j.demos.length) throw new Error("Library export contains no demos.");
    return j.demos.map((d, i) => one(d, `Imported demo ${i + 1}`));
  }
  if (j.kind === "statrun-demo") return [one(j, "Imported demo")];
  // raw parser payload (…dem.replay.json): {map, tickRate, frameHz, players, rounds, roundData}
  if (typeof j.map === "string" && Array.isArray(j.roundData)) {
    const r = j as unknown as ReplayMeta & { roundData: unknown };
    if (!isPlayers(r.players) || !isRounds(r.roundData)) {
      throw new Error("Parser payload is incomplete — missing players or malformed round data.");
    }
    return [
      {
        name: `Imported · ${r.map.replace(/^de_/, "")}`,
        savedAt: Date.now(),
        meta: {
          map: r.map,
          tickRate: typeof r.tickRate === "number" ? r.tickRate : 64,
          frameHz: typeof r.frameHz === "number" ? r.frameHz : 1,
          players: r.players,
          rounds: typeof r.rounds === "number" ? r.rounds : r.roundData.length,
        },
        rounds: r.roundData,
      },
    ];
  }
  throw new Error("Unrecognized file — expected a StatRun demo or library export.");
}

/** Write validated matches into the library under fresh ids. Returns them. */
export async function importMatches(
  demos: { name: string; savedAt: number; meta: ReplayMeta; rounds: ReplayRound[] }[],
): Promise<MatchSummary[]> {
  const out: MatchSummary[] = [];
  for (const d of demos) {
    const s = await saveMatch(d.meta, d.rounds, d.name);
    // keep the original date so the library keeps its history order
    if (d.savedAt !== s.savedAt) {
      const db = await openDB();
      const tx = db.transaction(SUMMARIES, "readwrite");
      tx.objectStore(SUMMARIES).put({ ...s, savedAt: d.savedAt });
      await done(tx);
      db.close();
      s.savedAt = d.savedAt;
    }
    out.push(s);
  }
  return out;
}

// ---- storage durability ----------------------------------------------------
// Browsers may evict "best-effort" storage under pressure; persisted storage
// survives. Surfacing usage + a protect action turns silent eviction risk into
// a user decision.

export interface StorageInfo {
  usage: number; // bytes
  quota: number; // bytes
  persisted: boolean;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

/** Ask the browser to protect the library from eviction. True = granted. */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
