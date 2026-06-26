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
  return { summary, rounds: data.rounds };
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
}
