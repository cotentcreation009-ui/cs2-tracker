const box = document.getElementById("enabled");

chrome.storage.sync.get(["enabled", "apiBase"]).then(({ enabled, apiBase }) => {
  box.checked = enabled !== false;
  const base = (apiBase || "https://csrun.win").replace(/\/+$/, "");
  document.getElementById("site").href = base;
});

box.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: box.checked });
});
