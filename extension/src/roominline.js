// Inline match-room stats: a compact strip attached directly beneath each of
// FACEIT's OWN player cards, so a player's numbers sit where you are already
// looking instead of in a separate table you have to cross-reference.
//
// Anchoring is deliberately NOT class-based. FACEIT ships styled-components
// hashes (styles__Foo-sc-1fbfad92-7) that change on every deploy; matching
// them would break weekly. Instead we resolve each roster nickname from the
// match API and find the DOM node whose own text IS that nickname, then walk
// up to the smallest ancestor that looks like a card. Nicknames are the one
// thing the page and the API agree on.
//
// Data comes from SRApi only. Every failure is a silent no-op.

(function () {
  "use strict";

  const ROOM_RE = /\/cs2\/room\/([^/?#]+)/i;
  const MARK = "data-sr-inline"; // on the strip
  const OWNER = "data-sr-owner"; // on the host card
  const HIST_N = 30;
  const DEBOUNCE_MS = 400;

  const DASH = "—";
  const state = { id: null, gen: 0, timer: null, obs: null };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function api() {
    return typeof SRApi !== "undefined" && SRApi ? SRApi : window.SRApi || null;
  }

  async function allowed() {
    try {
      if (typeof SRSettings === "undefined" || !SRSettings || typeof SRSettings.get !== "function") return true;
      const s = await SRSettings.get();
      if (!s) return true;
      return s.enabled !== false && s["feature.matchroom"] !== false;
    } catch {
      return true;
    }
  }

  // ---- host lookup --------------------------------------------------------

  // The node whose OWN text is exactly this nickname (ignoring nodes that
  // merely contain it, so a chat line mentioning the name never wins).
  function nodeForNick(nick) {
    const want = nick.trim().toLowerCase();
    if (!want) return null;
    // Prefer a profile link — that is unambiguously the player.
    const links = document.querySelectorAll('a[href*="/players/"]');
    for (const a of links) {
      const t = (a.textContent || "").trim().toLowerCase();
      if (t === want && a.offsetParent !== null) return a;
    }
    // Fall back to any small element whose text is exactly the nickname.
    const all = document.querySelectorAll("span,div,p,h1,h2,h3,h4,strong,b");
    for (const n of all) {
      if (n.children.length > 2) continue;
      const t = (n.textContent || "").trim().toLowerCase();
      if (t === want && n.offsetParent !== null) return n;
    }
    return null;
  }

  // Walk up from the name to the card that holds it: the first ancestor that
  // is meaningfully wider/taller than the name itself, capped so we never
  // escape into the whole roster column.
  function cardFor(node) {
    let n = node;
    const nameRect = node.getBoundingClientRect();
    for (let i = 0; i < 6 && n && n.parentElement; i++) {
      const p = n.parentElement;
      const r = p.getBoundingClientRect();
      if (r.height > nameRect.height * 6 || r.width > nameRect.width * 6) break;
      n = p;
      if (r.height >= 40 && r.width >= 140) return n;
    }
    return n && n !== node ? n : node.parentElement || node;
  }

  // ---- the strip ----------------------------------------------------------

  function stat(label, value, cls, title) {
    const s = el("span", "sr-in-stat" + (cls ? " " + cls : ""));
    s.append(el("span", "sr-in-k", label), el("span", "sr-in-v", value));
    if (title) s.title = title;
    return s;
  }

  function skeletonStrip() {
    const strip = el("div", "sr-reset sr-in");
    strip.setAttribute(MARK, "1");
    for (let i = 0; i < 4; i++) strip.append(el("span", "sr-skel sr-in-skel"));
    return strip;
  }

  function fillStrip(strip, p, form, cm) {
    strip.textContent = "";

    if (typeof p.level === "number" && p.level > 0) {
      const lv = el("span", "sr-in-lvl sr-lvl sr-lvl-" + p.level, String(p.level));
      lv.title = "FACEIT level " + p.level;
      strip.append(lv);
    }
    if (typeof p.elo === "number" && p.elo > 0) {
      strip.append(stat("elo", p.elo.toLocaleString("en-US"), "sr-in-elo", "Current FACEIT elo"));
    }
    if (form) {
      strip.append(
        stat("K/D", form.kd.toFixed(2), null, "K/D over the last " + form.matches + " matches"),
        stat("WR", Math.round(form.wr) + "%", null, "Win rate over the last " + form.matches + " matches"),
      );
      const st = el("span", "sr-in-streak " + (form.won ? "sr-in-streak--w" : "sr-in-streak--l"), form.streak);
      st.title = (form.won ? "Winning" : "Losing") + " streak";
      strip.append(st);
    } else {
      strip.append(stat("K/D", DASH), stat("WR", DASH));
    }

    if (cm && cm.banned) {
      const b = el("span", "sr-in-ban", "BAN");
      b.title = "VAC or game ban on record";
      b.setAttribute("aria-label", b.title);
      strip.append(b);
    } else if (cm && cm.cheat) {
      const c = el("span", "sr-in-cm", String(cm.cheat.score));
      c.style.setProperty("--sr-cm", bandHex(cm.cheat.band));
      c.title = "CheatMeter " + cm.cheat.score + "% (" + cm.cheat.band + ")";
      c.setAttribute("aria-label", c.title);
      if (cm.cheat.lowConfidence) c.classList.add("sr-in-cm--dim");
      strip.append(c);
    }
    if (cm && typeof cm.premier === "number" && cm.premier > 0) {
      const pr = el("span", "sr-in-prem", cm.premier.toLocaleString("en-US"));
      pr.style.setProperty("--sr-tier", tierHex(cm.premier));
      pr.title = "CS2 Premier rating";
      strip.append(pr);
    }
    if (!strip.childNodes.length) strip.append(el("span", "sr-in-none", "No data"));
  }

  const TIERS = [
    [30000, "#ffd700"], [25000, "#eb4b4b"], [20000, "#d32ce6"],
    [15000, "#8847ff"], [10000, "#4b69ff"], [5000, "#5e98d9"], [0, "#b0c3d9"],
  ];
  function tierHex(r) {
    for (const [f, h] of TIERS) if (r >= f) return h;
    return "#b0c3d9";
  }
  const BAND_HEX = {
    verylow: "#46d369", low: "#8fd14f", moderate: "#f5b942",
    high: "#ff8a3d", veryhigh: "#f5694a",
  };
  function bandHex(b) {
    return BAND_HEX[b] || "#9aa7bd";
  }

  function computeForm(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let k = 0, d = 0, w = 0;
    const won = (r) => r.win === true || r.win === 1 || r.win === "1";
    for (const r of rows) {
      k += r.kills || 0;
      d += r.deaths || 0;
      if (won(r)) w += 1;
    }
    const top = won(rows[0]);
    let streak = 0;
    for (const r of rows) {
      if (won(r) === top) streak += 1;
      else break;
    }
    return { kd: k / Math.max(1, d), wr: (w / rows.length) * 100, streak: (top ? "W" : "L") + streak, won: top, matches: rows.length };
  }

  // ---- attach -------------------------------------------------------------

  async function decorate(p, gen) {
    const nick = String(p.nick || "").trim();
    if (!nick) return;
    const nameNode = nodeForNick(nick);
    if (!nameNode) return; // roster not painted yet — the observer retries
    const card = cardFor(nameNode);
    if (!card || card.getAttribute(OWNER) === nick) return; // already ours

    card.setAttribute(OWNER, nick);
    const strip = skeletonStrip();
    card.insertAdjacentElement("afterend", strip);

    const A = api();
    const [rows, cm] = await Promise.all([
      p.uuid && A ? A.eloHistory(p.uuid, HIST_N).catch(() => null) : null,
      p.steam64 && A ? A.cheatmeter({ steamid: p.steam64 }).catch(() => null) : null,
    ]);
    if (gen !== state.gen || !strip.isConnected) return;
    fillStrip(strip, p, computeForm(rows), cm);
  }

  function clearAll() {
    document.querySelectorAll("[" + MARK + "]").forEach((n) => n.remove());
    document.querySelectorAll("[" + OWNER + "]").forEach((n) => n.removeAttribute(OWNER));
  }

  async function run(id) {
    const gen = ++state.gen;
    const A = api();
    if (!A || !(await allowed())) return;
    const room = await A.room(id).catch(() => null);
    if (gen !== state.gen || !room || !Array.isArray(room.teams)) return;
    for (const team of room.teams) {
      for (const p of team.roster || []) void decorate(p, gen);
    }
  }

  // ---- routing ------------------------------------------------------------

  function roomId() {
    const m = ROOM_RE.exec(location.pathname);
    return m ? m[1] : null;
  }

  function tick() {
    const id = roomId();
    if (id !== state.id) {
      state.id = id;
      state.gen += 1;
      clearAll();
    }
    if (id) void run(id);
  }

  function schedule() {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      tick();
    }, DEBOUNCE_MS);
  }

  function init() {
    tick();
    state.obs = new MutationObserver(schedule);
    state.obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
  }

  init();
})();
