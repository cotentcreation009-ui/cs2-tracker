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
