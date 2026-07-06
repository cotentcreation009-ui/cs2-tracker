const enabled = document.getElementById("enabled");
const apiBase = document.getElementById("apiBase");
const saved = document.getElementById("saved");

chrome.storage.sync.get(["enabled", "apiBase"]).then((s) => {
  enabled.checked = s.enabled !== false;
  apiBase.value = s.apiBase || "https://steamcommunity.run";
});

document.getElementById("save").addEventListener("click", () => {
  const base = (apiBase.value || "https://steamcommunity.run").trim().replace(/\/+$/, "");
  chrome.storage.sync.set({ enabled: enabled.checked, apiBase: base }).then(() => {
    apiBase.value = base;
    saved.classList.add("show");
    setTimeout(() => saved.classList.remove("show"), 1500);
  });
});
