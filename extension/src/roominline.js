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

  // Anchored to the END of the path on purpose. FACEIT's match room has tabbed
  // sub-routes, and the STATS tab renders its own full scoreboard — ours landed
  // on top of it and covered FACEIT's numbers. The bare room path is the
  // OVERVIEW tab and the pre-game lobby (map and server veto), which are the
  // two places this belongs; any sub-route is left alone.
  const ROOM_RE = /\/cs2\/room\/([^/?#]+)\/?$/i;
  const MARK = "data-sr-inline"; // on the strip
  const OWNER = "data-sr-owner"; // on the host card
  const HIST_N = 30;
  const MAX_ROSTER = 20; // two teams of five, with headroom — never a leaderboard
  const DEBOUNCE_MS = 400;

  const DASH = "—";
  // undos[] holds one restore fn per attached strip. placeInside writes inline
  // position/padding onto FACEIT's own card, so simply deleting our strips on
  // room change would leave that styling behind on their node.
  // Two players who keep turning up in each other's recent matches are queuing
  // together. That is the single most useful thing to know about a roster you
  // are about to play, and it is derivable from history we already hold.
  const SITE = "https://csrun.win";
  const MAP_MIN_SAMPLE = 4; // below this the map split is shown but not coloured
  const MAP_MIN_DELTA = 0.05; // smaller than this is noise, not an edge
  const PARTY_MIN_SHARED = 3; // shared matches in the last HIST_N to call it a party
  // Deliberately NOT from the CheatMeter band scale: an amber party tag beside
  // an amber risk chip made two unrelated things look like one. These are
  // identity hues (cool + violet), which the band scale never uses.
  const PARTY_HEX = ["var(--sr-party-1)", "var(--sr-party-2)", "var(--sr-party-3)", "var(--sr-party-4)"];

  const state = { id: null, gen: 0, timer: null, obs: null, undos: [], party: new Map(), map: null, selMap: null, cardW: null };
  // strip -> redraw it with whatever is currently known. Party tags are worked
  // out after the strips are already on the page, so they need a way back in.
  const redraws = new WeakMap();

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
        // ...except on our own link, which is the one click here that SHOULD
        // navigate. Swallowing it too made the CSRun button do nothing.
        if (e.target && e.target.closest && e.target.closest("[data-sr-link]")) {
          e.stopPropagation();
          return;
        }
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
  // Four tiers, set by the width of the card we are annotating. At the width
  // a FACEIT roster card actually is, the strip shows exactly the eight
  // numbers a competitor fits there plus elo; the extras that make CSRun worth
  // running are given the room of a wider card rather than crushed into a
  // narrow one.
  // Measured against the CARD ELEMENT we anchor to, which on FACEIT includes
  // the avatar frame beside the name — so these sit ~50px above the width of
  // the visible card body. Calibrated against real rooms and the probe matrix
  // rather than guessed: one step too generous and the chips run off the edge.
  function density(w) {
    if (!w) return "";
    if (w < 200) return " sr-in--micro";
    if (w < 300) return " sr-in--tight";
    if (w < 470) return "";
    return " sr-in--wide";
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

  // One cell of the metric grid: the number, with its name under it. Repeek
  // proved the shape scans well at a glance; the ordering here is ours — the
  // things that change your read of an opponent come first.
  function cell(label, value, opts) {
    const o = opts || {};
    const c = el("span", "sr-in-cell" + (o.cls ? " " + o.cls : ""));
    const v = el("span", "sr-in-cv", value);
    if (o.hex) v.style.color = o.hex;
    c.append(v, el("span", "sr-in-cl", label));
    c.title = o.title || label;
    return c;
  }

  function pct(v) {
    return v == null ? null : Math.round(v) + "%";
  }

  // A chip says what it is. "22" and "27,290" sitting bare next to each other
  // are unreadable without hovering both — one is a risk score out of 100 and
  // the other a Premier rating, and nothing on screen said so.
  function chip(cls, label, value, title) {
    const c = el("span", "sr-in-chip " + cls);
    c.append(el("span", "sr-in-chipk", label), el("span", "sr-in-chipv", value));
    if (title) {
      c.title = title;
      c.setAttribute("aria-label", title);
    }
    return c;
  }

  function fillStrip(strip, p, form, cm, pending, cardW, mapForm) {
    strip.textContent = "";
    strip.className = "sr-reset sr-in" + density(cardW);
    const micro = / sr-in--micro/.test(strip.className);
    const tight = / sr-in--tight/.test(strip.className);
    const wide = / sr-in--wide/.test(strip.className);
    strip.title = summary(p, form, cm);
    const st = (cm && cm.stats) || {};

    const top = el("span", "sr-in-r1");
    const badges = el("span", "sr-in-badges");

    // Who they queue with, before any performance number — it changes how
    // every number after it should be read.
    const party = state.party.get(String(p.nick || "").toLowerCase());
    if (party) {
      const tag = el("span", "sr-in-party", String(party.size));
      tag.style.setProperty("--sr-party", party.hex);
      tag.title = party.size + "-stack \u2014 these players queue together";
      tag.setAttribute("aria-label", tag.title);
      badges.append(tag);
    }
    // FACEIT's own card already shows the level; on a card this narrow the
    // space buys more as a number than as a duplicate badge.
    // The CheatMeter payload's level is the authoritative FACEIT one. A
    // Matchmaking roster's gameSkillLevel is NOT a FACEIT level — a player
    // reading 2916 elo (level 10) was being drawn as a level 4, in level-4
    // colours. Prefer the number that is actually the thing we label it.
    const lvl = cm && cm.faceitLevel > 0 ? cm.faceitLevel : p.level > 0 ? p.level : 0;
    if (!micro && lvl > 0) {
      const lv = el("span", "sr-in-lvl sr-lvl sr-lvl-" + lvl, String(lvl));
      lv.title = "FACEIT level " + lvl;
      badges.append(lv);
    }
    if (badges.childNodes.length) top.append(badges);

    // Every player renders the SAME slots in the SAME order, with a dash where
    // a value is missing. Omitting a cell shifted every column after it, so
    // reading a column down the roster — the entire point of a roster strip —
    // did not work: the elo column measured 75/55/75/55/75 across five players.
    const grid = el("span", "sr-in-grid");
    const n = form ? form.matches : 0;
    const over = " over their last " + n + " matches";
    // The sampled figures come from a handful of scoreboards, not the whole
    // window — each says so rather than borrowing the window's authority.
    const win30 = " over their last " + (st.recentMatches || n || 30) + " matches";

    // K/D stays on the thirty-match window, which is the better sample. K/D/A
    // is built from that SAME window's kills and deaths, taking only assists
    // from the smaller per-match sample — so the ratio it implies always
    // agrees with the K/D printed beside it. Sourcing the whole triple from
    // the sample would have made "16/17/6" say 0.94 next to a K/D of 1.16.
    const kdVal = form ? form.kd : null;
    const sampleN = st.recentMatches || 0;

    const SLOTS = [
      // A Matchmaking roster carries a skill level but no elo, and the elo
      // lookup only ran when the uuid was also missing — so on a Premier room
      // this sat empty even though the CheatMeter payload had the number all
      // along. Take it from whichever source actually has it.
      { t: 1, label: "elo",
        v: () => {
          const e = p.elo > 0 ? p.elo : cm && cm.faceitElo > 0 ? cm.faceitElo : null;
          return e ? e.toLocaleString("en-US") : null;
        },
        cls: "sr-in-c-elo", title: "Current FACEIT elo" },
      { t: 2, label: "matches", v: () => (st.matches != null ? st.matches.toLocaleString("en-US") : null),
        title: "FACEIT matches played, all time" },
      { t: 1, label: "win", v: () => (form ? Math.round(form.wr) + "%" : null),
        hex: () => (form ? rateHex(form.wr) : null), title: "Win rate" + over },
      { t: 2, label: "rating", v: () => (st.rating != null ? st.rating.toFixed(2) : null),
        hex: () => (st.rating != null ? ratingOneHex(st.rating) : null),
        title: "HLTV Rating 1.0" + win30 },
      { t: 0, label: "K/D", v: () => (kdVal != null ? kdVal.toFixed(2) : null),
        hex: () => (kdVal != null ? kdHex(kdVal) : null), title: "Kills / deaths" + win30 },
      { t: 2, label: "K/D/A",
        v: () =>
          form && st.avgAssists != null
            ? Math.round(form.avgKills) + "/" + Math.round(form.avgDeaths) + "/" + Math.round(st.avgAssists)
            : null,
        title:
          "Average kills / deaths per match" + over +
          (sampleN ? "; assists over their last " + sampleN : "") },
      { t: 2, label: "K/R", v: () => (st.kr != null ? st.kr.toFixed(2) : null),
        title: "Kills per round" + win30 },
      { t: 1, label: "ADR", v: () => (st.adr != null ? String(Math.round(st.adr)) : null),
        hex: () => (st.adr != null ? adrHex(st.adr) : null),
        title: "Average damage per round" + win30 },
      // Leetify's own rating — the number Repeek labels "Swing". Shown at the
      // width a FACEIT card actually is, not only on a wide one.
      { t: 2, label: "swing", v: () => (st.swing != null ? (st.swing >= 0 ? "+" : "") + st.swing.toFixed(2) + "%" : null),
        hex: () => (st.swing != null ? (st.swing >= 0 ? "var(--sr-good)" : "var(--sr-bad)") : null),
        title: "Leetify rating — how much better or worse than an average player they made each round" },
      { t: 3, label: "HS", v: () => (st.hsPct != null ? Math.round(st.hsPct) + "%" : null),
        title: "Headshot percentage, all time" },
      { t: 3, label: "aim", v: () => (st.aim != null ? String(Math.round(st.aim)) : null),
        hex: () => (st.aim != null ? ratingHex(st.aim) : null), title: "Leetify aim rating (0-100)" },
    ];

    const level = micro ? 0 : tight ? 1 : wide ? 3 : 2;
    let shown = 0;
    for (const sl of SLOTS) {
      if (sl.t > level) continue;
      shown += 1;
      const raw = sl.v();
      if (raw == null) {
        const c = cell(sl.label, DASH, { cls: sl.cls, title: sl.title + " — not available" });
        c.querySelector(".sr-in-cv").classList.add("sr-in-cv--none");
        grid.append(c);
      } else {
        grid.append(cell(sl.label, raw, { cls: sl.cls, hex: sl.hex && sl.hex(), title: sl.title }));
      }
    }
    // A fixed column count means every player's grid wraps identically, so the
    // columns line up down the roster.
    // Column count per tier, chosen so a value never has to wrap inside its
    // own track: the widest cell is K/D/A ("16/17/6"), about 52px at 12px bold.
    const maxCols = level === 0 ? 1 : level === 1 ? 4 : 6;
    grid.style.setProperty("--sr-cols", String(Math.min(shown, maxCols)));
    if (pending && !form) grid.append(el("span", "sr-skel sr-in-skel"));
    top.append(grid);
    strip.append(top);

    // The context line: the map being played, then the status chips. Keeping
    // the chips off the metric line gives the numbers the full width of the
    // card, which is what lets nine of them wrap in two rows instead of three.
    const bottom = el("span", "sr-in-r2");

    // How they do on the map actually being played, and whether that is above
    // or below their own baseline. A raw map win rate means little without
    // knowing what the player normally does.
    const effMap = state.selMap || state.map;
    if (!micro && mapForm && effMap) {
      const row = el("span", "sr-in-mapwrap");
      const name = el("span", "sr-in-mapname", mapShort(effMap));
      if (state.selMap) {
        name.classList.add("sr-in-mapname--sel");
        name.title =
          "Selected from the map chart \u2014 click " + mapShort(effMap) + " there again to clear";
      } else {
        name.title = "Performance on " + mapShort(effMap) + ", the map being played";
      }
      row.append(name);
      if (!mapForm.matches) {
        const none = el("span", "sr-in-mapnew", "not played recently");
        none.title = "No games on this map in their last " + HIST_N;
        row.append(none);
      } else {
        // A 100% win rate off one game is not a 100% win rate. Below a usable
        // sample the numbers are still shown but stop being coloured, which is
        // the same "real but thin" treatment the CheatMeter chip already uses.
        const thin = mapForm.matches < MAP_MIN_SAMPLE;
        const note = thin
          ? " — only " + mapForm.matches + " game" + (mapForm.matches === 1 ? "" : "s") + ", read with care"
          : "";
        if (thin) row.classList.add("sr-in-mapwrap--thin");
        row.append(
          cell("K/D", mapForm.kd.toFixed(2), { hex: thin ? null : kdHex(mapForm.kd), title: "K/D on this map" + note }),
          cell("win", Math.round(mapForm.wr) + "%", { hex: thin ? null : rateHex(mapForm.wr), title: "Win rate on this map" + note }),
        );
        // The deeper read, where the card has room for it: how hard they hit,
        // what the map has actually cost or paid them, and whether they are
        // current on it or rusty. All from rows already fetched.
        if (!tight) {
          if (typeof mapForm.avgKills === "number" && isFinite(mapForm.avgKills)) {
            row.append(cell("avg K", mapForm.avgKills.toFixed(1), { title: "Average kills per match on this map" + note }));
          }
          if (mapForm.netElo != null) {
            row.append(
              cell("elo", (mapForm.netElo > 0 ? "+" : "") + mapForm.netElo, {
                hex: thin ? null : mapForm.netElo >= 0 ? "var(--sr-good)" : "var(--sr-bad)",
                title: "Net elo won or lost across their games on this map" + note,
              }),
            );
          }
          if (mapForm.lastAt) {
            row.append(cell("last", agoShort(mapForm.lastAt), { title: "Most recent match on this map" }));
          }
        }
        // A 0.01 difference is noise; giving it the same arrow and colour as a
        // real edge tells the reader something that is not there.
        if (form && form.kd > 0 && !thin && Math.abs(mapForm.kd - form.kd) >= MAP_MIN_DELTA) {
          const d = mapForm.kd - form.kd;
          const arrow = el(
            "span",
            "sr-in-delta " + (d >= 0 ? "sr-in-delta--up" : "sr-in-delta--down"),
            (d >= 0 ? "▲" : "▼") + Math.abs(d).toFixed(2),
          );
          arrow.title =
            "K/D on this map versus their overall — " +
            (d >= 0 ? "this map suits them" : "below their usual");
          row.append(arrow);
        }
        const g = el("span", "sr-in-mapn", mapForm.matches + "g");
        g.title = mapForm.matches + " games on this map in their last " + HIST_N;
        row.append(g);
      }
      bottom.append(row);
    }

    const chips = el("span", "sr-in-chips");
    if (form && !micro) {
      chips.append(
        chip(
          form.won ? "sr-in-chip--w" : "sr-in-chip--l",
          form.won ? "won" : "lost",
          form.streak.slice(1),
          (form.won ? "Won " : "Lost ") + form.streak.slice(1) + " in a row",
        ),
      );
    }
    if (cm && cm.banned) {
      chips.append(chip("sr-in-chip--ban", "ban", "VAC", "VAC or game ban on record"));
    } else if (cm && cm.cheat) {
      const c = chip(
        "sr-in-chip--cm",
        "risk",
        cm.cheat.score + "%",
        "CheatMeter " + cm.cheat.score + "% — " + cm.cheat.band.replace("very", "very ") + " risk",
      );
      c.style.setProperty("--sr-cm", bandHex(cm.cheat.band));
      if (cm.cheat.lowConfidence) c.classList.add("sr-in-chip--dim");
      chips.append(c);
    }
    if (wide && cm && typeof cm.premier === "number" && cm.premier > 0) {
      const pr = chip("sr-in-chip--prem", "premier", cm.premier.toLocaleString("en-US"), "CS2 Premier rating");
      pr.style.setProperty("--sr-tier", tierHex(cm.premier));
      chips.append(pr);
    }

    // The way through to the full picture. Built from the endpoint's own
    // profile URL when we have it, and from the SteamID otherwise, so the
    // button is there even when the risk lookup came back thin.
    const href =
      (cm && cm.profileUrl) ||
      (p.steam64 ? SITE + "/profiles/" + encodeURIComponent(String(p.steam64)) : null);
    if (href) {
      const a = el("a", "sr-in-chip sr-in-chip--site");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("data-sr-link", "1");
      a.append(el("span", "sr-in-chipv", "CSRun"), el("span", "sr-in-arrow", "\u2197"));
      a.title = "Open " + (p.nick || "this player") + "'s full stats on CSRun";
      a.setAttribute("aria-label", a.title);
      chips.append(a);
    }
    if (chips.childNodes.length) (micro ? top : bottom).append(chips);
    if (bottom.childNodes.length) strip.append(bottom);

    if (!top.childNodes.length && !strip.childNodes.length) {
      strip.append(el("span", "sr-in-none", "No data"));
    }
  }

  // Colour is a second channel, never the only one \u2014 every value stays
  // legible in monochrome and carries its meaning in the tooltip.
  function kdHex(v) {
    if (v >= 1.15) return "var(--sr-good)";
    if (v < 0.9) return "var(--sr-bad)";
    return "var(--sr-ink)";
  }
  function rateHex(v) {
    if (v >= 60) return "var(--sr-good)";
    if (v < 45) return "var(--sr-bad)";
    return "var(--sr-ink)";
  }
  function ratingOneHex(v) {
    if (v >= 1.1) return "var(--sr-good)";
    if (v < 0.95) return "var(--sr-bad)";
    return "var(--sr-ink)";
  }
  function adrHex(v) {
    if (v >= 85) return "var(--sr-good)";
    if (v < 65) return "var(--sr-bad)";
    return "var(--sr-ink)";
  }
  function ratingHex(v) {
    if (v >= 75) return "var(--sr-good)";
    if (v < 50) return "var(--sr-bad)";
    return "var(--sr-ink)";
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

  // The same numbers, restricted to one map. A player's overall K/D says
  // little about whether THIS map suits them, which is the question a match
  // room actually poses.
  function mapShort(m) {
    return String(m).replace(/^de_/, "").replace(/^[a-z]/, (c) => c.toUpperCase());
  }

  // How long ago, in the shortest honest unit.
  function agoShort(ts) {
    const sec = Math.max(0, (Date.now() - ts) / 1000);
    if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + "m";
    if (sec < 86400) return Math.round(sec / 3600) + "h";
    if (sec < 86400 * 30) return Math.round(sec / 86400) + "d";
    return Math.round(sec / (86400 * 30)) + "mo";
  }

  function computeMapForm(rows, map) {
    if (!Array.isArray(rows) || !map) return null;
    const want = String(map).toLowerCase();
    const on = rows.filter((r) => r && r.map && String(r.map).toLowerCase() === want);
    if (!on.length) return { kd: null, wr: null, matches: 0 };
    const f = computeForm(on);
    if (!f) return null;
    // Net elo on the map and when they last touched it — both derivable from
    // rows already in hand, and neither shown anywhere by FACEIT. Deltas are
    // summed only where FACEIT recorded one, and reported as null rather than
    // zero when it recorded none.
    let net = 0, netN = 0, lastAt = 0;
    for (const r of on) {
      if (typeof r.delta === "number" && isFinite(r.delta)) { net += r.delta; netN += 1; }
      const t = r.date instanceof Date ? r.date.getTime() : NaN;
      if (isFinite(t) && t > lastAt) lastAt = t;
    }
    return {
      kd: f.kd,
      wr: f.wr,
      avgKills: f.avgKills,
      matches: on.length,
      netElo: netN ? Math.round(net) : null,
      lastAt: lastAt || null,
    };
  }

  function computeForm(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let k = 0, d = 0, w = 0, a = 0, rnd = 0, withA = 0, withR = 0;
    const won = (r) => r.win === true || r.win === 1 || r.win === "1";
    for (const r of rows) {
      k += r.kills || 0;
      d += r.deaths || 0;
      if (won(r)) w += 1;
      // assists and round counts are read defensively from FACEIT's positional
      // stat columns, so they are counted only where they actually arrived —
      // averaging a present value over an absent one would understate it.
      if (r.assists != null) { a += r.assists; withA += 1; }
      if (r.rounds != null) { rnd += r.rounds; withR += 1; }
    }
    const top = won(rows[0]);
    let streak = 0;
    for (const r of rows) {
      if (won(r) === top) streak += 1;
      else break;
    }
    return {
      kd: k / Math.max(1, d),
      wr: (w / rows.length) * 100,
      avgKills: k / rows.length,
      avgDeaths: d / rows.length,
      avgAssists: withA ? a / withA : null,
      kr: withR && rnd > 0 ? k / rnd : null,
      streak: (top ? "W" : "L") + streak,
      won: top,
      matches: rows.length,
    };
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
    const cardW = state.cardW || card.getBoundingClientRect().width;
    fillStrip(strip, p, null, null, true, cardW);
    if (!attach(card, strip)) return;

    const A = api();
    if (!A) return;
    let form = null;
    let cm = null;
    let histRows = null;
    const paint = () => {
      if (gen === state.gen && strip.isConnected) {
        // Recomputed on every paint rather than cached: the map in question
        // changes when someone clicks the veto chart, and the rows are already
        // in hand — the strips retune to the selected map for free.
        const mapForm = histRows ? computeMapForm(histRows, state.selMap || state.map) : null;
        fillStrip(strip, p, form, cm, false, state.cardW || card.getBoundingClientRect().width, mapForm);
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

    redraws.set(strip, paint);

    const jobs = [];
    if (p.uuid) {
      jobs.push(
        A.eloHistory(p.uuid, HIST_N)
          .then((rows) => {
            histRows = rows;
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
    state.map = (room && room.map) || null;

    let roster = [];
    if (room && Array.isArray(room.teams)) {
      room.teams.forEach((team, side) => {
        for (const p of team.roster || []) {
          if (p && p.nick) roster.push(Object.assign({}, p, { team: side }));
        }
      });
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

    // One density for the whole roster, taken from the NARROWEST card. Cards
    // in a row are auto-sized, so the player with the longest nickname gets a
    // wider one — and deciding density per card let that single player cross
    // into a richer tier, whose taller strip then set the height of the entire
    // row. A roster should read as one thing.
    let narrowest = Infinity;
    if (dom) {
      for (const node of all) {
        const c = dom.cardFor(node, all);
        if (c) narrowest = Math.min(narrowest, c.getBoundingClientRect().width);
      }
    }
    state.cardW = Number.isFinite(narrowest) ? narrowest : null;

    for (const p of roster) {
      void decorate(Object.assign({}, p, { node: p.node || nodes.get(p.nick) || null }), gen, all);
    }
    void detectParties(roster, gen);
  }

  // ---- who is queuing together --------------------------------------------

  // Every player's recent match ids, then a union-find over the pairs that
  // overlap. The histories are the same ones the strips fetch, through the
  // same cache, so this costs nothing extra.
  async function detectParties(roster, gen) {
    const A = api();
    if (!A || roster.length < 2) return;

    const people = (
      await Promise.all(
        roster.map(async (p) => {
          try {
            const uuid = p.uuid || (await A.user(p.nick).then((u) => (u ? u.uuid : null)));
            if (!uuid) return null;
            const rows = await A.eloHistory(uuid, HIST_N);
            if (!Array.isArray(rows)) return null;
            const ids = new Set();
            for (const r of rows) if (r && r.matchId) ids.add(r.matchId);
            return ids.size ? { nick: p.nick, team: p.team, ids } : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);

    if (gen !== state.gen || people.length < 2) return;

    const parent = people.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => {
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[a] = b;
    };

    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        // A premade in THIS match is on one side of it, so when we know the
        // sides we only look within them.
        if (people[i].team != null && people[j].team != null && people[i].team !== people[j].team) continue;
        let shared = 0;
        const small = people[i].ids.size <= people[j].ids.size ? people[i].ids : people[j].ids;
        const big = small === people[i].ids ? people[j].ids : people[i].ids;
        for (const id of small) if (big.has(id)) shared += 1;
        if (shared >= PARTY_MIN_SHARED) union(i, j);
      }
    }

    const groups = new Map();
    people.forEach((_, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(i);
    });

    const party = new Map();
    let colour = 0;
    for (const members of groups.values()) {
      if (members.length < 2) continue; // a solo queue is not a party
      const hex = PARTY_HEX[colour % PARTY_HEX.length];
      colour += 1;
      for (const i of members) {
        party.set(people[i].nick.toLowerCase(), { size: members.length, hex });
      }
    }

    if (gen !== state.gen) return;
    state.party = party;
    // Repaint whatever is already on the page — the tag arrives after the
    // strips do, and a strip is cheap to redraw.
    for (const strip of document.querySelectorAll("[" + OWNER + "]")) {
      const repaint = redraws.get(strip);
      if (repaint) repaint();
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
      state.selMap = null; // a selection belongs to the room it was made in
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

    // The veto chart announces map selections; every strip retunes. Works in
    // the pre-game lobby too, where no map is picked yet — clicking candidates
    // during the ban phase compares the rosters map by map.
    document.addEventListener("sr-map-select", (e) => {
      const map = e && e.detail && e.detail.map ? String(e.detail.map) : null;
      if (map === state.selMap) return;
      state.selMap = map;
      for (const strip of document.querySelectorAll("[" + OWNER + "]")) {
        const repaint = redraws.get(strip);
        if (repaint) repaint();
      }
    });

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
