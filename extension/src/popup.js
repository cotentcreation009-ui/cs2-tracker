// Toolbar popup — master enable toggle + quick player lookup. All data comes
// from the background worker ({type:"lookup"}); this file only builds DOM.
// Untrusted strings (nicknames) are set via textContent, never innerHTML.

(function () {
  const $ = (id) => document.getElementById(id);

  // CheatMeter band -> token var + label. Covers both the API band names used
  // by badge.js (verylow…veryhigh) and the design-contract names (guarded/severe).
  const BANDS = {
    verylow: { v: "--sr-good", label: "Very low" },
    low: { v: "--sr-good", label: "Low" },
    guarded: { v: "--sr-mid", label: "Guarded" },
    moderate: { v: "--sr-mid", label: "Moderate" },
    high: { v: "--sr-high", label: "High" },
    severe: { v: "--sr-bad", label: "Severe" },
    veryhigh: { v: "--sr-bad", label: "Very high" },
  };

  // Premier tier hexes (CS2 rarity scale, per DESIGN.md).
  const TIERS = [
    [30000, "#ffd700"],
    [25000, "#eb4b4b"],
    [20000, "#d32ce6"],
    [15000, "#8847ff"],
    [10000, "#4b69ff"],
    [5000, "#5e98d9"],
    [0, "#b0c3d9"],
  ];

  function tierHex(rating) {
    for (const [min, hex] of TIERS) if (rating >= min) return hex;
    return TIERS[TIERS.length - 1][1];
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  const enabledBox = $("enabled");
  const form = $("lookup");
  const q = $("q");
  const result = $("result");
  let siteBase = "https://csrun.win";
  let seq = 0;

  // ---- init ------------------------------------------------------------

  chrome.storage.sync.get(["enabled", "apiBase"]).then(({ enabled, apiBase }) => {
    enabledBox.checked = enabled !== false;
    siteBase = (apiBase || siteBase).replace(/\/+$/, "");
    const site = $("site");
    site.href = siteBase;
    site.textContent = siteBase.replace(/^https?:\/\//, "");
  });

  enabledBox.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: enabledBox.checked });
  });

  $("version").textContent = "v" + chrome.runtime.getManifest().version;

  $("opts").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // ---- lookup ----------------------------------------------------------

  function lookup(params) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "lookup", ...params }, (r) =>
          resolve(chrome.runtime.lastError ? { error: "unavailable" } : r),
        );
      } catch {
        resolve({ error: "unavailable" });
      }
    });
  }

  function render(node) {
    result.replaceChildren(node);
  }

  function skeleton() {
    const c = el("div", "sr-card sr-mini");
    c.appendChild(el("div", "sr-skel sr-skel-name"));
    const row = el("div", "sr-mini-stats");
    for (let i = 0; i < 3; i++) row.appendChild(el("div", "sr-skel sr-skel-stat"));
    c.appendChild(row);
    c.appendChild(el("div", "sr-skel sr-skel-link"));
    return c;
  }

  function message(text) {
    return el("div", "sr-card sr-msg", text);
  }

  function bandChip(varName, parts, title) {
    const chip = el("span", "sr-bandchip");
    chip.style.setProperty("--band", `var(${varName})`);
    if (title) chip.title = title;
    for (const p of parts) chip.appendChild(p);
    return chip;
  }

  function stat(label, valueNodes) {
    const s = el("div", "sr-stat");
    s.appendChild(el("div", "sr-label", label));
    const v = el("div", "sr-val");
    if (valueNodes.length) valueNodes.forEach((n) => v.appendChild(n));
    else v.appendChild(el("span", "sr-none", "—"));
    s.appendChild(v);
    return s;
  }

  function card(name, data) {
    const c = el("div", "sr-card sr-mini");

    const head = el("div", "sr-mini-head");
    const nameEl = el("div", "sr-name", name); // untrusted -> textContent
    nameEl.title = name;
    head.appendChild(nameEl);

    const flags = el("div", "sr-flags");
    if (data.banned) {
      flags.appendChild(
        bandChip("--sr-bad", [el("span", null, "BANNED")], "VAC or game ban on record"),
      );
    }
    if (data.cheat && data.cheat.score != null) {
      const band = BANDS[data.cheat.band] || BANDS.moderate;
      flags.appendChild(
        bandChip(
          band.v,
          [
            el("span", "sr-dot"),
            el("span", "sr-num", String(data.cheat.score)),
            el("span", null, band.label),
          ],
          "CheatMeter — signal, not proof",
        ),
      );
    }
    if (flags.childNodes.length) head.appendChild(flags);
    c.appendChild(head);

    const stats = el("div", "sr-mini-stats");

    const faceitParts = [];
    const lvl = Number(data.faceitLevel);
    if (lvl >= 1 && lvl <= 10) {
      faceitParts.push(el("span", `sr-lvlb sr-lvl sr-lvl-${Math.round(lvl)}`, String(Math.round(lvl))));
    }
    if (data.faceitElo != null) {
      faceitParts.push(el("span", "sr-elo sr-num", Number(data.faceitElo).toLocaleString("en-US")));
    }
    stats.appendChild(stat("Faceit", faceitParts));

    const premierParts = [];
    if (data.premier) {
      const plate = el("span", "sr-plate sr-num", Number(data.premier).toLocaleString("en-US"));
      plate.style.setProperty("--tier", tierHex(Number(data.premier)));
      premierParts.push(plate);
    }
    stats.appendChild(stat("Premier", premierParts));

    const kdParts = [];
    const kd = Number(data.kd);
    if (Number.isFinite(kd) && kd > 0) kdParts.push(el("span", "sr-num", kd.toFixed(2)));
    stats.appendChild(stat("K/D", kdParts));

    c.appendChild(stats);

    const a = el("a", "sr-report", "Full report ↗");
    a.href = data.profileUrl || siteBase;
    a.target = "_blank";
    a.rel = "noreferrer";
    c.appendChild(a);

    return c;
  }

  function hasData(d) {
    return !!(d && !d.error && (d.cheat || d.banned || d.premier || d.faceitElo || d.kd || d.profileUrl));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = q.value.trim();
    if (!query) return;

    const my = ++seq;
    render(skeleton());

    // 17 digits reads as a SteamID64; anything else as a FACEIT nickname.
    const params = /^\d{17}$/.test(query) ? { steamid: query } : { faceit: query };
    const data = await lookup(params);
    if (my !== seq) return; // a newer lookup superseded this one

    if (!hasData(data)) {
      const unreachable = data && data.error === "unavailable";
      render(
        message(
          unreachable
            ? "CSRun is unreachable right now"
            : "No CSRun data for that account",
        ),
      );
      return;
    }
    render(card(data.name || data.nickname || query, data));
  });
})();
