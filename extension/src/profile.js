// FACEIT player-profile enrichment — the sr-elo-widget. Detects
// /{lang}/players/{nick} pages (including their /stats tabs), mounts a compact
// card near the top of the profile content: current elo + level badge,
// progress to the next level threshold, today's net elo change, and the last
// 10 matches (map, K-D, W/L, per-match delta). All data comes from SRApi
// (src/lib/api.js) — this file never fetches. Every failure is a silent no-op:
// the host page must never look broken because we couldn't get data.

(function () {
  const PAGE_RE = /^\/([a-z]{2}(?:-[a-z]{2})?)\/players\/([^/?#]+)(?:\/|$)/i;

  // Official level floors (ARCHITECTURE.md): index i = floor of level i+1.
  const FLOORS = [100, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
  // One page either way — eloHistory's page size is 100 — so the wider window
  // is free, and thirty matches cannot support a per-map or per-hour read.
  const HISTORY_N = 100;
  const MAP_MIN = 4; // matches on a map before its rate is worth showing
  const HOUR_MIN = 6; // matches in a time band before it is worth showing
  const LIST_N = 10;
  const DEBOUNCE_MS = 400;

  const MINUS = "−"; // −
  const PLUSMINUS = "±"; // ±
  const DASH = "—"; // — (missing value)
  const NDASH = "–"; // – (K–D separator)

  let currentNick = null;
  let root = null;
  let mounting = false;
  let observer = null;
  // Nicks with no usable data → stay silent, no refetch loop. Entries expire
  // so a transient failure doesn't hide the card for the whole session.
  const FAILED_TTL_MS = 5 * 60 * 1000;
  const failed = new Map(); // nick(lower) -> timestamp

  function recentlyFailed(nick) {
    const at = failed.get(nick.toLowerCase());
    if (at == null) return false;
    if (Date.now() - at < FAILED_TTL_MS) return true;
    failed.delete(nick.toLowerCase());
    return false;
  }

  // ---- tiny DOM helpers (no innerHTML: nicknames/map names are untrusted) --

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---- styles (tokens only; injected once) --------------------------------

  const CSS = [
    // fills the host content column — a capped width leaves a ragged right
    // edge against FACEIT's own full-width cards and marks it as injected
    ".sr-elo-root{margin:12px 0;width:100%;}",
    ".sr-elo-widget{box-sizing:border-box;background:linear-gradient(180deg,color-mix(in srgb,var(--sr-panel2) 88%,var(--sr-brand)) 0%,var(--sr-panel) 34%,color-mix(in srgb,var(--sr-bg) 30%,var(--sr-panel)) 100%);border:1px solid var(--sr-line);border-radius:var(--sr-r-card);box-shadow:var(--sr-shadow),inset 0 1px 0 rgb(255 255 255/.05);padding:14px;color:var(--sr-ink);font:400 11px/1.35 var(--sr-font);}",
    ".sr-elo-widget *{box-sizing:border-box;}",
    ".sr-elo-top{display:flex;align-items:center;gap:14px;}",
".sr-elo-ring{position:relative;flex:none;width:54px;height:54px;border-radius:50%;background:conic-gradient(var(--lvl,var(--sr-brand)) calc(var(--pct,0) * 1%), var(--sr-line2) 0);box-shadow:0 0 18px color-mix(in srgb,var(--lvl,var(--sr-brand)) 22%,transparent);}",
".sr-elo-ring::after{content:\"\";position:absolute;inset:5px;border-radius:50%;background:linear-gradient(180deg,color-mix(in srgb,var(--sr-panel2) 80%,var(--sr-panel)),var(--sr-panel));}",
".sr-elo-ringnum{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;line-height:1;color:var(--lvl,var(--sr-ink));text-shadow:0 0 12px color-mix(in srgb,var(--lvl,var(--sr-ink)) 35%,transparent);}",
    ".sr-elo-lvl{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--sr-r-chip);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-elo-main{min-width:0;}",
    ".sr-elo-cur{font-size:19px;font-weight:800;line-height:1;color:var(--sr-orange);font-variant-numeric:tabular-nums;}",
".sr-elo-curunit{font-size:11px;font-weight:600;color:var(--sr-muted);}",
".sr-elo-herometa{margin-top:4px;font-size:11px;color:var(--sr-muted);}",
".sr-elo-herometa b{color:var(--sr-ink);font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-elo-today{margin-left:auto;flex:none;text-align:right;}",
    ".sr-elo-delta{margin-top:2px;font-size:12px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;}",
    ".sr-elo-delta--up{color:var(--sr-good);}",
    ".sr-elo-delta--down{color:var(--sr-bad);}",
    ".sr-elo-delta--flat{color:var(--sr-muted);}",
    ".sr-elo-delta--none{color:var(--sr-faint);font-weight:400;}",
    ".sr-elo-bar{margin-top:12px;height:4px;border-radius:2px;background:var(--sr-panel2);overflow:hidden;}",
    ".sr-elo-bar-fill{height:100%;border-radius:2px;background:var(--sr-orange);}",
    ".sr-elo-max-gain{color:var(--sr-orange);font-weight:700;}",
    ".sr-elo-bar-meta{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:4px;font-size:10px;color:var(--sr-faint);font-variant-numeric:tabular-nums;}",
    ".sr-elo-bar-note{color:var(--sr-muted);}",
    ".sr-elo-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;border-top:1px solid var(--sr-line);padding-top:8px;}",
    ".sr-elo-wordmark{font-size:11px;font-weight:700;color:var(--sr-ink);text-decoration:none;}",
    ".sr-elo-wordmark b{color:var(--sr-brand);font-weight:700;}",
    ".sr-elo-wordmark:focus-visible{outline:2px solid var(--sr-brand);outline-offset:2px;}",
    ".sr-elo-list{margin-top:12px;border-top:1px solid var(--sr-line);padding-top:8px;}",
    ".sr-elo-row--head{height:16px;margin-top:6px;}",
    ".sr-elo-row--head .sr-label{font-size:10px;}",
    ".sr-elo-rows{margin-top:2px;}",
    ".sr-elo-row{display:grid;grid-template-columns:12px minmax(0,1fr) 52px 34px 44px;align-items:center;gap:8px;height:24px;padding:0 4px;margin:0 -4px;border-radius:var(--sr-r-chip);font-size:11px;color:var(--sr-ink);text-decoration:none;}",
    "a.sr-elo-row{cursor:pointer;transition:background-color 120ms ease-out;}",
    "a.sr-elo-row:hover{background:var(--sr-panel2);}",
    "a.sr-elo-row:focus-visible{outline:2px solid var(--sr-brand);outline-offset:-2px;}",
    ".sr-elo-dot{width:8px;height:8px;justify-self:center;border-radius:50%;}",
    ".sr-elo-dot--w{background:var(--sr-good);}",
    ".sr-elo-dot--l{background:var(--sr-bad);border-radius:2px;}", /* square: W/L scans without color */
    ".sr-elo-dot--u{background:transparent;border:1px solid var(--sr-line2);}",
    ".sr-elo-map{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".sr-elo-kd{text-align:right;color:var(--sr-muted);font-variant-numeric:tabular-nums;}",
    ".sr-elo-when{text-align:right;color:var(--sr-faint);font-variant-numeric:tabular-nums;}",
    ".sr-elo-rowdelta{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-elo-empty{padding:16px 12px;font-size:11px;color:var(--sr-faint);text-align:center;}",
    /* loading skeleton */
    ".sr-elo-skel-sq{width:24px;height:24px;border-radius:var(--sr-r-chip);}",
    ".sr-elo-skel-a{width:96px;height:12px;}",
    ".sr-elo-skel-b{width:44px;height:12px;margin-left:auto;}",
    ".sr-elo-skel-bar{margin-top:12px;height:4px;}",
    ".sr-elo-skel-rows{margin-top:12px;}",
    ".sr-elo-skel-row{height:12px;}",
    ".sr-elo-skel-row+.sr-elo-skel-row{margin-top:8px;}",
    ".sr-elo-skel-row:nth-child(2){width:92%;}",
    ".sr-elo-skel-row:nth-child(3){width:97%;}",
    ".sr-elo-skel-row:nth-child(4){width:88%;}",
    // ---- overhaul: chips, tabs, chart, grid, bars, insights, maps ----------
    ".sr-p-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px;}",
    ".sr-p-chip{display:inline-flex;align-items:baseline;gap:4px;height:20px;padding:0 7px;border-radius:var(--sr-r-chip);border:1px solid transparent;white-space:nowrap;text-decoration:none;}",
    ".sr-p-chipk{font-size:8px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;opacity:.75;}",
    ".sr-p-chipv{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-p-chip--prem{color:var(--sr-brand);background:color-mix(in srgb,var(--sr-brand) 12%,transparent);border-color:color-mix(in srgb,var(--sr-brand) 40%,transparent);}",
    ".sr-p-chip--cm{color:var(--sr-cm);background:color-mix(in srgb,var(--sr-cm) 14%,transparent);border-color:color-mix(in srgb,var(--sr-cm) 45%,transparent);}",
    ".sr-p-chip--ban{color:var(--sr-bg);background:var(--sr-bad);border-color:var(--sr-bad);}",
    // the one actionable thing in the header, so it is the only filled control
    ".sr-p-chip--site{margin-left:auto;color:var(--sr-brand);background:color-mix(in srgb,var(--sr-brand) 14%,transparent);border-color:color-mix(in srgb,var(--sr-brand) 45%,transparent);cursor:pointer;transition:background 120ms ease-out;}",
    ".sr-p-chip--site:hover,.sr-p-chip--site:focus-visible{background:color-mix(in srgb,var(--sr-brand) 26%,transparent);}",
    ".sr-p-arrow{font-size:9px;opacity:.8;}",

    ".sr-p-tabs{display:flex;gap:2px;margin-top:12px;padding:2px;background:var(--sr-panel2);border:1px solid var(--sr-line);border-radius:var(--sr-r-chip);}",
    ".sr-p-tab{flex:1 1 0;appearance:none;border:0;background:transparent;color:var(--sr-muted);font:700 10px/1 var(--sr-font);letter-spacing:.06em;text-transform:uppercase;padding:6px 4px;border-radius:3px;cursor:pointer;}",
    ".sr-p-tab:hover{color:var(--sr-ink);}",
    ".sr-p-tab--on{background:var(--sr-panel);color:var(--sr-ink);box-shadow:0 1px 2px rgb(0 0 0/.3);}",
    ".sr-p-tab:focus-visible{outline:2px solid var(--sr-brand);outline-offset:-2px;}",
    ".sr-p-panel{margin-top:10px;}",
    ".sr-p-sec{margin-top:12px;}",
    ".sr-p-sec:first-child{margin-top:0;}",

    ".sr-p-chartmeta{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;}",
    ".sr-p-net{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-p-chart{width:100%;height:46px;}",
    ".sr-p-svg{display:block;width:100%;height:46px;}",
    ".sr-p-line{fill:none;stroke-width:1.6;vector-effect:non-scaling-stroke;stroke-linejoin:round;}",
    ".sr-p-line--up{stroke:var(--sr-good);}",
    ".sr-p-line--down{stroke:var(--sr-bad);}",
    ".sr-p-area{stroke:none;}",
    ".sr-p-area--up{fill:color-mix(in srgb,var(--sr-good) 14%,transparent);}",
    ".sr-p-area--down{fill:color-mix(in srgb,var(--sr-bad) 14%,transparent);}",

    // value over label, the same idiom as the match-room strip
    ".sr-p-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:10px 8px;margin-top:12px;}",
    ".sr-p-cell{min-width:0;}",
    ".sr-p-cv{font-size:14px;font-weight:700;line-height:1.1;color:var(--sr-ink);font-variant-numeric:tabular-nums;white-space:nowrap;}",
    ".sr-p-cv--none{color:var(--sr-faint);font-weight:400;}",
    ".sr-p-cl{margin-top:2px;font-size:8px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--sr-faint);}",

    ".sr-p-bars{margin-top:6px;display:flex;flex-direction:column;gap:5px;}",
    ".sr-p-bar{display:grid;grid-template-columns:70px 1fr 28px;align-items:center;gap:8px;}",
    ".sr-p-barlabel{font-size:10px;color:var(--sr-muted);}",
    ".sr-p-track{height:5px;border-radius:3px;background:var(--sr-panel2);overflow:hidden;}",
    ".sr-p-fill{display:block;height:100%;border-radius:3px;}",
    ".sr-p-barval{font-size:11px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;color:var(--sr-ink);}",

    ".sr-p-tiles{margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;}",
    ".sr-p-tile{position:relative;min-width:0;padding:9px 12px 10px 14px;border-radius:var(--sr-r-chip);background:color-mix(in srgb,var(--sr-bg) 40%,transparent);border:1px solid color-mix(in srgb,var(--sr-line) 80%,transparent);overflow:hidden;}",
    ".sr-p-tile::before{content:\"\";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tone,var(--sr-line2));}",
    ".sr-p-tile--good{--tone:var(--sr-good);}",
    ".sr-p-tile--bad{--tone:var(--sr-bad);}",
    ".sr-p-tilelabel{font-size:8px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sr-faint);}",
    ".sr-p-tilev{margin-top:3px;font-size:14px;font-weight:700;line-height:1.15;color:var(--tone,var(--sr-ink));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".sr-p-tilesub{margin-top:2px;font-size:10px;color:var(--sr-muted);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".sr-p-facts{margin-top:9px;font-size:10px;color:var(--sr-faint);font-variant-numeric:tabular-nums;}",

    // The aim/duel figures are a shade smaller than the headline row — they are
    // supporting detail — but nowhere near the 10px they used to be, and they
    // now spread across the full width instead of bunching at the left.
    ".sr-p-grid--fine{gap:10px 8px;}",
    ".sr-p-grid--fine .sr-p-cv{font-size:12px;color:var(--sr-muted);}",

    ".sr-p-maprow{display:grid;grid-template-columns:1fr 44px 44px 40px 40px 64px;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--sr-line);}",
    ".sr-p-maprow--head{border-bottom:1px solid var(--sr-line2);padding-bottom:4px;}",
    ".sr-p-maprow:last-child{border-bottom:0;}",
    // a map with too few games keeps its numbers but loses its colour
    ".sr-p-maprow--thin .sr-p-num,.sr-p-maprow--thin .sr-p-mapname{color:var(--sr-muted);}",
    ".sr-p-mapname{font-size:11px;font-weight:600;color:var(--sr-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".sr-p-num{font-size:11px;text-align:right;font-variant-numeric:tabular-nums;color:var(--sr-ink);}",
    ".sr-p-bar2{height:5px;border-radius:3px;background:var(--sr-panel2);overflow:hidden;}",
    ".sr-p-bar2fill{display:block;height:100%;border-radius:3px;background:var(--sr-line2);}",
    "@media (max-width:520px){.sr-p-maprow{grid-template-columns:1fr 36px 40px 36px 52px;}.sr-p-maprow>span:nth-child(3){display:none;}}",
    "@media (prefers-reduced-motion:reduce){a.sr-elo-row{transition:none;}}",
  ].join("\n");

  function ensureStyles() {
    if (document.getElementById("statrun-profile-style")) return;
    const s = document.createElement("style");
    s.id = "statrun-profile-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- data access (contract: SRApi from src/lib/api.js) ------------------

  function apiRef() {
    if (typeof SRApi !== "undefined" && SRApi) return SRApi;
    return window.SRApi || null;
  }

  async function readSettings() {
    try {
      if (typeof SRSettings !== "undefined" && SRSettings && typeof SRSettings.get === "function") {
        return (await SRSettings.get()) || {};
      }
    } catch {
      /* settings unavailable — fall through to defaults */
    }
    return {};
  }

  function featureOn(s) {
    if (s.enabled === false) return false;
    if (s["feature.profile"] === false) return false;
    if (s.feature && s.feature.profile === false) return false;
    return true; // display features default on
  }

  // ---- formatting ---------------------------------------------------------

  function fmtSigned(n) {
    if (n > 0) return "+" + n;
    if (n < 0) return MINUS + Math.abs(n);
    return PLUSMINUS + "0";
  }

  function deltaClass(n) {
    return n > 0 ? "sr-elo-delta--up" : n < 0 ? "sr-elo-delta--down" : "sr-elo-delta--flat";
  }

  // Compact age for the match list: "2h", "3d", "5w". Short enough for a
  // 34px column, precise enough to tell three Nuke games apart.
  function shortAgo(date) {
    const t = date instanceof Date ? date.getTime() : +date;
    if (!isFinite(t) || t <= 0) return DASH;
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h";
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + "d";
    const wks = Math.floor(days / 7);
    return wks < 9 ? wks + "w" : Math.floor(days / 30) + "mo";
  }

  // Exact local time, for the row's tooltip.
  function absTime(date) {
    const t = date instanceof Date ? date.getTime() : +date;
    if (!isFinite(t) || t <= 0) return null;
    try {
      return new Date(t).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    } catch {
      return null;
    }
  }

  function mapName(raw) {
    if (!raw || typeof raw !== "string") return DASH;
    const m = raw.replace(/^(de|cs)_/i, "");
    return m.charAt(0).toUpperCase() + m.slice(1);
  }

  function wonOf(row) {
    const w = row && row.win;
    if (w === true || w === 1 || w === "1") return true;
    if (w === false || w === 0 || w === "0") return false;
    return null;
  }

  function isToday(ts) {
    if (ts == null) return false;
    const d = new Date(ts);
    const n = new Date();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  }

  // Sum of today's known deltas; null when nothing is posted for today yet
  // (no matches, or FACEIT hasn't computed elo for the recent rows).
  function todayDelta(rows) {
    if (!Array.isArray(rows)) return null;
    let sum = 0;
    let known = false;
    for (const r of rows) {
      if (!r || !isToday(r.date)) continue;
      if (typeof r.delta === "number" && isFinite(r.delta)) {
        sum += r.delta;
        known = true;
      }
    }
    return known ? sum : null;
  }

  // ---- analysis ----------------------------------------------------------
  //
  // Everything below is derived from history the widget already fetches. None
  // of it costs a request, and none of it is available anywhere on FACEIT's
  // own profile — which is the point of showing it here.

  // Per-map record. Returns newest-first order preserved, sorted by volume.
  function mapAgg(rows) {
    const by = new Map();
    for (const r of rows || []) {
      if (!r || !r.map) continue;
      const key = String(r.map);
      let e = by.get(key);
      if (!e) {
        e = { map: key, n: 0, w: 0, k: 0, d: 0 };
        by.set(key, e);
      }
      e.n += 1;
      if (wonOf(r)) e.w += 1;
      e.k += r.kills || 0;
      e.d += r.deaths || 0;
    }
    return [...by.values()].sort((a, b) => b.n - a.n);
  }

  // Which part of the day they actually play well in. Bands are the viewer's
  // local time, which is the only clock they can act on.
  const BANDS = [
    { key: "morning", label: "Morning", from: 6, to: 12 },
    { key: "afternoon", label: "Afternoon", from: 12, to: 18 },
    { key: "evening", label: "Evening", from: 18, to: 24 },
    { key: "night", label: "Late night", from: 0, to: 6 },
  ];

  function hourAgg(rows) {
    const out = BANDS.map((b) => ({ ...b, n: 0, w: 0 }));
    for (const r of rows || []) {
      if (!r || !(r.date instanceof Date) || isNaN(r.date)) continue;
      const h = r.date.getHours();
      const band = out.find((b) => h >= b.from && h < b.to);
      if (!band) continue;
      band.n += 1;
      if (wonOf(r)) band.w += 1;
    }
    return out;
  }

  // How they play the match AFTER a loss, against the match after a win. rows
  // are newest-first, so the match preceding rows[i] is rows[i + 1].
  function tiltRead(rows) {
    if (!Array.isArray(rows) || rows.length < 8) return null;
    let afterLoss = 0, afterLossW = 0, afterWin = 0, afterWinW = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const prevWon = wonOf(rows[i + 1]);
      const won = wonOf(rows[i]);
      if (prevWon) {
        afterWin += 1;
        if (won) afterWinW += 1;
      } else {
        afterLoss += 1;
        if (won) afterLossW += 1;
      }
    }
    if (afterLoss < 5 || afterWin < 5) return null;
    return {
      afterLoss: (afterLossW / afterLoss) * 100,
      afterWin: (afterWinW / afterWin) * 100,
      nLoss: afterLoss,
      nWin: afterWin,
    };
  }

  // The elo line, oldest-first, from the rows that actually carry one.
  function eloSeries(rows) {
    const pts = [];
    for (let i = (rows || []).length - 1; i >= 0; i--) {
      const v = rows[i] && rows[i].elo;
      if (typeof v === "number" && isFinite(v)) pts.push(v);
    }
    return pts;
  }

  const BAND_HEX = {
    verylow: "#46d369", low: "#8fd14f", moderate: "#f5b942",
    high: "#ff8a3d", veryhigh: "#f5694a",
  };
  function bandHex(b) {
    return BAND_HEX[b] || "var(--sr-muted)";
  }

  function levelFor(elo) {
    let lvl = 1;
    for (let i = 0; i < FLOORS.length; i++) if (elo >= FLOORS[i]) lvl = i + 1;
    return Math.min(lvl, 10);
  }

  function pageLang() {
    const m = location.pathname.match(PAGE_RE);
    return m ? m[1].toLowerCase() : "en";
  }

  function roomUrl(matchId) {
    if (!matchId || typeof matchId !== "string") return null;
    return "https://www.faceit.com/" + pageLang() + "/cs2/room/" + encodeURIComponent(matchId);
  }

  // ---- rendering ----------------------------------------------------------

  function renderSkeleton(target) {
    clear(target);
    const card = el("div", "sr-elo-widget");
    const top = el("div", "sr-elo-top");
    top.append(
      el("div", "sr-skel sr-elo-skel-sq"),
      el("div", "sr-skel sr-elo-skel-a"),
      el("div", "sr-skel sr-elo-skel-b"),
    );
    const rows = el("div", "sr-elo-skel-rows");
    for (let i = 0; i < 4; i++) rows.append(el("div", "sr-skel sr-elo-skel-row"));
    card.append(top, el("div", "sr-skel sr-elo-skel-bar"), rows);
    target.append(card);
  }

  function rowEl(r) {
    const href = roomUrl(r && r.matchId);
    const node = el(href ? "a" : "div", "sr-elo-row");
    if (href) {
      node.href = href;
      node.target = "_blank";
      node.rel = "noreferrer";
    }

    const won = wonOf(r);
    const dot = el(
      "span",
      "sr-elo-dot " +
        (won === true ? "sr-elo-dot--w" : won === false ? "sr-elo-dot--l" : "sr-elo-dot--u"),
    );
    dot.title = won === true ? "Win" : won === false ? "Loss" : "Result unknown";

    const map = el("span", "sr-elo-map", mapName(r && r.map));

    const hasKd = r && r.kills != null && r.deaths != null;
    const kd = el("span", "sr-elo-kd", hasKd ? r.kills + NDASH + r.deaths : DASH);

    // When. Without it a player who queues the same map three times in a
    // night reads as three identical rows — the list looked duplicated when
    // it was simply undated.
    const when = el("span", "sr-elo-when", shortAgo(r && r.date));
    const abs = absTime(r && r.date);
    if (abs) when.title = abs;

    const d = r && typeof r.delta === "number" && isFinite(r.delta) ? r.delta : null;
    const dEl = el(
      "span",
      "sr-elo-rowdelta " + (d == null ? "sr-elo-delta--none" : deltaClass(d)),
      d == null ? DASH : fmtSigned(d),
    );
    if (d == null) dEl.title = "FACEIT hasn't posted the elo for this match yet";

    node.append(dot, map, kd, when, dEl);
    return node;
  }

  // ---- sections -----------------------------------------------------------

  function statCell(label, value, opts) {
    const o = opts || {};
    const c = el("div", "sr-p-cell");
    const v = el("div", "sr-p-cv", value == null ? DASH : String(value));
    if (value == null) v.classList.add("sr-p-cv--none");
    else if (o.hex) v.style.color = o.hex;
    c.append(v, el("div", "sr-p-cl", label));
    c.title = o.title || label;
    return c;
  }

  function gradeHex(v, good, bad) {
    if (v == null) return null;
    if (v >= good) return "var(--sr-good)";
    if (v < bad) return "var(--sr-bad)";
    return "var(--sr-ink)";
  }

  // The elo line. A number tells you where they are; the shape tells you
  // whether they are climbing into this lobby or falling into it.
  function eloChart(rows) {
    const pts = eloSeries(rows);
    if (pts.length < 5) return null;
    const w = 300, h = 46, pad = 3;
    const lo = Math.min(...pts), hi = Math.max(...pts);
    const span = hi - lo || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);

    const box = el("div", "sr-p-chart");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "sr-p-svg");
    svg.setAttribute("role", "img");
    const net = pts[pts.length - 1] - pts[0];
    svg.setAttribute(
      "aria-label",
      "Elo over the last " + pts.length + " rated matches, " + fmtSigned(net) + " net",
    );

    const line = pts.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    area.setAttribute("points", pad + "," + (h - pad) + " " + line + " " + (w - pad) + "," + (h - pad));
    area.setAttribute("class", "sr-p-area" + (net >= 0 ? " sr-p-area--up" : " sr-p-area--down"));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    path.setAttribute("points", line);
    path.setAttribute("class", "sr-p-line" + (net >= 0 ? " sr-p-line--up" : " sr-p-line--down"));
    svg.append(area, path);
    box.append(svg);

    const meta = el("div", "sr-p-chartmeta");
    meta.append(
      el("span", "sr-label", "Last " + pts.length + " rated"),
      el("span", "sr-p-net " + deltaClass(net), fmtSigned(net)),
    );
    const wrap = el("div", "sr-p-sec");
    wrap.append(meta, box);
    return wrap;
  }

  // Leetify's skill ratings, which FACEIT does not show anywhere.
  // Only the ratings that genuinely share a 0-100 scale. Leetify's clutch and
  // opening are fractions of rounds; putting them on this bar forced a made-up
  // number beside them, so they live on the detail line in their own unit.
  const SKILLS = [
    ["aim", "Aim"],
    ["positioning", "Positioning"],
    ["utility", "Utility"],
  ];

  function skillBars(st) {
    const have = SKILLS.filter(([k]) => typeof st[k] === "number" && isFinite(st[k]));
    if (have.length < 2) return null;
    const sec = el("div", "sr-p-sec");
    sec.append(el("div", "sr-label", "Skill breakdown · Leetify"));
    const list = el("div", "sr-p-bars");
    for (const [k, label] of have) {
      const v = st[k];
      const row = el("div", "sr-p-bar");
      row.append(el("span", "sr-p-barlabel", label));
      const track = el("span", "sr-p-track");
      const fill = el("span", "sr-p-fill");
      fill.style.width = Math.max(2, Math.min(100, v)) + "%";
      fill.style.background = gradeHex(v, 70, 45) || "var(--sr-brand)";
      track.append(fill);
      row.append(track, el("span", "sr-p-barval", Math.round(v)));
      row.title = label + " rating: " + Math.round(v) + " out of 100";
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  // Things a player can act on, each stated as a sentence rather than a number
  // they have to interpret.
  function insights(rows, st) {
    // The four tendencies become tiles in the card's own value-over-label
    // idiom. The old rendering was seven hairline rows with the label hard
    // left and the value hard right — a settings form gatecrashing a stats
    // card, with the whole width of the panel between a name and its number.
    const tiles = [];
    const maps = mapAgg(rows).filter((m) => m.n >= MAP_MIN);
    if (maps.length >= 2) {
      const byWr = [...maps].sort((a, b) => b.w / b.n - a.w / a.n);
      const best = byWr[0], worst = byWr[byWr.length - 1];
      if (best.w / best.n > worst.w / worst.n) {
        tiles.push({
          label: "Best map",
          value: mapName(best.map),
          sub: Math.round((best.w / best.n) * 100) + "% win \u00b7 " + best.n + " games",
          tone: "good",
        });
        tiles.push({
          label: "Weakest map",
          value: mapName(worst.map),
          sub: Math.round((worst.w / worst.n) * 100) + "% win \u00b7 " + worst.n + " games",
          tone: "bad",
        });
      }
    }

    const bands = hourAgg(rows).filter((b) => b.n >= HOUR_MIN);
    if (bands.length >= 2) {
      const best = bands.reduce((a, b) => (b.w / b.n > a.w / a.n ? b : a));
      tiles.push({
        label: "Plays best",
        value: best.label,
        sub: Math.round((best.w / best.n) * 100) + "% win \u00b7 " + best.n + " games",
        tone: "good",
      });
    }

    const tilt = tiltRead(rows);
    if (tilt) {
      const drop = tilt.afterWin - tilt.afterLoss;
      tiles.push({
        label: "After a loss",
        value: Math.round(tilt.afterLoss) + "% win",
        sub: "vs " + Math.round(tilt.afterWin) + "% after a win",
        tone: drop <= 5 ? "good" : "bad",
        title:
          "Win rate in the match immediately after a loss (" + tilt.nLoss +
          " of them) against the match after a win (" + tilt.nWin + ")",
      });
    }

    // Identity facts are not tendencies; they get one quiet line, not a row
    // of the card each.
    const facts = [];
    if (typeof st.avgPartySize === "number" && st.avgPartySize > 0) {
      facts.push("queues with " + (st.avgPartySize < 1.15 ? "solo, mostly" : st.avgPartySize.toFixed(1) + " avg"));
    }
    if (st.firstMatch) {
      const d = new Date(st.firstMatch);
      if (!isNaN(d)) {
        const yrs = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
        facts.push("playing since " + d.getFullYear() + (yrs >= 1 ? " (" + Math.floor(yrs) + "y)" : ""));
      }
    }
    if (typeof st.peakPremier === "number" && st.peakPremier > 0) {
      facts.push("peak Premier " + st.peakPremier.toLocaleString("en-US"));
    }

    if (!tiles.length && !facts.length) return null;

    const sec = el("div", "sr-p-sec");
    if (tiles.length) {
      sec.append(el("div", "sr-label", "Tendencies"));
      const grid = el("div", "sr-p-tiles");
      for (const t of tiles) {
        const tile = el("div", "sr-p-tile sr-p-tile--" + t.tone);
        tile.append(el("div", "sr-p-tilelabel", t.label));
        tile.append(el("div", "sr-p-tilev", t.value));
        tile.append(el("div", "sr-p-tilesub", t.sub));
        if (t.title) tile.title = t.title;
        grid.append(tile);
      }
      sec.append(grid);
    }
    if (facts.length) {
      const line = el("div", "sr-p-facts", facts.join("  \u00b7  "));
      line.title = "Lifetime context";
      sec.append(line);
    }
    return sec;
  }

  function mapTable(rows) {
    const maps = mapAgg(rows);
    if (!maps.length) return el("div", "sr-elo-empty", "No map data yet");
    const sec = el("div", "sr-p-sec");
    const head = el("div", "sr-p-maprow sr-p-maprow--head");
    head.append(
      el("span", "sr-label", "Map"),
      el("span", "sr-label sr-p-num", "Played"),
      el("span", "sr-label sr-p-num", "W–L"),
      el("span", "sr-label sr-p-num", "Win"),
      el("span", "sr-label sr-p-num", "K/D"),
      el("span", "sr-label sr-p-bar2", ""),
    );
    sec.append(head);
    for (const m of maps) {
      const wr = (m.w / m.n) * 100;
      const kd = m.d > 0 ? m.k / m.d : null;
      const thin = m.n < MAP_MIN;
      const row = el("div", "sr-p-maprow" + (thin ? " sr-p-maprow--thin" : ""));
      row.append(el("span", "sr-p-mapname", mapName(m.map)));
      row.append(el("span", "sr-p-num", String(m.n)));
      row.append(el("span", "sr-p-num", m.w + NDASH + (m.n - m.w)));
      const wrEl = el("span", "sr-p-num", Math.round(wr) + "%");
      if (!thin) wrEl.style.color = gradeHex(wr, 55, 45);
      row.append(wrEl);
      const kdEl = el("span", "sr-p-num", kd == null ? DASH : kd.toFixed(2));
      if (!thin && kd != null) kdEl.style.color = gradeHex(kd, 1.1, 0.9);
      row.append(kdEl);
      const track = el("span", "sr-p-bar2");
      const fill = el("span", "sr-p-bar2fill");
      fill.style.width = Math.max(2, Math.min(100, wr)) + "%";
      if (!thin) fill.style.background = gradeHex(wr, 55, 45) || "var(--sr-line2)";
      track.append(fill);
      row.append(track);
      row.title = thin
        ? mapName(m.map) + " — only " + m.n + " match" + (m.n === 1 ? "" : "es") + ", read with care"
        : mapName(m.map) + " — " + m.w + " of " + m.n + " won";
      sec.append(row);
    }
    return sec;
  }


  // The official ladder colours, as VALUES — the .sr-lvl chip class carries a
  // border and tinted fill that would turn the ring into a square.
  const LEVEL_HEX = [
    "#eeeeee", "#47e36c", "#47e36c", "#ffc659", "#ffc659",
    "#ffc659", "#ffc659", "#ff8a50", "#ff8a50", "#fe1f00",
  ];

  // The same conic-gradient ring the Steam card wears: filled to the player's
  // progress through their current level, in the level's own colour. Drawn
  // without SVG on purpose — tokens.css resets descendants with all:revert,
  // and in Chrome an SVG circle's r/cx/cy are CSS properties, so an SVG ring
  // silently collapses to nothing (measured on the Steam card first).
  function levelRing(lvl, elo) {
    const box = el("div", "sr-elo-ring");
    box.style.setProperty("--lvl", LEVEL_HEX[lvl - 1]);
    let pct = 100;
    if (lvl < 10) {
      const floor = FLOORS[lvl - 1];
      const next = FLOORS[lvl];
      pct = Math.max(4, Math.min(100, Math.round(((elo - floor) / (next - floor)) * 100)));
    }
    box.style.setProperty("--pct", String(pct));
    box.append(el("div", "sr-elo-ringnum", String(lvl)));
    box.title =
      "FACEIT level " + lvl +
      (lvl < 10 ? " \u00b7 " + pct + "% of the way to level " + (lvl + 1) : " \u00b7 top of the ladder");
    return box;
  }

  function renderCard(target, user, rows, cm) {
    clear(target);
    const elo = Math.round(user.elo);
    const lvl = levelFor(elo);

    const card = el("div", "sr-elo-widget");

    // Hero: the ring is the anchor, exactly as on the Steam card — one visual
    // language across every surface the extension touches.
    const top = el("div", "sr-elo-top");
    top.append(levelRing(lvl, elo));
    const main = el("div", "sr-elo-main");
    const eloLine = el("div", "sr-elo-cur");
    eloLine.append(
      document.createTextNode(elo.toLocaleString("en-US")),
      el("span", "sr-elo-curunit", " elo"),
    );
    main.append(eloLine);
    const heroMeta = el("div", "sr-elo-herometa");
    if (lvl < 10) {
      const next = FLOORS[lvl];
      heroMeta.append(
        document.createTextNode("Level " + lvl + " \u00b7 "),
        el("b", null, (next - elo).toLocaleString("en-US")),
        document.createTextNode(" to level " + (lvl + 1)),
      );
    } else {
      heroMeta.append(
        document.createTextNode("Level 10 \u00b7 "),
        el("b", null, "+" + (elo - FLOORS[9]).toLocaleString("en-US")),
        document.createTextNode(" above the " + FLOORS[9].toLocaleString("en-US") + " floor"),
      );
    }
    main.append(heroMeta);
    const todayBox = el("div", "sr-elo-today");
    const t = todayDelta(rows);
    const tEl = el(
      "div",
      "sr-elo-delta " + (t == null ? "sr-elo-delta--none" : deltaClass(t)),
      t == null ? DASH : fmtSigned(t),
    );
    tEl.title = t == null ? "No elo change posted today" : "Net elo change today";
    todayBox.append(el("div", "sr-label", "Today"), tEl);
    top.append(main, todayBox);
    card.append(top);

    // Everything the CheatMeter lookup already knows, stated once at the top:
    // the two ranks, the risk read, and the way through to the full profile.
    const st = (cm && cm.stats) || {};
    const chips = el("div", "sr-p-chips");
    if (cm && typeof cm.premier === "number" && cm.premier > 0) {
      const pr = el("span", "sr-p-chip sr-p-chip--prem");
      pr.append(el("span", "sr-p-chipk", "premier"), el("span", "sr-p-chipv", cm.premier.toLocaleString("en-US")));
      pr.title = "CS2 Premier rating";
      chips.append(pr);
    }
    if (cm && cm.banned) {
      const b = el("span", "sr-p-chip sr-p-chip--ban");
      b.append(el("span", "sr-p-chipk", "ban"), el("span", "sr-p-chipv", "VAC"));
      b.title = "VAC or game ban on record";
      chips.append(b);
    } else if (cm && cm.cheat) {
      const c = el("span", "sr-p-chip sr-p-chip--cm");
      c.append(el("span", "sr-p-chipk", "risk"), el("span", "sr-p-chipv", cm.cheat.score + "%"));
      c.style.setProperty("--sr-cm", bandHex(cm.cheat.band));
      c.title = "CheatMeter " + cm.cheat.score + "% (" + cm.cheat.band + ")";
      chips.append(c);
    }
    const site = el("a", "sr-p-chip sr-p-chip--site");
    site.href = (cm && cm.profileUrl) || "https://csrun.win";
    site.target = "_blank";
    site.rel = "noopener noreferrer";
    site.append(el("span", "sr-p-chipv", "Full profile on CSRun"), el("span", "sr-p-arrow", "\u2197"));
    site.title = "Open this player's full CSRun profile";
    chips.append(site);
    card.append(chips);


    // Three views rather than one long scroll: the numbers you glance at, the
    // maps you act on, and the match list. Only the first is drawn up front.
    const tabs = el("div", "sr-p-tabs");
    const panel = el("div", "sr-p-panel");
    const VIEWS = [
      ["overview", "Overview"],
      ["maps", "Maps"],
      ["matches", "Matches"],
    ];
    const btns = {};

    function matchList() {
      const list = el("div", "sr-elo-list");
      if (Array.isArray(rows) && rows.length) {
        const head = el("div", "sr-elo-row sr-elo-row--head");
        head.append(
          el("span"),
          el("span", "sr-label", "Map"),
          el("span", "sr-label sr-elo-kd", "K" + NDASH + "D"),
          el("span", "sr-label sr-elo-when", "When"),
          el("span", "sr-label sr-elo-rowdelta", "Elo"),
        );
        list.append(head);
        const box = el("div", "sr-elo-rows");
        rows.slice(0, LIST_N).forEach((r) => box.append(rowEl(r)));
        list.append(box);
      } else {
        list.append(el("div", "sr-elo-empty", "No data yet"));
      }
      return list;
    }

    function overview() {
      const wrap = el("div");
      const chart = eloChart(rows);
      if (chart) wrap.append(chart);

      // The headline numbers. Sourced from the same aggregate the match room
      // uses, so a player reads the same figures in both places.
      // Seeded with the elo they are carrying RIGHT NOW: history rows record
      // elo after each match and FACEIT lags the newest ones, so a fresh climb
      // could otherwise print a "peak" below the number at the top of the card.
      let peakElo = elo;
      for (const r of rows || []) {
        if (r && typeof r.elo === "number" && isFinite(r.elo) && r.elo > peakElo) {
          peakElo = r.elo;
        }
      }
      const grid = el("div", "sr-p-grid");
      grid.append(
        statCell("rating", st.rating != null ? st.rating.toFixed(2) : null, {
          hex: gradeHex(st.rating, 1.1, 0.95),
          title: "HLTV Rating 1.0 over their last " + (st.recentMatches || "few") + " matches",
        }),
        statCell("ADR", st.adr != null ? Math.round(st.adr) : null, {
          hex: gradeHex(st.adr, 85, 65),
          title: "Average damage per round",
        }),
        statCell("K/R", st.kr != null ? st.kr.toFixed(2) : null, { title: "Kills per round" }),
        statCell("K/D", st.kd != null ? st.kd.toFixed(2) : null, {
          hex: gradeHex(st.kd, 1.15, 0.9),
          title: "Kills / deaths, all time",
        }),
        statCell("HS", st.hsPct != null ? Math.round(st.hsPct) + "%" : null, { title: "Headshot percentage" }),
        statCell("win", st.winRatePct != null ? Math.round(st.winRatePct) + "%" : null, {
          hex: gradeHex(st.winRatePct, 55, 45),
          title: "Win rate, all time",
        }),
        // FACEIT prints match counts all over its own pages; it shows peak elo
        // nowhere, which is exactly why people screenshot it.
        statCell("peak elo", peakElo != null ? peakElo.toLocaleString("en-US") : null, {
          hex: "var(--sr-orange)",
          title: "Highest elo they have held across their last " + ((rows && rows.length) || 0) + " rated matches, including today",
        }),
        statCell("swing", st.swing != null ? (st.swing >= 0 ? "+" : "") + st.swing.toFixed(2) + "%" : null, {
          hex: st.swing == null ? null : st.swing >= 0 ? "var(--sr-good)" : "var(--sr-bad)",
          title: "Leetify rating — how much better or worse than an average player they made each round",
        }),
      );
      wrap.append(grid);

      const bars = skillBars(st);
      if (bars) wrap.append(bars);
      const ins = insights(rows, st);
      if (ins) wrap.append(ins);
      // Aim and duel detail. This was a single 10px line wrapped tight against
      // the left edge — the numbers were the hardest thing on the card to read
      // and half the width sat empty. Same value-over-label grid as the row
      // above, so it scans the same way and uses the space it has.
      const AIM = [
        ["preaim", st.preaim, (v) => v.toFixed(1) + "\u00b0", "Where the crosshair sits before a duel — lower is better"],
        ["reaction", st.reactionMs, (v) => Math.round(v) + "ms", "Time to react once an enemy is visible — lower is better"],
        ["spray", st.sprayAccuracy, (v) => Math.round(v) + "%", "Accuracy while spraying"],
        ["open CT", st.openingCt, (v) => Math.round(v) + "%", "Opening duels won on CT"],
        ["open T", st.openingT, (v) => Math.round(v) + "%", "Opening duels won on T"],
        ["traded", st.tradedDeaths, (v) => Math.round(v) + "%", "Deaths that a teammate traded back"],
        ["clutch", st.clutch, (v) => (v * 100).toFixed(1) + "%", "Leetify clutch rating — rounds won from a losing position"],
      ].filter(([, v]) => typeof v === "number" && isFinite(v));

      if (AIM.length) {
        const sec = el("div", "sr-p-sec");
        sec.append(el("div", "sr-label", "Aim & duels · Leetify"));
        const grid = el("div", "sr-p-grid sr-p-grid--fine");
        for (const [label, v, fmt, title] of AIM) {
          grid.append(statCell(label, fmt(v), { title }));
        }
        sec.append(grid);
        wrap.append(sec);
      }
      return wrap;
    }

    function draw(view) {
      clear(panel);
      for (const k in btns) btns[k].classList.toggle("sr-p-tab--on", k === view);
      panel.append(view === "maps" ? mapTable(rows) : view === "matches" ? matchList() : overview());
    }

    for (const [key, label] of VIEWS) {
      const b = el("button", "sr-p-tab", label);
      b.type = "button";
      b.addEventListener("click", () => draw(key));
      btns[key] = b;
      tabs.append(b);
    }
    card.append(tabs, panel);
    draw("overview");

    // Attribution: this card appears unannounced on someone's own profile, so
    // it says who put it there — matching the match-room and Steam surfaces.
    const foot = el("div", "sr-elo-foot");
    const mark = el("a", "sr-elo-wordmark");
    mark.href = "https://csrun.win";
    mark.target = "_blank";
    mark.rel = "noreferrer";
    mark.append(document.createTextNode("CS"));
    const markB = el("b", null, "Run");
    mark.append(markB);
    foot.append(mark, el("span", "sr-label", "Source · FACEIT"));
    card.append(foot);

    target.append(card);
  }

  // Skeleton → fetch → card. Returns false when there is nothing to show
  // (the caller removes the mount — silent no-op).
  async function hydrate(target, nick) {
    try {
      renderSkeleton(target);
      const api = apiRef();
      if (!api || typeof api.user !== "function") return false;
      const user = await api.user(nick);
      if (!user || user.elo == null || !isFinite(Number(user.elo))) return false;
      // History and the CheatMeter aggregate in parallel — the card needs both
      // and neither depends on the other. A failed lookup is not fatal: the
      // sections it feeds simply do not render.
      const [rows, cm] = await Promise.all([
        user.uuid && typeof api.eloHistory === "function"
          ? api.eloHistory(user.uuid, HISTORY_N).catch(() => null)
          : Promise.resolve(null),
        typeof api.cheatmeter === "function"
          ? api
              .cheatmeter(user.steam64 ? { steamid: String(user.steam64) } : { faceit: nick })
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      renderCard(target, { uuid: user.uuid, elo: Number(user.elo) }, rows, cm);
      return true;
    } catch (e) {
      // A throw in here used to remove the whole card without a word — a
      // single typo made the widget simply not exist, which is indistinguish-
      // able from "this player has no data". Still non-fatal, but no longer
      // silent: anyone with the console open can see why it went.
      try {
        console.warn("[CSRun] profile card failed to render:", e);
      } catch {
        /* console unavailable */
      }
      return false;
    }
  }

  // ---- page detection + mounting ------------------------------------------

  function nickFromPath(path) {
    const m = path.match(PAGE_RE);
    if (!m) return null;
    let nick;
    try {
      nick = decodeURIComponent(m[2]).trim();
    } catch {
      return null;
    }
    if (!nick || nick.length > 64 || nick === "undefined") return null;
    return nick;
  }

  // Insert after the profile header block (the ancestor of the page's <h1>
  // that sits directly inside the main content), falling back to prepending.
  function mountPoint() {
    // Anchor to the profile's TAB STRIP (Summary / Match history / ...) and
    // sit directly above it: that strip lives in the wide content column on
    // every FACEIT profile layout, so the widget lands beside the stats it
    // describes rather than in the narrow avatar rail. Verified against the
    // live page — a #main-content-first strategy put it in the sidebar.
    const tab = [...document.querySelectorAll("a,button")].find((n) =>
      /^(summary|match history|matchmaking)$/i.test((n.textContent || "").trim()),
    );
    if (tab) {
      // Climb to the first WIDE ancestor that STACKS its children — a block,
      // grid, or column flex. Mounting inside a row-flex host shrink-wraps the
      // card (measured 163px of 957 on the live page); a column host gives it
      // the full content width without fighting FACEIT's layout.
      let node = tab;
      for (let i = 0; i < 8 && node.parentElement; i++) {
        const r = node.getBoundingClientRect();
        if (r.width > 420) {
          const cs = getComputedStyle(node);
          const stacks =
            cs.display === "block" ||
            cs.display === "grid" ||
            ((cs.display === "flex" || cs.display === "inline-flex") &&
              cs.flexDirection.startsWith("column"));
          if (stacks) return { parent: node, before: node.firstElementChild };
        }
        node = node.parentElement;
      }
    }
    // fallbacks: the widest content host we can identify, else the h1's row
    const main =
      document.querySelector("#main-content") ||
      document.querySelector("main") ||
      document.querySelector('[id^="canvas-body"]');
    const h1 = (main || document).querySelector("h1");
    if (main && h1) {
      let node = h1;
      while (node.parentElement && node.parentElement !== main) node = node.parentElement;
      if (node.parentElement === main) return { parent: main, after: node };
    }
    if (h1 && h1.parentElement) return { parent: h1.parentElement, after: h1 };
    if (main) return { parent: main, after: null };
    return null;
  }

  async function tryMount(nick) {
    if (mounting) return;
    const spot = mountPoint();
    if (!spot) return; // SPA still rendering — the observer retries
    mounting = true;
    try {
      ensureStyles();
      const r = el("div", "sr-elo-root");
      r.id = "statrun-profile";
      r.dataset.srNick = nick;
      if (spot.before) spot.parent.insertBefore(r, spot.before);
      else if (spot.after) spot.after.insertAdjacentElement("afterend", r);
      else spot.parent.prepend(r);
      root = r;
      const ok = await hydrate(r, nick);
      if (!ok) {
        failed.set(nick.toLowerCase(), Date.now());
        r.remove();
        if (root === r) root = null;
      }
    } finally {
      mounting = false;
      // If navigation happened while we were fetching, catch up.
      if (currentNick && currentNick !== nick) schedule();
    }
  }

  function unmount() {
    if (root) {
      root.remove();
      root = null;
    }
    const stray = document.getElementById("statrun-profile");
    if (stray) stray.remove();
    currentNick = null;
  }

  // The widget usually mounts before FACEIT's SPA has rendered the profile
  // tab strip, so the first mount lands on a fallback anchor — historically
  // the narrow avatar rail. Once the strip exists, move the node (a move
  // keeps its already-fetched contents; nothing refetches).
  function relocate() {
    if (!root || !root.isConnected) return;
    const spot = mountPoint();
    if (!spot || !spot.before || !spot.parent) return;
    if (root.parentElement === spot.parent && root.nextElementSibling === spot.before) return;
    if (root.contains(spot.parent) || root === spot.before) return;
    spot.parent.insertBefore(root, spot.before);
  }

  function checkPage() {
    const nick = nickFromPath(location.pathname);
    if (!nick) {
      unmount();
      return;
    }
    if (recentlyFailed(nick)) return;
    if (root && root.isConnected && root.dataset.srNick === nick) {
      relocate(); // the SPA may have rendered a better host since we mounted
      return;
    }
    const existing = document.getElementById("statrun-profile");
    if (existing && existing.isConnected && existing.dataset.srNick === nick) {
      root = existing;
      currentNick = nick;
      return;
    }
    if (currentNick !== nick) unmount();
    currentNick = nick;
    void tryMount(nick);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      checkPage();
    }, DEBOUNCE_MS); // debounce SPA churn (≥300ms per contract)
  }

  function setActive(on) {
    if (on && !observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("popstate", schedule);
      checkPage();
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
      window.removeEventListener("popstate", schedule);
      unmount();
    }
  }

  async function init() {
    setActive(featureOn(await readSettings()));
    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== "sync") return;
        if (!("enabled" in changes) && !("feature.profile" in changes)) return;
        setActive(featureOn(await readSettings()));
      });
    } catch {
      /* no chrome.* outside the extension (dev fixture) — display defaults on */
    }
  }

  init();

  // Dev-harness hook (dev/profile.html): render through the exact same
  // hydrate/render path, into a supplied container. Inert on faceit.com.
  window.__srProfileMount = async function (host, nick) {
    ensureStyles();
    const r = el("div", "sr-elo-root");
    host.appendChild(r);
    const ok = await hydrate(r, nick);
    if (!ok) r.remove();
    return r;
  };
})();
