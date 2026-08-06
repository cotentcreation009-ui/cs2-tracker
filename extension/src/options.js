// Options page — the writer of record for chrome.storage.sync settings.
// Every toggle saves immediately; a small "Saved" toast confirms each write.

(function () {
  const DEFAULT_API = "https://csrun.win";

  // Defaults per ARCHITECTURE.md: display features on, automation and
  // notifications off.
  const DEFAULTS = {
    "feature.chips": true,
    "feature.matchroom": true,
    "feature.profile": true,
    "feature.steam": true,
    "auto.accept": false,
    "auto.closeModals": false,
    "notify.matchReady": false,
    apiBase: DEFAULT_API,
  };

  const boxes = Array.from(document.querySelectorAll(".sr-switch input[data-key]"));
  const apiBase = document.getElementById("apiBase");
  const toast = document.getElementById("toast");
  let toastTimer = null;

  function savedToast() {
    toast.classList.add("sr-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("sr-show"), 1200);
  }

  document.getElementById("version").textContent =
    "v" + chrome.runtime.getManifest().version;

  // ---- load ------------------------------------------------------------

  chrome.storage.sync.get(Object.keys(DEFAULTS)).then((s) => {
    for (const box of boxes) {
      const key = box.dataset.key;
      box.checked = typeof s[key] === "boolean" ? s[key] : DEFAULTS[key];
    }
    apiBase.value = s.apiBase || DEFAULT_API;
  });

  // ---- save ------------------------------------------------------------

  boxes.forEach((box) => {
    box.addEventListener("change", () => {
      chrome.storage.sync.set({ [box.dataset.key]: box.checked }).then(savedToast);
    });
  });

  // Normalize the API base to an http(s) origin+path without a trailing
  // slash; anything unparseable falls back to the default.
  function cleanBase(raw) {
    const v = (raw || "").trim().replace(/\/+$/, "");
    if (!v) return DEFAULT_API;
    try {
      const u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_API;
      const path = u.pathname.replace(/\/+$/, "");
      return u.origin + (path === "" ? "" : path);
    } catch {
      return DEFAULT_API;
    }
  }

  apiBase.addEventListener("change", () => {
    const base = cleanBase(apiBase.value);
    apiBase.value = base;
    chrome.storage.sync.set({ apiBase: base }).then(savedToast);
  });

  apiBase.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      apiBase.blur(); // fires the change handler if the value moved
    }
  });
})();
