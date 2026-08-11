// Dev-only stub of the chrome.* surface the popup/options pages touch, so the
// REAL pages render under file:// for screenshots. Never shipped: manifest
// only loads files from src/.
(function () {
  if (window.chrome && chrome.storage && chrome.storage.sync) return;
  const store = {
    enabled: true,
    "feature.chips": true,
    "feature.matchroom": true,
    "feature.profile": true,
    "feature.steam": true,
    "auto.accept": false,
    "auto.closeModals": true,
    "notify.matchReady": true,
    apiBase: "https://csrun.win",
  };
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: "2.0.0" }),
      sendMessage: (msg, cb) => {
        const reply =
          msg && msg.type === "lookup"
            ? {
                steamId64: "76561198077030352",
                name: "kolyapetrovv",
                profileUrl: "https://csrun.win/profiles/76561198077030352",
                cheat: { score: 12, band: "low", confidence: 82 },
                premier: 18432,
                faceitLevel: 10,
                faceitElo: 2247,
                kd: 1.18,
                gap: 0.14,
                banned: false,
                country: "de",
                // Exercises the rank-by-year block, including the shape that
                // used to render broken: a career whose peaks sit within one
                // level of each other alongside a genuine climb.
                rankHistory: [
                  { year: 2026, matches: 96, winRatePct: 54, peakElo: 2247, endElo: 2247, peakLevel: 10 },
                  { year: 2025, matches: 301, winRatePct: 51, peakElo: 2140, endElo: 2050, peakLevel: 10 },
                  { year: 2024, matches: 187, winRatePct: 50, peakElo: 1795, endElo: 1720, peakLevel: 9 },
                  { year: 2023, matches: 44, winRatePct: 45, peakElo: 1350, endElo: 1290, peakLevel: 7 },
                ],
              }
            : {};
        if (cb) setTimeout(() => cb(reply), 350);
        return true;
      },
      openOptionsPage: () => {},
    },
    storage: {
      sync: {
        get: (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(store)).forEach(
            (k) => (out[k] = store[k]),
          );
          return Promise.resolve(out);
        },
        set: (obj) => {
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => {} },
    },
  };
})();
