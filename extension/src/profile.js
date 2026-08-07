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
  const HISTORY_N = 30; // fetch enough to cover "today" reliably
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
    ".sr-elo-widget{box-sizing:border-box;background:var(--sr-panel);border:1px solid var(--sr-line);border-radius:var(--sr-r-card);padding:12px;color:var(--sr-ink);font:400 11px/1.35 var(--sr-font);}",
    ".sr-elo-widget *{box-sizing:border-box;}",
    ".sr-elo-top{display:flex;align-items:center;gap:8px;}",
    ".sr-elo-lvl{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--sr-r-chip);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;}",
    ".sr-elo-main{min-width:0;}",
    ".sr-elo-cur{margin-top:2px;font-size:13px;font-weight:700;line-height:1;color:var(--sr-orange);font-variant-numeric:tabular-nums;}",
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
    ".sr-elo-rows{margin-top:4px;}",
    ".sr-elo-row{display:grid;grid-template-columns:12px minmax(0,1fr) 52px 44px;align-items:center;gap:8px;height:24px;padding:0 4px;margin:0 -4px;border-radius:var(--sr-r-chip);font-size:11px;color:var(--sr-ink);text-decoration:none;}",
    "a.sr-elo-row{cursor:pointer;transition:background-color 120ms ease-out;}",
    "a.sr-elo-row:hover{background:var(--sr-panel2);}",
    "a.sr-elo-row:focus-visible{outline:2px solid var(--sr-brand);outline-offset:-2px;}",
    ".sr-elo-dot{width:8px;height:8px;justify-self:center;border-radius:50%;}",
    ".sr-elo-dot--w{background:var(--sr-good);}",
    ".sr-elo-dot--l{background:var(--sr-bad);border-radius:2px;}", /* square: W/L scans without color */
    ".sr-elo-dot--u{background:transparent;border:1px solid var(--sr-line2);}",
    ".sr-elo-map{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".sr-elo-kd{text-align:right;color:var(--sr-muted);font-variant-numeric:tabular-nums;}",
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

    const d = r && typeof r.delta === "number" && isFinite(r.delta) ? r.delta : null;
    const dEl = el(
      "span",
      "sr-elo-rowdelta " + (d == null ? "sr-elo-delta--none" : deltaClass(d)),
      d == null ? DASH : fmtSigned(d),
    );
    if (d == null) dEl.title = "Elo not posted yet";

    node.append(dot, map, kd, dEl);
    return node;
  }

  function renderCard(target, user, rows) {
    clear(target);
    const elo = Math.round(user.elo);
    const lvl = levelFor(elo);

    const card = el("div", "sr-elo-widget");

    // top: level badge · elo · today's net change
    const top = el("div", "sr-elo-top");
    const badge = el("span", "sr-elo-lvl sr-lvl sr-lvl-" + lvl, String(lvl));
    badge.title = "Level " + lvl;
    const main = el("div", "sr-elo-main");
    main.append(el("div", "sr-label", "Faceit elo"), el("div", "sr-elo-cur", elo.toLocaleString("en-US")));
    const todayBox = el("div", "sr-elo-today");
    const t = todayDelta(rows);
    const tEl = el(
      "div",
      "sr-elo-delta " + (t == null ? "sr-elo-delta--none" : deltaClass(t)),
      t == null ? DASH : fmtSigned(t),
    );
    tEl.title = t == null ? "No elo change posted today" : "Net elo change today";
    todayBox.append(el("div", "sr-label", "Today"), tEl);
    top.append(badge, main, todayBox);
    card.append(top);

    const floor = FLOORS[lvl - 1];
    const next = lvl >= 10 ? null : FLOORS[lvl];
    if (next) {
      // progress toward the next level floor
      const pct = Math.max(0, Math.min(100, Math.round(((elo - floor) / (next - floor)) * 100)));
      const bar = el("div", "sr-elo-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", String(floor));
      bar.setAttribute("aria-valuemax", String(next));
      bar.setAttribute("aria-valuenow", String(elo));
      bar.setAttribute("aria-label", "Progress to level " + (lvl + 1));
      const fill = el("div", "sr-elo-bar-fill");
      fill.style.width = pct + "%";
      bar.append(fill);
      const meta = el("div", "sr-elo-bar-meta");
      meta.append(
        el("span", "sr-elo-bar-floor", floor.toLocaleString("en-US")),
        el("span", "sr-elo-bar-note", next - elo + " to level " + (lvl + 1)),
        el("span", "sr-elo-bar-next", next.toLocaleString("en-US")),
      );
      card.append(bar, meta);
    } else {
      // Level 10 has no ceiling, so a bar would be permanently full — it would
      // encode nothing for exactly the players most likely to look. State the
      // floor once and how far past it they are.
      // One left-aligned line: right-aligning the gain parks it directly under
      // the "Today" delta, where it reads as today's number.
      const meta = el("div", "sr-elo-bar-meta sr-elo-bar-meta--max");
      const line = el("span", "sr-elo-bar-floor");
      line.append(
        document.createTextNode("Level 10 floor " + floor.toLocaleString("en-US") + " · "),
        el("b", "sr-elo-max-gain", "+" + (elo - floor).toLocaleString("en-US")),
        document.createTextNode(" above"),
      );
      meta.append(line);
      card.append(meta);
    }

    // recent matches
    const list = el("div", "sr-elo-list");
    list.append(el("div", "sr-label", "Recent matches"));
    if (Array.isArray(rows) && rows.length) {
      const box = el("div", "sr-elo-rows");
      rows.slice(0, LIST_N).forEach((r) => box.append(rowEl(r)));
      list.append(box);
    } else {
      list.append(el("div", "sr-elo-empty", "No data yet"));
    }
    card.append(list);

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
      let rows = null;
      if (user.uuid && typeof api.eloHistory === "function") {
        rows = await api.eloHistory(user.uuid, HISTORY_N);
      }
      renderCard(target, { uuid: user.uuid, elo: Number(user.elo) }, rows);
      return true;
    } catch {
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
