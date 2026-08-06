// Shared helpers for the content scripts: CheatMeter band colours + DOM builders
// for the inline FACEIT badge and the fuller Steam panel. Runs in the content
// script world; talks to the API via the background worker.

const SR = {
  BANDS: {
    verylow: { hex: "#46d369", label: "Very low" },
    low: { hex: "#8fd14f", label: "Low" },
    moderate: { hex: "#f5b942", label: "Moderate" },
    high: { hex: "#ff8a3d", label: "High" },
    veryhigh: { hex: "#f5694a", label: "Very high" },
  },

  // Ask the background worker for a player's CheatMeter read.
  lookup(params) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "lookup", ...params }, (r) =>
          resolve(chrome.runtime.lastError ? { error: "unavailable" } : r),
        );
      } catch {
        resolve({ error: "unavailable" });
      }
    });
  },

  enabled() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "enabled" }, (r) =>
          resolve(chrome.runtime.lastError ? true : r && r.enabled !== false),
        );
      } catch {
        resolve(true);
      }
    });
  },

  bandOf(cheat) {
    return (cheat && SR.BANDS[cheat.band]) || SR.BANDS.moderate;
  },

  // A tiny inline chip: risk score (or a neutral mark) linking to the profile.
  // Used next to each FACEIT match-room player.
  chip(data) {
    const a = document.createElement("a");
    a.className = "sr-chip";
    a.target = "_blank";
    a.rel = "noreferrer";
    a.href = (data && data.profileUrl) || "https://csrun.win";
    a.dataset.srChip = "1";

    if (data && data.banned) {
      a.classList.add("sr-chip--ban");
      a.title = "VAC/game ban on record — view on StatRun";
      a.setAttribute("aria-label", a.title);
      a.textContent = "BAN";
      return a;
    }
    if (data && data.cheat) {
      const b = SR.bandOf(data.cheat);
      a.style.setProperty("--sr", b.hex);
      a.classList.add("sr-chip--score");
      if (data.cheat.lowConfidence) a.classList.add("sr-chip--dim");
      a.title =
        `CheatMeter ${data.cheat.score}% (${b.label})` +
        (data.cheat.lowConfidence ? " · low confidence" : "") +
        (data.gap != null ? ` · cross-platform gap ${data.gap >= 0 ? "+" : ""}${data.gap.toFixed(2)}` : "") +
        " — view on StatRun";
      a.setAttribute("aria-label", a.title);
      a.innerHTML = `<span class="sr-dot"></span>${data.cheat.score}`;
      return a;
    }
    // no data → neutral "view on StatRun" mark
    a.classList.add("sr-chip--neutral");
    a.title = "View this player on StatRun";
    a.setAttribute("aria-label", a.title);
    a.textContent = "SR";
    return a;
  },
  // (the old SR.panel Steam card lived here — steam.js builds its own
  // token-based panel now, and the legacy styles it depended on are gone)
};
