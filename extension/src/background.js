// Background service worker — the only place that talks to the StatRun API.
// Content scripts message it with a steamid or FACEIT nickname; it fetches the
// public CheatMeter endpoint (host_permissions grant cross-origin, so no page
// CORS), caches results in memory to dedupe a 10-player room, and replies.

const DEFAULT_API = "https://csrun.win";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

async function apiBase() {
  const { apiBase } = await chrome.storage.sync.get("apiBase");
  return (apiBase || DEFAULT_API).replace(/\/+$/, "");
}

async function lookup({ steamid, faceit }) {
  const key = steamid ? `s:${steamid}` : `f:${(faceit || "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const base = await apiBase();
  const q = steamid
    ? `steamid=${encodeURIComponent(steamid)}`
    : `faceit=${encodeURIComponent(faceit)}`;
  const res = await fetch(`${base}/api/public/cheatmeter?${q}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const err = { error: `http ${res.status}` };
    cache.set(key, { at: Date.now(), data: err });
    return err;
  }
  const data = await res.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "lookup") {
    lookup(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e && e.message) }));
    return true; // async response
  }
  if (msg && msg.type === "enabled") {
    chrome.storage.sync
      .get("enabled")
      .then(({ enabled }) => sendResponse({ enabled: enabled !== false }));
    return true;
  }
});
