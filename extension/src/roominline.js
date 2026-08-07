// Inline match-room stats: a compact strip attached directly beneath each of
// FACEIT's OWN player cards, so a player's numbers sit where you are already
// looking instead of in a separate table you have to cross-reference.
//
// Anchoring is deliberately NOT class-based. FACEIT ships styled-components
// hashes (styles__Foo-sc-1fbfad92-7) that change on every deploy; matching
// them would break weekly. We work from profile links instead: a player card
// is the smallest ancestor of a /players/<nick> link that owns an avatar and
// sits beside other cards like it. That is stable across deploys.
//
// The roster comes from the match API when it describes the room, and from the
// page itself when it does not — a CS2 Matchmaking/Premier room is not a
// FACEIT match, so /api/match/v2 says nothing about it even though the page is
// full of players. Names on the page plus the nickname lookup carry the same
// information, so both room types are served by one path.
//
// Data comes from SRApi only. Every failure is a silent no-op.

(function () {
  "use strict";

  const ROOM_RE = /\/cs2\/room\/([^/?#]+)/i;
  const MARK = "data-sr-inline"; // on the strip
  const OWNER = "data-sr-owner"; // on the host card
  const HIST_N = 30;
  const MAX_ROSTER = 20; // two teams of five, with headroom — never a leaderboard
  const DEBOUNCE_MS = 400;

  const DASH = "—";
  // undos[] holds one restore fn per attached strip. placeInside writes inline
  // position/padding onto FACEIT's own card, so simply deleting our strips on
  // room change would leave that styling behind on their node.
  const state = { id: null, gen: 0, timer: null, obs: null, undos: [] };

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
  // Our own panel lists the same nicknames and sits ABOVE the roster, so an
  // unguarded search matched our rows and stapled every strip inside our own
  // card. Anything we rendered is off-limits by definition.
  function isOurs(node) {
    return !!(node.closest && node.closest("#statrun-room, [data-sr-inline], .sr-reset, .sr-mr, .sr-chip"));
  }

  function nodeForNick(nick) {
    return window.SRDom ? window.SRDom.nodeForNick(nick) : null;
  }

  // Delegates to SRDom: a card is the smallest box holding exactly one roster
  // name and sitting beside boxes holding the others. The old rule here wanted
  // an <img> avatar and a /players/ link inside the card, and a Premier room's
  // cards have decorative avatar frames and unlinked names — so it matched
  // nothing and no strip was ever drawn on one.
  function cardFor(node, all) {
    return window.SRDom ? window.SRDom.cardFor(node, all) : null;
  }

  // ---- attaching without disturbing the host ------------------------------
  //
  // A live room stacks its roster vertically, so a sibling inserted after a
  // card simply reflows below it. A FINISHED room lays the same roster out
  // HORIZONTALLY — and there a sibling becomes a peer column: it takes a share
  // of the row's width, stretches to the row's height, and squeezes the real
  // cards down to a sliver. That is what turned the scoreboard into a set of
  // black columns.
  //
  // So the mode is measured, never assumed, and whichever mode we pick is
  // checked against an invariant that holds for both: annotating a card must
  // not change any card's WIDTH. If it did, we put the page back.

  // Only "true" licenses a sibling insert, so every uncertain case answers
  // false and takes the placeInside route, which cannot disturb a row.
  function laysOutVertically(box) {
    if (!box) return false;
    const cs = getComputedStyle(box);
    const d = cs.display;
    if (d === "flex" || d === "inline-flex") {
      // column-reverse stacks upwards, so "after the card" would render ABOVE
      // it — correct by the width invariant but wrong to the eye.
      return cs.flexDirection === "column";
    }
    if (d === "grid" || d === "inline-grid") {
      // A grid with no explicit columns still flows horizontally when
      // grid-auto-flow is column — "none" does not mean one column.
      if (cs.gridAutoFlow.indexOf("column") === 0) return false;
      const t = cs.gridTemplateColumns;
      return !t || t === "none" || t.trim().split(/\s+/).length <= 1;
    }
    // A table row lays its cells out across; every other table box stacks.
    if (d === "table-row") return false;
    // display:contents has no box of its own — the real parent is further up.
    if (d === "contents" || d.indexOf("inline") === 0) return false;
    return true; // block, flow-root, list-item, table, table-cell, …
  }

  // Sibling directly after the card. Correct wherever the flow is vertical.
  // Clears anything a rejected placeInside attempt left on the strip.
  function placeAfter(card, strip) {
    strip.style.position = "";
    strip.style.left = "";
    strip.style.right = "";
    strip.style.bottom = "";
    strip.style.margin = "";
    card.insertAdjacentElement("afterend", strip);
    return () => strip.remove();
  }

  // Does the strip sit on top of the card's own avatar/nickname? This is the
  // question both the initial placement and the post-data re-check care about.
  // (In sibling mode the strip is not a child of the card, so the card's own
  // content always ends above it and this is trivially false.)
  function overlapsContent(card, strip) {
    let bottom = 0;
    for (const c of card.children) {
      if (c === strip || isOurs(c)) continue;
      const b2 = c.getBoundingClientRect().bottom;
      if (b2 > bottom) bottom = b2;
    }
    return !!bottom && strip.getBoundingClientRect().top < bottom - 1;
  }

  // Re-measure hooks, one per attached strip. The strip is attached holding a
  // placeholder and refilled when the requests land, and the refilled strip is
  // taller — in a narrow card it wraps to a second line. Reserving the card's
  // padding once, against the placeholder, left that second line to grow
  // UPWARD (the strip is anchored to the card's bottom edge) straight over the
  // player's avatar and name.
  const resettle = new WeakMap();
  // strip -> re-establish the layout guarantees after its content changed
  const settle = new WeakMap();

  // Inside the card, taken out of flow and given room by the card's own
  // padding. Absolute positioning is the point: an out-of-flow child cannot
  // contribute to its parent's intrinsic width, so a row of cards cannot be
  // re-proportioned by anything we add. The padding reserves exactly the
  // height we need, so nothing is overlapped either.
  function placeInside(card, strip) {
    const cs = getComputedStyle(card);
    const prevPos = card.style.position;
    const prevPad = card.style.paddingBottom;
    const basePad = parseFloat(cs.paddingBottom) || 0;
    const h0 = card.getBoundingClientRect().height;

    if (cs.position === "static") card.style.position = "relative";
    // FACEIT sometimes makes the whole card one anchor. Sitting inside it, our
    // strip would navigate to the player's profile on any click — including the
    // click that is only trying to read a tooltip.
    if (card.closest("a[href]")) {
      strip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
    strip.style.position = "absolute";
    strip.style.left = "0";
    strip.style.right = "0";
    strip.style.bottom = "0";
    strip.style.margin = "0";
    card.appendChild(strip);

    const sh = strip.getBoundingClientRect().height;
    const undo = () => {
      strip.remove();
      card.style.position = prevPos;
      card.style.paddingBottom = prevPad;
    };
    if (!sh) {
      undo();
      return null;
    }

    // Reserve room for whatever the strip currently is. Re-runnable, because
    // what the strip is changes when the requests land.
    const reserve = () => {
      card.style.paddingBottom = basePad + strip.getBoundingClientRect().height + 4 + "px";
    };
    reserve();
    resettle.set(strip, reserve);

    // The thing that actually matters is that we did not land on top of the
    // card's own content. Testing that the card grew by the strip's height
    // looked equivalent but is not: under `align-items: stretch` the first
    // decorated card raises the whole row, so every later card is already tall
    // enough and appears not to have grown — which rejected every player after
    // the first. Ask the real question instead.
    if (overlapsContent(card, strip)) {
      undo();
      return null;
    }
    return undo;
  }

  // Widths of the card and everything beside it — the thing that must not move.
  // Our own strip is skipped: in sibling mode it joins this very list, and
  // counting it made the "did anything move?" check fail on a layout that was
  // in fact perfectly fine.
  function widths(card) {
    const p = card.parentElement;
    const kids = p ? p.children : [card];
    const out = [];
    for (const k of kids) {
      if (!isOurs(k)) out.push(Math.round(k.getBoundingClientRect().width));
    }
    return out;
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1) return false;
    return true;
  }

  // Try the mode that suits the measured layout, then the other one, and if
  // both move the page, attach nothing at all. A missing strip is a far
  // smaller failure than a broken match room.
  function attach(card, strip) {
    const order = laysOutVertically(card.parentElement)
      ? [placeAfter, placeInside]
      : [placeInside, placeAfter];
    for (const place of order) {
      const before = widths(card);
      const undo = place(card, strip);
      if (!undo) continue;
      if (same(before, widths(card)) && strip.getBoundingClientRect().height > 0) {
        state.undos.push(undo);
        // Everything above was measured against the placeholder. Once the real
        // numbers arrive the strip changes size, so both guarantees have to be
        // re-established — and if they cannot be, the strip goes rather than
        // sitting on top of the card it was meant to annotate.
        settle.set(strip, () => {
          const re = resettle.get(strip);
          if (re) re();
          if (!same(before, widths(card)) || overlapsContent(card, strip)) {
            undo();
            settle.delete(strip);
            const i = state.undos.indexOf(undo);
            if (i >= 0) state.undos.splice(i, 1);
          }
        });
        return true;
      }
      undo();
    }
    return false;
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

  // A finished room's cards are a third the width of a live room's, and the
  // full strip wraps to four lines inside one — which doubles the card's
  // height and reads as a mess. The strip is measured against the card it is
  // annotating and drops to a denser form rather than overflowing it.
  function density(w) {
    if (!w || w >= 240) return "";
    return w < 150 ? " sr-in--micro" : " sr-in--tight";
  }

  // Everything the strip knows, in one sentence — so the denser forms hide
  // presentation, never information.
  function summary(p, form, cm) {
    const bits = [];
    if (p.level > 0) bits.push("FACEIT level " + p.level);
    if (p.elo > 0) bits.push(p.elo.toLocaleString("en-US") + " elo");
    if (form) {
      bits.push("K/D " + form.kd.toFixed(2));
      bits.push(Math.round(form.wr) + "% win rate");
      bits.push((form.won ? "won " : "lost ") + form.streak.slice(1) + " in a row");
      bits.push("last " + form.matches + " matches");
    }
    if (cm && cm.banned) bits.push("VAC or game ban on record");
    else if (cm && cm.cheat) bits.push("CheatMeter " + cm.cheat.score + "% (" + cm.cheat.band + ")");
    if (cm && cm.premier > 0) bits.push("Premier " + cm.premier.toLocaleString("en-US"));
    return bits.join(" · ");
  }

  function fillStrip(strip, p, form, cm, pending, cardW) {
    strip.textContent = "";
    strip.className = "sr-reset sr-in" + density(cardW);
    const micro = / sr-in--micro/.test(strip.className);
    strip.title = summary(p, form, cm);

    if (typeof p.level === "number" && p.level > 0) {
      const lv = el("span", "sr-in-lvl sr-lvl sr-lvl-" + p.level, String(p.level));
      lv.title = "FACEIT level " + p.level;
      strip.append(lv);
    }
    if (typeof p.elo === "number" && p.elo > 0) {
      strip.append(stat("elo", p.elo.toLocaleString("en-US"), "sr-in-elo", "Current FACEIT elo"));
    }
    if (form) {
      strip.append(stat("K/D", form.kd.toFixed(2), null, "K/D over the last " + form.matches + " matches"));
      if (!micro) {
        strip.append(stat("WR", Math.round(form.wr) + "%", null, "Win rate over the last " + form.matches + " matches"));
        const st = el("span", "sr-in-streak " + (form.won ? "sr-in-streak--w" : "sr-in-streak--l"), form.streak);
        st.title = (form.won ? "Winning" : "Losing") + " streak";
        strip.append(st);
      }
    } else if (pending) {
      strip.append(el("span", "sr-skel sr-in-skel"));
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
    if (!micro && cm && typeof cm.premier === "number" && cm.premier > 0) {
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

  // Is this strip still attached to something that looks like a player card?
  function anchored(strip) {
    const host = strip.parentElement;
    if (!host) return false;
    const near = strip.previousElementSibling;
    if (near && near.querySelector && near.querySelector("img")) return true; // placeAfter
    return !!(host.querySelector && host.querySelector("img")); // placeInside
  }

  async function decorate(p, gen, all) {
    const nick = String(p.nick || "").trim();
    if (!nick) return;
    // One strip per player, document-wide: cardFor can resolve differently as
    // the SPA re-renders, and without this each pass added another copy.
    // A strip whose card React has since replaced is an orphan, though — it
    // would otherwise block its own replacement and sit there stale for ever.
    const existing = document.querySelector('[' + OWNER + '="' + cssEscape(nick) + '"]');
    if (existing) {
      if (existing.isConnected && anchored(existing)) return;
      existing.remove();
    }

    // A DOM-derived entry already carries the exact node it came from, which
    // is better than searching for it again: FACEIT's displayed name and the
    // nickname in the profile URL are not always the same string.
    const nameNode = (p.node && p.node.isConnected && p.node) || nodeForNick(nick);
    if (!nameNode) return; // roster not painted yet — the observer retries
    const card = cardFor(nameNode, all);
    if (!card) return;

    const strip = el("div", "sr-reset sr-in");
    strip.setAttribute(MARK, "1");
    strip.setAttribute(OWNER, nick);

    // Draw immediately from the roster — level and elo arrive with the match
    // payload, so there is no reason to show a spinner for them. Anything
    // slower fills in behind, and a stalled request degrades to what we
    // already drew instead of a strip of grey boxes.
    // Filled BEFORE attaching so the layout check below measures real content
    // and the strip's real height, not an empty box.
    const cardW = card.getBoundingClientRect().width;
    fillStrip(strip, p, null, null, true, cardW);
    if (!attach(card, strip)) return;

    const A = api();
    if (!A) return;
    let form = null;
    let cm = null;
    const paint = () => {
      if (gen === state.gen && strip.isConnected) {
        fillStrip(strip, p, form, cm, false, card.getBoundingClientRect().width);
        // The strip just changed size. Re-reserve the room it needs and
        // re-check that it still disturbs nothing.
        const s = settle.get(strip);
        if (s) s();
      }
    };
    // A roster read off the page is only a list of names. Everything else —
    // uuid, elo, level, steam id — comes from the nickname lookup, the same
    // endpoint the profile widget uses.
    if (!p.uuid) {
      const who = await A.user(nick).catch(() => null);
      if (gen !== state.gen || !strip.isConnected) return;
      if (who) {
        p = Object.assign({}, p, {
          uuid: who.uuid,
          steam64: p.steam64 || who.steam64,
          elo: p.elo != null ? p.elo : who.elo,
          level: p.level != null ? p.level : who.level,
        });
        paint();
      }
    }

    const jobs = [];
    if (p.uuid) {
      jobs.push(
        A.eloHistory(p.uuid, HIST_N)
          .then((rows) => {
            form = computeForm(rows);
            paint();
          })
          .catch(() => {}),
      );
    }
    if (p.steam64 || nick) {
      jobs.push(
        A.cheatmeter(p.steam64 ? { steamid: String(p.steam64) } : { faceit: nick })
          .then((d) => {
            cm = d;
            paint();
          })
          .catch(() => {}),
      );
    }
    await Promise.allSettled(jobs);
    paint();
  }

  // Attribute-selector-safe nickname (nicks contain quotes, brackets, dots).
  function cssEscape(v) {
    return String(v).replace(/["\\]/g, "\\$&");
  }

  function clearAll() {
    // Restore first — each undo removes its own strip AND unwinds the inline
    // styles we put on FACEIT's card.
    const undos = state.undos;
    state.undos = [];
    for (const u of undos) {
      try { u(); } catch { /* node already gone with a React re-render */ }
    }
    document.querySelectorAll("[" + MARK + "]").forEach((n) => n.remove());
    document.querySelectorAll("[" + OWNER + "]").forEach((n) => n.removeAttribute(OWNER));
  }

  async function run(id) {
    // The generation marks WHICH ROOM the in-flight requests belong to, and it
    // is bumped in tick() when that changes — never here. It used to increment
    // per scan, and since our own strips are DOM mutations that schedule the
    // next scan, every pass invalidated the previous pass's pending requests:
    // the strips painted level and elo and then sat on skeletons forever.
    const gen = state.gen;
    const A = api();
    if (!A || !(await allowed())) return;
    const room = await A.room(id).catch(() => null);
    if (gen !== state.gen) return;

    let roster = [];
    if (room && Array.isArray(room.teams)) {
      for (const team of room.teams) {
        for (const p of team.roster || []) if (p && p.nick) roster.push(p);
      }
    }
    // A Matchmaking room is not a FACEIT match, and /api/match/v2 does not
    // describe one — which is why no strip ever appeared on a Premier room
    // even though the page is full of players. The page itself is the more
    // reliable source: every player on it links to their own profile, and the
    // nickname lookup fills in everything the match payload would have.
    if (!roster.length) roster = domRoster();

    // Resolve every roster name on the page FIRST. Knowing where all ten sit
    // is what lets cardFor tell a card from the roster around it without
    // depending on an avatar image or a profile link, neither of which a
    // Premier room reliably has.
    const dom = window.SRDom || null;
    const nodes = dom ? dom.nameNodes(roster.map((r) => r.nick)) : new Map();
    const all = [...nodes.values()];

    for (const p of roster) {
      void decorate(Object.assign({}, p, { node: p.node || nodes.get(p.nick) || null }), gen, all);
    }
  }

  // Players named by the page, in DOM order, each paired with the node it was
  // read from. A link only counts when it sits in something card-shaped, which
  // keeps chat mentions and navigation out.
  function domRoster() {
    const found = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/players/"]')) {
      if (found.length >= MAX_ROSTER) break;
      if (isOurs(a) || a.offsetParent === null) continue;
      const m = /\/players\/([^/?#]+)/.exec(a.getAttribute("href") || "");
      if (!m) continue;
      let nick;
      try {
        nick = decodeURIComponent(m[1]);
      } catch {
        nick = m[1];
      }
      const key = nick.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ nick, node: a });
    }
    // The card test needs to see every candidate at once — that is how it
    // tells one player's card from the roster holding all of them — so it can
    // only run once the whole list is collected.
    const all = found.map((f) => f.node);
    return found.filter((f) => cardFor(f.node, all));
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

  // Our own strips are DOM mutations. Reacting to them re-scans the page for
  // ever, so anything we authored is not a reason to look again.
  function foreign(records) {
    for (const r of records) {
      if (r.target && isOurs(r.target)) continue;
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && !isOurs(n)) return true;
      }
      if (r.removedNodes.length) return true;
    }
    return false;
  }

  function init() {
    tick();
    state.obs = new MutationObserver((records) => {
      if (foreign(records)) schedule();
    });
    state.obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);

    // The density class and the padding that reserves the strip's height are
    // both measured against the card's width at attach time. A resize changes
    // that width, so the only honest response is to put the cards back and
    // measure again.
    let rtimer = null;
    window.addEventListener(
      "resize",
      () => {
        if (rtimer) clearTimeout(rtimer);
        rtimer = setTimeout(() => {
          rtimer = null;
          clearAll();
          tick();
        }, 250);
      },
      { passive: true },
    );
  }

  init();
})();
