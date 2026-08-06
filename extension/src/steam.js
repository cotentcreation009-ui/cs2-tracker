// Steam profile content script — injects the StatRun sr-steam-panel under the
// profile header. The SteamID64 comes from the URL on /profiles/{id} pages;
// /id/ vanity pages embed it in the inline g_rgProfileData JSON blob (with
// g_steamID and report links as fallbacks) — all read from script text, no
// page-JS execution. Data arrives via SRApi.cheatmeter({steamid}); every
// failure path is a silent no-op so the host page never looks broken.
//
// The panel's styles live here (injected once as #statrun-steam-style) because
// the manifest ships no steam-specific stylesheet; values are tokens.css
// custom properties plus the Premier tier / band hexes fixed by DESIGN.md.

(function () {
  "use strict";

  const ROOT_ID = "statrun-steam-panel";
  const STYLE_ID = "statrun-steam-style";
  const HOME = "https://csrun.win";
  const DISCLAIMER = "Signal, not proof — elite legit players score high too.";

  // CheatMeter bands per the design contract (low/guarded/high/severe); the
  // legacy API band names are tolerated as aliases.
  const BANDS = {
    low: { word: "Low", css: "var(--sr-good)" },
    guarded: { word: "Guarded", css: "var(--sr-mid)" },
    high: { word: "High", css: "var(--sr-high)" },
    severe: { word: "Severe", css: "var(--sr-bad)" },
  };
  const BAND_ALIAS = {
    verylow: "low",
    low: "low",
    moderate: "guarded",
    guarded: "guarded",
    high: "high",
    veryhigh: "severe",
    severe: "severe",
  };

  // Premier tier hexes (CS2 rarity scale, fixed by DESIGN.md).
  function tierHex(rating) {
    if (rating >= 30000) return "#ffd700";
    if (rating >= 25000) return "#eb4b4b";
    if (rating >= 20000) return "#d32ce6";
    if (rating >= 15000) return "#8847ff";
    if (rating >= 10000) return "#4b69ff";
    if (rating >= 5000) return "#5e98d9";
    return "#b0c3d9";
  }

  // Official FACEIT level floors — used when the API sends elo without a level.
  const LEVEL_FLOORS = [100, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
  function levelFromElo(elo) {
    let lvl = 1;
    for (let i = 0; i < LEVEL_FLOORS.length; i++) {
      if (elo >= LEVEL_FLOORS[i]) lvl = i + 1;
    }
    return lvl;
  }

  const CSS = `
.sr-steam-panel{width:100%;margin:12px 0;background:var(--sr-panel);border:1px solid var(--sr-line);border-radius:var(--sr-r-panel);box-shadow:var(--sr-shadow);color:var(--sr-ink);font-family:var(--sr-font);font-size:12px;line-height:1.35;font-variant-numeric:tabular-nums;text-align:left;overflow:hidden}
.sr-steam-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--sr-line)}
.sr-steam-brand{font-size:12px;font-weight: 700;color:var(--sr-ink);white-space:nowrap}
.sr-steam-brand b{font-weight: 700;color:var(--sr-brand)}
.sr-steam-sub{font-size:11px;color:var(--sr-muted);white-space:nowrap}
.sr-steam-spacer{flex:1 1 auto}
.sr-steam-bandchip{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:var(--sr-r-chip);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--band);background:color-mix(in srgb,var(--band) 12%,transparent);border:1px solid color-mix(in srgb,var(--band) 40%,transparent)}
.sr-steam-bandchip--severe{box-shadow:0 0 8px color-mix(in srgb,var(--band) 25%,transparent)}
.sr-steam-dot{width:6px;height:6px;border-radius:50%;background:var(--band)}
.sr-steam-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
.sr-steam-cell{min-width:0;padding:10px 12px}
.sr-steam-cell+.sr-steam-cell{border-left:1px solid var(--sr-line)}
.sr-steam-cell .sr-label{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-steam-val{display:flex;align-items:center;gap:4px;height:20px;margin-top:4px;font-size:13px;font-weight:700;color:var(--sr-ink);white-space:nowrap}
.sr-steam-val--na{color:var(--sr-faint);font-weight:400}
.sr-steam-score{font-size:13px;font-weight: 700;color:var(--band)}
.sr-steam-plate{display:inline-flex;align-items:center;padding:1px 6px;border-radius:var(--sr-r-chip);font-size:13px;font-weight: 700;color:color-mix(in srgb, var(--tier) 62%, white);background:color-mix(in srgb,var(--tier) 12%,transparent);border:1px solid color-mix(in srgb,var(--tier) 45%,transparent)}
.sr-steam-lvl{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:var(--sr-r-chip);font-size:10px;font-weight: 700;line-height:1}
.sr-steam-elo{color:var(--sr-orange)}
.sr-steam-ban{padding:8px 12px;border-top:1px solid var(--sr-line);background:color-mix(in srgb,var(--sr-bad) 12%,transparent);color:var(--sr-bad);font-size:11px;font-weight:700}
.sr-steam-empty{padding:16px 12px;font-size:11px;color:var(--sr-faint);text-align:center}
.sr-steam-foot{border-top:1px solid var(--sr-line)}
.sr-steam-foot a{display:block;padding:8px 12px;font-size:11px;font-weight:700;text-align:center;color:var(--sr-brand) !important;text-decoration:none !important;transition:background 120ms ease-out}
.sr-steam-foot a:hover{background:color-mix(in srgb,var(--sr-brand) 8%,transparent)}
.sr-steam-foot a:focus-visible{outline:2px solid var(--sr-brand);outline-offset:-2px}
.sr-steam-skel-label{width:56px;height:12px}
.sr-steam-skel-value{width:72px;height:16px;margin-top:8px}
@media (prefers-reduced-motion:reduce){.sr-steam-foot a{transition:none}}
`;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- data hygiene -----------------------------------------------------

  function posNum(x) {
    const n = typeof x === "string" ? Number(x) : x;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normCheat(c) {
    if (!c) return null;
    const s = Number(c.score);
    if (!Number.isFinite(s)) return null;
    const band = BAND_ALIAS[String(c.band || "").toLowerCase()] || "guarded";
    return { score: Math.max(0, Math.min(100, Math.round(s))), band };
  }

  function safeUrl(u) {
    try {
      const p = new URL(String(u));
      if (p.protocol === "https:") return p.href;
    } catch {
      /* fall through */
    }
    return HOME;
  }

  // ---- id resolution ----------------------------------------------------

  function steamId64() {
    const m = location.pathname.match(/\/profiles\/(\d{17})/);
    if (m) return m[1];
    for (const s of document.scripts) {
      const t = s.textContent || "";
      let g = t.match(/g_rgProfileData\s*=\s*\{[^]*?"steamid"\s*:\s*"(\d{17})"/);
      if (g) return g[1];
      g = t.match(/g_steamID\s*=\s*"(\d{17})"/);
      if (g) return g[1];
    }
    // Last resort: an abuse/report link carries the id.
    const rep = document.querySelector('a[href*="ReportAbuse"], a[href*="steamid="]');
    if (rep) {
      const g = (rep.getAttribute("href") || "").match(/(\d{17})/);
      if (g) return g[1];
    }
    return null;
  }

  // ---- render -----------------------------------------------------------

  function statCell(label, title) {
    const c = el("div", "sr-steam-cell");
    if (title) c.title = title;
    c.appendChild(el("span", "sr-label", label));
    return c;
  }

  function naRow() {
    return el("div", "sr-steam-val sr-steam-val--na", "—");
  }

  function cellCheat(cheat, band) {
    const c = statCell("CheatMeter", DISCLAIMER);
    if (!cheat) {
      c.appendChild(naRow());
      return c;
    }
    const v = el("div", "sr-steam-val");
    v.appendChild(el("span", "sr-steam-score", String(cheat.score)));
    c.appendChild(v);
    return c;
  }

  function cellPremier(premier) {
    const r = posNum(premier);
    const c = statCell("Premier", "CS2 Premier rating");
    if (!r) {
      c.appendChild(naRow());
      return c;
    }
    const v = el("div", "sr-steam-val");
    const plate = el("span", "sr-steam-plate", r.toLocaleString("en-US"));
    plate.style.setProperty("--tier", tierHex(r));
    v.appendChild(plate);
    c.appendChild(v);
    return c;
  }

  function cellFaceit(data) {
    const elo = posNum(data.faceitElo);
    const raw = posNum(data.faceitLevel);
    const lvl = raw >= 1 && raw <= 10 ? Math.round(raw) : elo ? levelFromElo(elo) : 0;
    const c = statCell(
      "FACEIT",
      lvl && elo ? "FACEIT level " + lvl + " · " + Number(elo).toLocaleString("en-US") + " elo" : "FACEIT level and elo",
    );
    if (!lvl && !elo) {
      c.appendChild(naRow());
      return c;
    }
    const v = el("div", "sr-steam-val");
    if (lvl) v.appendChild(el("span", "sr-steam-lvl sr-lvl sr-lvl-" + lvl, String(lvl)));
    if (elo) v.appendChild(el("span", "sr-steam-elo", Number(elo).toLocaleString("en-US")));
    c.appendChild(v);
    return c;
  }

  function cellKd(kd) {
    const n = posNum(kd);
    const c = statCell("K/D", "Kill/death ratio");
    c.appendChild(n ? el("div", "sr-steam-val", n.toFixed(2)) : naRow());
    return c;
  }

  function cellGap(gap) {
    const c = statCell("MM vs FACEIT", "Cross-platform gap — Premier vs FACEIT performance");
    const g = gap == null ? NaN : Number(gap);
    if (!Number.isFinite(g)) {
      c.appendChild(naRow());
      return c;
    }
    c.appendChild(el("div", "sr-steam-val", (g >= 0 ? "+" : "") + g.toFixed(2)));
    return c;
  }

  function header(cheat, band) {
    const head = el("div", "sr-steam-head");
    const brand = el("span", "sr-steam-brand", "Stat");
    brand.appendChild(el("b", null, "Run"));
    head.appendChild(brand);
    head.appendChild(el("span", "sr-steam-sub", "· CS2 report"));
    head.appendChild(el("span", "sr-steam-spacer"));
    if (cheat) {
      const chip = el(
        "span",
        "sr-steam-bandchip" + (cheat.band === "severe" ? " sr-steam-bandchip--severe" : ""),
      );
      chip.title = DISCLAIMER;
      chip.appendChild(el("span", "sr-steam-dot"));
      chip.appendChild(document.createTextNode(band.word));
      head.appendChild(chip);
    }
    return head;
  }

  function footer(profileUrl) {
    const foot = el("div", "sr-steam-foot");
    const a = el("a", null, "Full report on csrun.win ↗");
    a.href = safeUrl(profileUrl);
    a.target = "_blank";
    a.rel = "noreferrer";
    foot.appendChild(a);
    return foot;
  }

  // Full panel from a cheatmeter payload. Never throws; unknown fields show "—".
  function render(data) {
    ensureStyle();
    const d = data || {};
    const cheat = normCheat(d.cheat);
    const band = cheat ? BANDS[cheat.band] : null;

    const root = el("div", "sr-reset sr-steam-panel");
    if (band) root.style.setProperty("--band", band.css);
    root.appendChild(header(cheat, band));

    const hasAny = !!(
      cheat ||
      d.banned ||
      posNum(d.premier) ||
      posNum(d.faceitElo) ||
      posNum(d.kd) ||
      d.gap != null
    );
    if (hasAny) {
      const grid = el("div", "sr-steam-grid");
      grid.appendChild(cellCheat(cheat, band));
      grid.appendChild(cellPremier(d.premier));
      grid.appendChild(cellFaceit(d));
      grid.appendChild(cellKd(d.kd));
      grid.appendChild(cellGap(d.gap));
      root.appendChild(grid);
    } else {
      root.appendChild(el("div", "sr-steam-empty", "No data yet"));
    }

    if (d.banned) root.appendChild(el("div", "sr-steam-ban", "VAC or game ban on record"));
    root.appendChild(footer(d.profileUrl));
    return root;
  }

  // Loading state: same shell, shimmering cells.
  function skeleton() {
    ensureStyle();
    const root = el("div", "sr-reset sr-steam-panel");
    root.appendChild(header(null, null));
    const grid = el("div", "sr-steam-grid");
    for (let i = 0; i < 5; i++) {
      const c = el("div", "sr-steam-cell");
      c.appendChild(el("div", "sr-skel sr-steam-skel-label"));
      c.appendChild(el("div", "sr-skel sr-steam-skel-value"));
      grid.appendChild(c);
    }
    root.appendChild(grid);
    root.appendChild(footer(null));
    return root;
  }

  // ---- gating + mount ---------------------------------------------------

  async function allowed() {
    try {
      if (typeof SRSettings !== "undefined" && SRSettings && typeof SRSettings.get === "function") {
        const s = await SRSettings.get();
        if (s && typeof s === "object") {
          if (s.enabled === false) return false;
          if (s["feature.steam"] === false) return false;
        }
      }
    } catch {
      /* settings layer unavailable — display features default on */
    }
    return true;
  }

  async function init() {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const id = steamId64();
      if (!id) return;
      // Sit under the profile header; fall back to the top of content.
      const anchor =
        document.querySelector(".profile_header") ||
        document.querySelector(".profile_content") ||
        document.querySelector(".responsive_page_template_content");
      if (!anchor) return;
      if (!(await allowed())) return;
      if (typeof SRApi === "undefined" || !SRApi || typeof SRApi.cheatmeter !== "function") return;

      const skel = skeleton();
      skel.id = ROOT_ID;
      anchor.insertAdjacentElement("afterend", skel);

      let data = null;
      try {
        data = await SRApi.cheatmeter({ steamid: id });
      } catch {
        data = null;
      }
      if (!data || data.error) {
        skel.remove(); // error → silent no-op, page never looks broken
        return;
      }
      const panel = render(data);
      panel.id = ROOT_ID;
      skel.replaceWith(panel);
    } catch {
      /* never break the host page */
    }
  }

  // Exposed for the dev harness (dev/steam.html) so fixtures exercise the real
  // render path — mocks replace the network, never markup.
  window.SRSteam = { render, skeleton };

  // Steam profiles are server-rendered (not an SPA): one pass at idle is enough.
  init();
})();
