// Background service worker — the only place that talks to the CSRun API.
// Content scripts message it with a steamid or FACEIT nickname; it fetches the
// public CheatMeter endpoint (host_permissions grant cross-origin, so no page
// CORS), caches results in memory to dedupe a 10-player room, and replies.

const DEFAULT_API = "https://csrun.win";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

const NOTIFY_MIN_GAP_MS = 10 * 1000;
let lastNotifyAt = 0;

function notify({ title, message }) {
  const now = Date.now();
  if (now - lastNotifyAt < NOTIFY_MIN_GAP_MS) return; // rate limit: 1 per 10s
  lastNotifyAt = now;
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: String(title || "CSRun"),
    message: String(message || ""),
  });
}

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
    // Errors are not cached either — a 500 or a rate-limited moment should not
    // stick to a player for five minutes.
    return { error: `http ${res.status}` };
  }
  const data = await res.json();
  // A partial answer means an upstream lookup failed, not that the player has
  // no data. Caching it would hold four blank columns for this player for the
  // full TTL even though the very next request would succeed.
  if (!data || !data.partial) cache.set(key, { at: Date.now(), data });
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "lookup") {
    lookup(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e && e.message) }));
    return true; // async response
  }
  if (msg && msg.type === "notify") {
    notify(msg);
    return; // fire-and-forget, no response
  }
  if (msg && msg.type === "enabled") {
    chrome.storage.sync
      .get("enabled")
      .then(({ enabled }) => sendResponse({ enabled: enabled !== false }));
    return true;
  }
});

// ---- recover open tabs after an install/update --------------------------
// Reloading or auto-updating the extension kills its content scripts in
// every open tab, and FACEIT is an SPA — users browse for hours without a
// full page load, so the extension simply stays dead in that tab until a
// manual refresh. Re-inject into matching tabs instead: remove whatever DOM
// the previous version left behind (its scripts are already gone), then run
// the manifest's own file lists.
async function reinjectContentScripts() {
  const groups = chrome.runtime.getManifest().content_scripts || [];
  for (const group of groups) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: group.matches });
    } catch {
      continue;
    }
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const SEL = [
              "[data-sr-inline]",
              "#statrun-room",
              "#statrun-profile",
              "#statrun-steam-panel",
              "#statrun-profile-style",
              ".sr-chip",
            ];
            for (const sel of SEL) {
              for (const n of document.querySelectorAll(sel)) n.remove();
            }
          },
        });
        if (group.css && group.css.length) {
          await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: group.css });
        }
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: group.js });
      } catch {
        // tab navigated away, is discarded, or is not injectable — skip it
      }
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    void reinjectContentScripts();
  }
});
