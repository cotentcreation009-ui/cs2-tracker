// CSRun flagship: the match-room panel. Watches FACEIT's SPA for
// /cs2/room/{id} routes, mounts #statrun-room above the room content and
// renders two team cards (roster, last-30 form, CheatMeter / Premier /
// Leetify), an elo prediction per side, and a shared map-form panel below.
//
// Everything degrades to honest empty states ("—", "No data yet"); on any
// failure the mount is removed and the host page is left untouched. All data
// flows through SRApi (src/lib/api.js); the CheatMeter chip is delegated to
// SR.chip (src/badge.js) when that module is present.
//
// Dev fixtures drive the same code path with a `#room={id}` hash instead of
// real routing (see dev/matchroom.html).

(function () {
  "use strict";

  const MOUNT_ID = "statrun-room";
  // Anchored to the END of the path on purpose. FACEIT's match room has tabbed
  // sub-routes, and the STATS tab renders its own full scoreboard — ours landed
  // on top of it and covered FACEIT's numbers. The bare room path is the
  // OVERVIEW tab and the pre-game lobby (map and server veto), which are the
  // two places this belongs; any sub-route is left alone.
  const ROOM_RE = /\/cs2\/room\/([^/?#]+)\/?$/i;
  const DEV_RE = /[#&]room=([^&]+)/;
  const HIST_N = 30;
  const MAX_PER_TEAM = 5;

  // Premier tier hexes (CS2 rating scale) — constants from DESIGN.md, applied
  // via a custom property the same way badge.js applies band hexes.
  const TIERS = [
    [30000, "#ffd700"],
    [25000, "#eb4b4b"],
    [20000, "#d32ce6"],
    [15000, "#8847ff"],
    [10000, "#4b69ff"],
    [5000, "#5e98d9"],
    [0, "#b0c3d9"],
  ];

  // CheatMeter band hexes for the fallback chip (badge.js owns the real one).
  const BANDS = {
    verylow: { hex: "#46d369", label: "Very low" },
    low: { hex: "#8fd14f", label: "Low" },
    moderate: { hex: "#f5b942", label: "Moderate" },
    high: { hex: "#ff8a3d", label: "High" },
    veryhigh: { hex: "#f5694a", label: "Very high" },
  };

  // id: room currently owned; gen: cancels stale async work; dead: room render
  // failed or was gated off — don't retry until the route actually changes.
  const state = { id: null, gen: 0, dead: false, deadUntil: 0, tries: 0 };

  // ---- tiny DOM/format helpers (nicknames & team names are untrusted) -----

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function put(cell, node) {
    cell.textContent = "";
    cell.append(node);
  }

  function putDash(cell) {
    put(cell, el("span", "sr-mr-dash", "—"));
  }

  function fmtInt(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function winOf(r) {
    return r.win === true || r.win === 1 || r.win === "1";
  }

  function tierHex(rating) {
    for (const [floor, hex] of TIERS) if (rating >= floor) return hex;
    return TIERS[TIERS.length - 1][1];
  }

  function flagEmoji(cc) {
    if (typeof cc !== "string" || !/^[a-z]{2}$/i.test(cc)) return null;
    const u = cc.toUpperCase();
    return String.fromCodePoint(
      0x1f1e6 + u.charCodeAt(0) - 65,
      0x1f1e6 + u.charCodeAt(1) - 65,
    );
  }

  function mapLabel(raw) {
    const s = String(raw || "").replace(/^(de|cs)_/i, "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
  }

  // ---- stats -------------------------------------------------------------

  function computeForm(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    let kills = 0;
    let deaths = 0;
    let wins = 0;
    for (const r of rows) {
      kills += r.kills || 0;
      deaths += r.deaths || 0;
      if (winOf(r)) wins += 1;
    }
    const won = winOf(rows[0]); // rows are newest first
    let streak = 0;
    for (const r of rows) {
      if (winOf(r) === won) streak += 1;
      else break;
    }
    return {
      kd: kills / Math.max(1, deaths),
      wr: (wins / rows.length) * 100,
      streak: (won ? "W" : "L") + streak,
      won,
      matches: rows.length,
    };
  }

  function addMaps(agg, rows) {
    for (const r of rows) {
      const key = String(r.map || "").trim().toLowerCase();
      if (!key) continue;
      const e = agg.get(key) || { n: 0, w: 0, kills: 0, deaths: 0, kn: 0 };
      e.n += 1;
      if (winOf(r)) e.w += 1;
      if (typeof r.kills === "number") {
        e.kills += r.kills;
        e.deaths += typeof r.deaths === "number" ? r.deaths : 0;
        e.kn += 1;
      }
      agg.set(key, e);
    }
  }

  function avgElo(roster) {
    const elos = (roster || [])
      .map((p) => p.elo)
      .filter((e) => typeof e === "number" && e > 0);
    if (!elos.length) return null;
    return Math.round(elos.reduce((a, b) => a + b, 0) / elos.length);
  }

  // Standard FACEIT model, K=1 (ARCHITECTURE.md), clamped to ±50.
  function predict(own, opp) {
    const expected = 1 / (1 + Math.pow(10, (opp - own) / 400));
    const clamp = (v) => Math.max(0, Math.min(50, v));
    return {
      gain: clamp(Math.round(50 * (1 - expected))),
      loss: clamp(Math.round(50 * expected)),
    };
  }

  // ---- settings gate -----------------------------------------------------

  async function allowed() {
    try {
      if (typeof SRSettings === "undefined" || !SRSettings || typeof SRSettings.get !== "function") {
        return true; // data layer not loaded yet — display features default on
      }
      const s = await SRSettings.get();
      if (!s) return true;
      return s.enabled !== false && s["feature.matchroom"] !== false;
    } catch {
      return true;
    }
  }

  // ---- mount -------------------------------------------------------------

  // Match rooms have NO <main> — measured on the live page, which is why an
  // earlier `querySelector("main")`-only version mounted nothing at all there.
  // Try the room's own containers first, then the generic ones, and only give
  // up if the document has no usable host.
  function hostEl() {
    return (
      document.querySelector("#canvas-body") ||
      document.querySelector("#canvas-wrapper") ||
      document.querySelector('[class*="CanvasHolder"]') ||
      document.querySelector("main") ||
      document.querySelector("#__next") ||
      null
    );
  }

  // The roster block, if the page has painted one: the smallest element that
  // contains every player's name. The panel is about those two teams, so
  // directly above them is where it belongs.
  function rosterEl(nicks) {
    const dom = window.SRDom;
    if (!dom || !nicks || !nicks.length) return null;
    const nodes = [...dom.nameNodes(nicks).values()];
    if (nodes.length < 2) return null;
    const box = dom.commonAncestor(nodes);
    if (!box || box.id === "canvas-body") return null;
    return box;
  }

  // Falls back through the room's own containers, and #__next only as a last
  // resort — prepending to that puts the panel above FACEIT's entire app,
  // header and all, which is exactly what it did on a Premier room where the
  // earlier selectors matched nothing.
  // Move an already-rendered panel to sit above the roster. Separate from
  // insertMount because the roster paints after we mount: the panel has to go
  // up immediately with its skeleton, and then walk to the right place once
  // the page tells us where the players are.
  function placeByRoster(mount, nicks) {
    if (!mount || !mount.isConnected) return false;
    const roster = rosterEl(nicks);
    if (!roster || !roster.parentElement) return false;
    if (roster.previousElementSibling === mount) return true; // already there
    if (mount.contains(roster)) return false; // never reparent into ourselves
    roster.parentElement.insertBefore(mount, roster);
    return true;
  }

  function insertMount(nicks) {
    const old = document.getElementById(MOUNT_ID);
    if (old) old.remove();
    const mount = el("div", "sr-reset sr-mr");
    mount.id = MOUNT_ID;

    const roster = rosterEl(nicks);
    if (roster && roster.parentElement) {
      roster.parentElement.insertBefore(mount, roster);
      return mount;
    }

    const host = hostEl();
    if (!host) return null; // no stable anchor — degrade to nothing
    const anchor = host.firstElementChild;
    if (anchor) host.insertBefore(mount, anchor);
    else host.appendChild(mount);
    return mount;
  }

  // ---- skeleton ----------------------------------------------------------

  function skel(cls) {
    return el("span", "sr-skel " + cls);
  }

  function skelRow() {
    const row = el("div", "sr-mr-row sr-mr-row--skel");
    row.append(skel("sr-mr-skel-avatar"), skel("sr-mr-skel-name"));
    for (let i = 0; i < 8; i++) row.append(skel("sr-mr-skel-cell"));
    return row;
  }

  function skelCard() {
    const card = el("section", "sr-mr-card");
    const head = el("header", "sr-mr-head");
    head.append(skel("sr-mr-skel-title"), skel("sr-mr-skel-chip"));
    card.append(head);
    if (!SUMMARY_ONLY) for (let i = 0; i < MAX_PER_TEAM; i++) card.append(skelRow());
    return card;
  }

  function vetoSkeleton() {
    const panel = el("section", "sr-veto-panel");
    const head = el("div", "sr-mr-vhead");
    head.append(skel("sr-mr-skel-title"));
    panel.append(head);
    for (let i = 0; i < 3; i++) {
      const row = el("div", "sr-mr-vrow");
      row.append(
        skel("sr-mr-skel-cell"),
        skel("sr-mr-skel-cell"),
        skel("sr-mr-skel-bar"),
        skel("sr-mr-skel-cell"),
      );
      panel.append(row);
    }
    return panel;
  }

  function renderSkeleton(mount) {
    mount.textContent = "";
    const teams = el("div", "sr-mr-teams");
    teams.append(skelCard(), skelCard());
    mount.append(teams, vetoSkeleton());
  }

  // ---- player row --------------------------------------------------------

  function playerRow(p) {
    const row = el("div", "sr-mr-row");
    const nick = String(p.nick || "unknown");

    const av = el("span", "sr-mr-avatar");
    if (p.avatar) {
      const img = el("img");
      img.src = p.avatar;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      av.append(img);
    } else {
      av.textContent = nick.charAt(0).toUpperCase();
    }

    const namec = el("span", "sr-mr-name");
    const a = el("a", "sr-mr-nick", nick);
    a.href = "https://www.faceit.com/en/players/" + encodeURIComponent(nick);
    a.target = "_blank";
    a.rel = "noreferrer";
    a.title = nick;
    namec.append(a);
    const flag = flagEmoji(p.country);
    if (flag) {
      const f = el("span", "sr-mr-flag", flag);
      f.title = String(p.country).toUpperCase();
      namec.append(f);
    }

    const lvlN = Number(p.level);
    const hasLvl = Number.isInteger(lvlN) && lvlN >= 1 && lvlN <= 10;
    const lvl = el(
      "span",
      "sr-lvl sr-mr-lvl sr-num" + (hasLvl ? " sr-lvl-" + lvlN : ""),
      hasLvl ? String(lvlN) : "—",
    );
    if (hasLvl) lvl.title = "FACEIT level " + lvlN;

    const elo =
      typeof p.elo === "number" && p.elo > 0
        ? el("span", "sr-mr-elo sr-num", fmtInt(p.elo))
        : el("span", "sr-mr-elo sr-mr-dash", "—");

    const cell = (cls) => {
      const c = el("span", "sr-mr-cell " + cls);
      c.append(skel("sr-mr-skel-stat"));
      return c;
    };
    const cells = {
      kd: cell("sr-mr-c-kd"),
      wr: cell("sr-mr-c-wr"),
      streak: cell("sr-mr-c-streak"),
      cm: cell("sr-mr-c-cm"),
      prem: cell("sr-mr-c-prem"),
      aim: cell("sr-mr-c-aim"),
    };

    row.append(av, namec, lvl, elo, cells.kd, cells.wr, cells.streak, cells.cm, cells.prem, cells.aim);
    return { row, cells };
  }

  function fillForm(cells, form) {
    if (!form) {
      putDash(cells.kd);
      putDash(cells.wr);
      putDash(cells.streak);
      return;
    }
    const kd = el("span", "sr-num", form.kd.toFixed(2));
    kd.title = "K/D over last " + form.matches + " matches";
    put(cells.kd, kd);

    const wr = el("span", "sr-num", Math.round(form.wr) + "%");
    wr.title = "Win rate over last " + form.matches + " matches";
    put(cells.wr, wr);

    const st = el(
      "span",
      "sr-mr-streak sr-num " + (form.won ? "sr-mr-streak--w" : "sr-mr-streak--l"),
      form.streak,
    );
    st.title = (form.won ? "Won" : "Lost") + " the last " + form.streak.slice(1) + " in a row";
    put(cells.streak, st);
  }

  // Compact CheatMeter chip used only when badge.js (SR.chip) isn't loaded.
  function localChip(data) {
    const a = el("a", "sr-mr-cm sr-num");
    a.target = "_blank";
    a.rel = "noreferrer";
    a.href = (data && data.profileUrl) || "https://csrun.win";
    if (data && data.banned) {
      a.classList.add("sr-mr-cm--ban");
      a.title = "VAC/game ban on record — view on CSRun";
      a.textContent = "BAN";
      return a;
    }
    const cheat = data && data.cheat;
    if (cheat && typeof cheat.score === "number") {
      const b = BANDS[cheat.band] || BANDS.moderate;
      a.style.setProperty("--sr-cm", b.hex);
      a.classList.add("sr-mr-cm--score");
      if (cheat.lowConfidence) a.classList.add("sr-mr-cm--dim");
      a.title =
        "CheatMeter " + cheat.score + "% (" + b.label + ")" +
        (cheat.lowConfidence ? " · low confidence" : "") +
        " — view on CSRun";
      a.setAttribute("aria-label", a.title);
      a.append(el("span", "sr-mr-cmdot"), el("span", null, String(cheat.score)));
      return a;
    }
    a.classList.add("sr-mr-cm--neutral");
    a.title = "View this player on CSRun";
    a.textContent = "SR";
    return a;
  }

  function fillCM(cells, data) {
    if (!data || data.error) {
      putDash(cells.cm);
      putDash(cells.prem);
      putDash(cells.aim);
      return;
    }

    const chip =
      typeof SR !== "undefined" && SR && typeof SR.chip === "function"
        ? SR.chip(data)
        : localChip(data);
    put(cells.cm, chip);

    if (typeof data.premier === "number" && data.premier > 0) {
      const plate = el("span", "sr-mr-prem sr-num", fmtInt(data.premier));
      plate.style.setProperty("--sr-tier", tierHex(data.premier));
      plate.title = "CS2 Premier rating " + fmtInt(data.premier);
      put(cells.prem, plate);
    } else {
      putDash(cells.prem);
    }

    // the public cheatmeter payload ships this as leetifyAim (0–100)
    const aim =
      typeof data.leetifyAim === "number"
        ? data.leetifyAim
        : typeof data.leetify === "number"
          ? data.leetify
          : data.leetify && typeof data.leetify.aim === "number"
            ? data.leetify.aim
            : null;
    if (aim != null) {
      const v = el("span", "sr-mr-aim sr-num", String(Math.round(aim)));
      v.title = "Leetify aim rating (0–100)";
      put(cells.aim, v);
    } else {
      putDash(cells.aim);
    }
  }

  // ---- team card ---------------------------------------------------------

  // Per-player rows moved to roominline.js, which attaches them under
  // FACEIT's OWN player cards — the numbers belong on the player, not in a
  // second table you have to cross-reference. The panel keeps what is
  // genuinely team-level: identity, average elo, the elo estimate, and the
  // map radar.
  const SUMMARY_ONLY = true;

  function teamCard(team, ownAvg, oppAvg) {
    const card = el("section", "sr-mr-card");

    const head = el("header", "sr-mr-head");
    const name = el("h3", "sr-mr-teamname", String(team.name || "Team"));
    name.title = String(team.name || "Team");
    const right = el("div", "sr-mr-headright");
    // Rebuildable: a Premier roster arrives without elo, so the average and the
    // prediction that depends on it can only be drawn once the per-player
    // lookups come back. Redrawing this strip is cheaper than blocking the
    // whole panel on them.
    const renderRight = (own, opp) => {
      right.textContent = "";
      const avg = el("span", "sr-mr-avg");
      avg.append(el("span", "sr-label", "avg"));
      avg.append(
        own != null
          ? el("span", "sr-mr-avgval sr-num", fmtInt(own))
          : el("span", "sr-mr-dash", "—"),
      );
      avg.title = "Average FACEIT elo of this roster";
      right.append(avg);
      if (own != null && opp != null) {
        const p = predict(own, opp);
        const chip = el("span", "sr-mr-pred sr-num");
        chip.append(
          el("span", "sr-mr-pred-gain", "+" + p.gain),
          el("span", "sr-mr-pred-sep", "/"),
          el("span", "sr-mr-pred-loss", "−" + p.loss),
          el("span", "sr-mr-pred-est", "est"),
        );
        chip.title =
          "Estimated elo change for this team: +" + p.gain + " on a win, −" + p.loss + " on a loss";
        right.append(chip);
      }
    };
    renderRight(ownAvg, oppAvg);
    head.append(name, right);
    card.append(head);
    if (SUMMARY_ONLY) return { card, handles: [], renderRight };

    const cols = el("div", "sr-mr-cols");
    const lab = (text, cls, title) => {
      const s = el("span", "sr-label " + cls, text);
      if (title) s.title = title;
      return s;
    };
    cols.append(
      lab("Player", "sr-mr-l-player"),
      lab("", "sr-mr-l-lvl"),
      lab("Elo", "sr-mr-l-elo", "Current FACEIT elo"),
      lab("K/D", "sr-mr-l-kd", "Last 30 matches"),
      lab("WR", "sr-mr-l-wr", "Win rate, last 30 matches"),
      lab("Strk", "sr-mr-l-streak", "Current win/loss streak"),
      lab("CM", "sr-mr-l-cm", "CheatMeter risk score"),
      lab("Prem", "sr-mr-l-prem", "CS2 Premier rating"),
      lab("Aim", "sr-mr-l-aim", "Leetify aim rating"),
    );
    card.append(cols);

    const roster = Array.isArray(team.roster) ? team.roster.slice(0, MAX_PER_TEAM) : [];
    const handles = [];
    if (!roster.length) {
      card.append(el("div", "sr-mr-empty", "No data yet"));
    } else {
      for (const p of roster) {
        const h = playerRow(p);
        card.append(h.row);
        handles.push({ p, cells: h.cells });
      }
    }
    return { card, handles };
  }

  // ---- veto / map-form panel ---------------------------------------------

  // ---- map radar ---------------------------------------------------------
  //
  // A two-team overlay: each spoke is a map, each polygon a team, so the shape
  // difference IS the veto read — where their shape juts out is their comfort
  // map, where it collapses is the ban. A stacked bar table made you compare
  // numbers row by row; this makes the mismatch a shape you see at once.

  // CS2 active-duty pool. Retired maps still show up in 30-match history and
  // are pure noise on a veto chart — nobody bans Vertigo.
  const POOL = [
    "de_ancient", "de_anubis", "de_cache", "de_dust2",
    "de_inferno", "de_mirage", "de_nuke",
  ];

  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  const R_SIZE = 260;
  const R_C = R_SIZE / 2;
  // Sized against the label ring below (LBL_R), not the box: the polygon should
  // be the biggest thing in the panel, and it was drawing at 57% of its own box
  // because the vertex captions used to be a full sentence wide.
  const R_MAX = 90;
  const LBL_R = 1.24;

  // total is the team's whole sample, so "pick" can be a share of it
  function metricOf(e, metric, total) {
    if (!e || !e.n) return null;
    if (metric === "kills") return e.kn ? e.kills / e.kn : null;
    if (metric === "kd") return e.kn && e.deaths > 0 ? e.kills / e.deaths : null;
    if (metric === "pick") return total ? (e.n / total) * 100 : null;
    return (e.w / e.n) * 100;
  }

  const METRICS = [
    { key: "winrate", label: "Win rate", unit: "%", head: "WR" },
    { key: "pick", label: "Pick rate", unit: "%", head: "PICK" },
    { key: "kd", label: "K/D", unit: "", head: "K/D" },
    { key: "kills", label: "Avg kills", unit: "", head: "KILLS" },
  ];
  function metricDef(k) {
    return METRICS.find((m) => m.key === k) || METRICS[0];
  }
  function fmtMetric(v, metric) {
    if (v == null) return "—";
    const d = metricDef(metric);
    if (metric === "kd") return v.toFixed(2);
    if (metric === "kills") return v.toFixed(1);
    return Math.round(v) + d.unit;
  }
  function totalOf(agg) {
    let t = 0;
    for (const e of agg.values()) t += e.n;
    return t;
  }

  function radarPanel(aggA, aggB, nameA, nameB) {
    // Pinning a map is also a SELECTION the per-player strips listen for:
    // click Dust2 here and every strip below re-tunes to Dust2. A plain DOM
    // event keeps the two modules decoupled — either works without the other.
    function announce(key) {
      try {
        document.dispatchEvent(new CustomEvent("sr-map-select", { detail: { map: key || null } }));
      } catch {
        /* CustomEvent unavailable — selection simply stays local */
      }
    }

    const panel = el("section", "sr-veto-panel");
    let metric = "winrate";
    let hot = null; // hovered/pinned map key — drives the cross-highlight
    let pinned = null;

    const totalA = totalOf(aggA);
    const totalB = totalOf(aggB);
    const teamA = String(nameA || "Team A");
    const teamB = String(nameB || "Team B");

    // Spokes are the active-duty pool ONLY, and only where BOTH teams have
    // played: a retired map nobody vetoes is noise, and a map one side has
    // never touched collapsed that side's polygon to the centre, which is
    // what made the chart look broken.
    const maps = POOL.filter((k) => {
      const a = aggA.get(k);
      const b = aggB.get(k);
      return a && a.n > 0 && b && b.n > 0;
    }).map((key) => ({ key, a: aggA.get(key), b: aggB.get(key) }));

    // Never-played pool maps are the loudest veto signal in the data.
    const unplayed = POOL.map((key) => {
      const aN = aggA.get(key) ? aggA.get(key).n : 0;
      const bN = aggB.get(key) ? aggB.get(key).n : 0;
      if (aN === 0 && bN === 0) return null;
      if (aN === 0) return { key, side: "a" };
      if (bN === 0) return { key, side: "b" };
      return null;
    }).filter(Boolean);

    // ---- header: metric switcher ----
    const head = el("div", "sr-mr-rhead");
    head.append(el("span", "sr-label", "Map form"));
    const toggle = el("div", "sr-mr-toggle");
    const btns = {};
    for (const m of METRICS) {
      const b = el("button", "sr-mr-tbtn" + (m.key === metric ? " sr-mr-tbtn--on" : ""), m.label);
      b.type = "button";
      b.title =
        m.key === "pick"
          ? "How often each team actually queues this map — a low share is their de-facto ban"
          : m.key === "kd"
            ? "Team's combined kills / deaths on this map"
            : m.key === "kills"
              ? "Average kills per player per match on this map"
              : "Share of matches won on this map";
      b.addEventListener("click", () => setMetric(m.key));
      btns[m.key] = b;
      toggle.append(b);
    }
    head.append(toggle);
    const scope = el("span", "sr-label sr-mr-rscope", "Last 30 each");
    head.append(scope);

    const legend = el("div", "sr-mr-legend");
    // Hovering a team's chip lifts that team's shape and fades the other —
    // the quickest possible answer to "which blob is us?".
    const lg = (name, which) => {
      const s = el("span", "sr-mr-lg sr-mr-lg--" + which);
      s.append(el("span", "sr-mr-lgdot"), el("span", null, name));
      s.title = name;
      s.addEventListener("mouseenter", () => body.classList.add("sr-mr-solo-" + which));
      s.addEventListener("mouseleave", () => body.classList.remove("sr-mr-solo-" + which));
      return s;
    };
    legend.append(lg(teamA, "a"), lg(teamB, "b"));

    const holder = el("div", "sr-mr-radar");
    const side = el("div", "sr-mr-side");
    const body = el("div", "sr-mr-rbody");
    body.append(holder, side);
    panel.append(head, legend, body);

    // Nothing to say at all. Saying so is the point: an empty panel with a
    // heading and a footer reads as broken, and this panel HAS shipped looking
    // exactly like that when the rosters carried no usable history.
    if (!maps.length && !unplayed.length) {
      holder.remove();
      side.classList.add("sr-mr-side--wide");
      side.textContent = "";
      const note = el("div", "sr-mr-tnote");
      note.append(
        el("span", "sr-label", "No map history"),
        el("span", null, "Neither roster has recent matches CSRun can read."),
      );
      side.append(note);
      return panel;
    }

    // Live handles into the rendered chart and table. Highlighting used to
    // re-render both, which detached the very row the pointer was on: the
    // mouseup landed on a replacement node so clicks never completed, and a
    // focused row was destroyed by its own focus handler. Hot state is now a
    // class toggle over these handles; only a metric change rebuilds.
    // Declared before the few-maps early return: drawTable reads refs too,
    // and on a roster with under three known maps it runs first.
    const refs = { dots: [], vx: new Map(), rows: new Map(), areas: [], spoke: null, center: null };
    // The shape currently on screen, as per-axis fractions — the "from" pose
    // when a metric change tweens the polygons to their new values.
    let lastShown = null;
    let anim = 0;
    const REDUCED = (() => {
      try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
    })();

    if (maps.length < 3) {
      holder.remove();
      side.classList.add("sr-mr-side--wide");
      drawTable(side);
      return panel;
    }

    // ---- geometry ----
    const N = () => maps.length;
    const ang = (i) => -Math.PI / 2 + (i / N()) * Math.PI * 2;
    const pt = (i, f) => ({
      x: R_C + Math.cos(ang(i)) * R_MAX * f,
      y: R_C + Math.sin(ang(i)) * R_MAX * f,
    });

    function scale() {
      const vals = [];
      for (const m of maps) {
        vals.push(metricOf(m.a, metric, totalA), metricOf(m.b, metric, totalB));
      }
      const real = vals.filter((v) => v != null);
      if (!real.length) return { lo: 0, hi: 1 };
      if (metric === "winrate") return { lo: 0, hi: 100 };
      // pick / kd / kills: scale to the data so differences are visible
      const hi = Math.max(...real);
      return { lo: 0, hi: hi * 1.15 || 1 };
    }

    function draw() {
      holder.textContent = "";
      if (anim) { cancelAnimationFrame(anim); anim = 0; }
      refs.dots = [];
      refs.vx = new Map();
      refs.areas = [];
      refs.spoke = null;
      const { lo, hi } = scale();
      const frac = (v) => (v == null ? 0.04 : clampNum((v - lo) / (hi - lo || 1), 0.04, 1));

      const d = metricDef(metric);
      const svg = svgEl("svg", {
        viewBox: "0 0 " + R_SIZE + " " + R_SIZE,
        class: "sr-mr-rsvg",
        role: "img",
        "aria-label": d.label + " per map for both teams, last 30 matches each",
      });

      // Team-coloured gradient fills. stop-color goes on as inline style so
      // it can carry a CSS variable — and inline style is also the only thing
      // that reliably outranks .sr-reset's `all: revert`.
      const defs = svgEl("defs", {});
      for (const [id, v] of [["sr-mr-grad-a", "var(--sr-teamA)"], ["sr-mr-grad-b", "var(--sr-teamB)"]]) {
        const g = svgEl("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" });
        const s1 = svgEl("stop", { offset: "0" });
        s1.style.stopColor = v;
        s1.style.stopOpacity = "0.32";
        const s2 = svgEl("stop", { offset: "1" });
        s2.style.stopColor = v;
        s2.style.stopOpacity = "0.05";
        g.append(s1, s2);
        defs.append(g);
      }
      svg.append(defs);

      for (const f of [0.25, 0.5, 0.75, 1]) {
        svg.append(
          svgEl("polygon", {
            class: "sr-mr-ring" + (f === 0.5 ? " sr-mr-ring--mid" : "") + (f === 1 ? " sr-mr-ring--outer" : ""),
            points: maps.map((_, i) => { const p = pt(i, f); return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" "),
          }),
        );
      }
      maps.forEach((_, i) => {
        const p = pt(i, 1);
        svg.append(svgEl("line", { class: "sr-mr-spoke", x1: R_C, y1: R_C, x2: p.x.toFixed(1), y2: p.y.toFixed(1) }));
      });
      // The highlighted axis reads through the polygons. One reusable line,
      // moved on highlight rather than created — see refs above.
      refs.spoke = svgEl("line", { class: "sr-mr-spoke sr-mr-spoke--hot", x1: R_C, y1: R_C, x2: R_C, y2: R_C });
      refs.spoke.style.display = "none";
      svg.append(refs.spoke);

      const fracsOf = (which) =>
        maps.map((m) => frac(metricOf(which === "a" ? m.a : m.b, metric, which === "a" ? totalA : totalB)));
      const target = { a: fracsOf("a"), b: fracsOf("b") };
      const from = lastShown;

      const build = (which) => {
        const area = svgEl("polygon", { class: "sr-mr-area sr-mr-area--" + which });
        // fill inline, with a flat-colour fallback: a url() in the extension's
        // stylesheet would resolve against the css file rather than the page
        // and paint black, and an attribute would lose to `all: revert`.
        area.style.fill = "url(#sr-mr-grad-" + which + ") color-mix(in srgb, var(--sr-team" + which.toUpperCase() + ") 18%, transparent)";
        refs.areas.push(area);
        svg.append(area);
        const dots = maps.map((m) => {
          const dot = svgEl("circle", { class: "sr-mr-dotpt sr-mr-dotpt--" + which });
          // Geometry as inline style, never attributes: this SVG sits inside
          // .sr-reset, whose `all: revert` rolls Chrome's cx/cy/r geometry
          // properties back to 0 — which is why these dots had never actually
          // rendered. Inline style outranks the revert.
          dot.style.r = "3px";
          refs.dots.push({ key: m.key, node: dot });
          svg.append(dot);
          return dot;
        });
        return { area, dots };
      };
      const shapes = { a: build("a"), b: build("b") };

      const pose = (t) => {
        for (const which of ["a", "b"]) {
          const pts = maps.map((m, i) => {
            const f0 = from ? from[which][i] : target[which][i];
            return pt(i, f0 + (target[which][i] - f0) * t);
          });
          shapes[which].area.setAttribute("points", pts.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" "));
          pts.forEach((p, i) => {
            shapes[which].dots[i].style.cx = p.x.toFixed(1) + "px";
            shapes[which].dots[i].style.cy = p.y.toFixed(1) + "px";
          });
        }
      };

      // A metric change MORPHS the shapes instead of blinking to new ones —
      // the eye keeps hold of which team is which while the values move.
      if (from && !REDUCED) {
        const t0 = performance.now();
        const DUR = 300;
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / DUR);
          pose(ease(t));
          anim = t < 1 ? requestAnimationFrame(step) : 0;
        };
        pose(0);
        anim = requestAnimationFrame(step);
      } else {
        pose(1);
      }
      lastShown = target;

      // The whole chart is a control, not just the captions: an invisible
      // wedge per axis catches hover and click anywhere near it.
      maps.forEach((m, i) => {
        const half = Math.PI / N();
        const P = (a, f) => (R_C + Math.cos(a) * R_MAX * f).toFixed(1) + "," + (R_C + Math.sin(a) * R_MAX * f).toFixed(1);
        const wedge = svgEl("polygon", {
          class: "sr-mr-hit",
          points: [R_C + "," + R_C, P(ang(i) - half, 1.14), P(ang(i), 1.2), P(ang(i) + half, 1.14)].join(" "),
        });
        wedge.addEventListener("mouseenter", () => setHot(m.key));
        wedge.addEventListener("mouseleave", () => setHot(pinned));
        wedge.addEventListener("click", () => {
          pinned = pinned === m.key ? null : m.key;
          setHot(pinned);
          applyHot();
          announce(pinned);
        });
        svg.append(wedge);
      });
      holder.append(svg);

      // The centre readout: the hovered axis said plainly where the eye
      // already is — both values, and who leads. applyHot fills it.
      refs.center = el("div", "sr-mr-center");
      refs.center.setAttribute("aria-hidden", "true");
      holder.append(refs.center);

      maps.forEach((m, i) => {
        const o = pt(i, LBL_R);
        const tag = el("div", "sr-mr-vx");
        refs.vx.set(m.key, tag);
        tag.style.left = ((o.x / R_SIZE) * 100).toFixed(2) + "%";
        tag.style.top = ((o.y / R_SIZE) * 100).toFixed(2) + "%";
        tag.append(el("span", "sr-mr-vxname", mapLabel(m.key)));
        const row = el("span", "sr-mr-vxrow");
        row.append(
          el("span", "sr-mr-vxv--a", fmtMetric(metricOf(m.a, metric, totalA), metric)),
          el("span", "sr-mr-vxsep", "·"),
          el("span", "sr-mr-vxv--b", fmtMetric(metricOf(m.b, metric, totalB), metric)),
        );
        tag.append(row);
        tag.append(el("span", "sr-mr-vxcount", m.a.n + " v " + m.b.n));
        tag.title =
          mapLabel(m.key) + " — " + teamA + " " + m.a.n + " matches, " + teamB + " " + m.b.n + " matches";
        tag.addEventListener("mouseenter", () => setHot(m.key));
        tag.addEventListener("mouseleave", () => setHot(pinned));
        tag.addEventListener("click", () => {
          pinned = pinned === m.key ? null : m.key;
          // setHot alone no-ops when the pinned map is already hot — but the
          // pin marker still has to move.
          setHot(pinned);
          applyHot();
          announce(pinned);
        });
        holder.append(tag);
      });
    }

    // ---- the table: every pool map, all four numbers, cross-highlighting ----
    function drawTable(box) {
      box.textContent = "";
      refs.rows = new Map();
      const d = metricDef(metric);
      const head2 = el("div", "sr-mr-trow sr-mr-trow--head");
      const colHead = (which, team) => {
        const s2 = el("span", "sr-label sr-mr-tnum sr-mr-vxv--" + which, d.head);
        s2.title = team + " — " + d.label;
        return s2;
      };
      head2.append(
        el("span", "sr-label", "Map"),
        colHead("a", teamA),
        colHead("b", teamB),
        el("span", "sr-label sr-mr-tgap", "Edge"),
      );
      box.append(head2);

      const rows = POOL.map((key) => {
        const a = aggA.get(key) || null;
        const b = aggB.get(key) || null;
        const va = metricOf(a, metric, totalA);
        const vb = metricOf(b, metric, totalB);
        return { key, a, b, va, vb, gap: va != null && vb != null ? va - vb : null };
      }).filter((r) => (r.a && r.a.n) || (r.b && r.b.n));

      rows.sort((x, y) => Math.abs(y.gap ?? -1) - Math.abs(x.gap ?? -1));
      const worst = Math.max(1, ...rows.map((r) => Math.abs(r.gap || 0)));

      for (const r of rows) {
        const row = el("div", "sr-mr-trow");
        row.tabIndex = 0;
        refs.rows.set(r.key, row);
        const name = el("span", "sr-mr-tmap", mapLabel(r.key));
        if (!r.a || !r.a.n) name.append(el("span", "sr-mr-tnever sr-mr-vxv--b", "new to " + shortName(teamA)));
        else if (!r.b || !r.b.n) name.append(el("span", "sr-mr-tnever sr-mr-vxv--a", "new to " + shortName(teamB)));
        row.append(name);
        const cell = (v, e, which) => {
          const s = el("span", "sr-mr-tnum sr-mr-vxv--" + which, fmtMetric(v, metric));
          s.title = e && e.n ? e.n + " of " + (which === "a" ? totalA : totalB) + " recent matches" : "Not played recently";
          if (!e || !e.n) s.classList.add("sr-mr-dash");
          return s;
        };
        row.append(cell(r.va, r.a, "a"), cell(r.vb, r.b, "b"));
        const gapBox = el("span", "sr-mr-tgap");
        if (r.gap != null) {
          const bar = el("span", "sr-mr-etrack");
          const fill = el("span", "sr-mr-efill sr-mr-efill--" + (r.gap >= 0 ? "a" : "b"));
          const w = Math.max(6, Math.round((Math.abs(r.gap) / worst) * 100));
          // start at zero and let the bar's own transition carry it in; the
          // double rAF guarantees a painted zero-width frame first
          fill.style.width = "0%";
          requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = w + "%"; }));
          bar.append(fill);
          gapBox.append(bar);
          gapBox.title =
            (r.gap >= 0 ? teamA : teamB) + " ahead by " + fmtMetric(Math.abs(r.gap), metric) + " on " + mapLabel(r.key);
        } else {
          gapBox.append(el("span", "sr-mr-dash", "—"));
        }
        row.append(gapBox);

        const on = () => setHot(r.key);
        const off = () => setHot(pinned);
        row.addEventListener("mouseenter", on);
        row.addEventListener("mouseleave", off);
        row.addEventListener("focus", on);
        row.addEventListener("blur", off);
        row.addEventListener("click", () => {
          pinned = pinned === r.key ? null : r.key;
          setHot(pinned);
          applyHot();
          announce(pinned);
        });
        box.append(row);
      }

      if (unplayed.length) {
        const note = el("div", "sr-mr-tnote");
        note.append(el("span", "sr-label", "Never played"));
        note.append(
          el(
            "span",
            null,
            unplayed
              .slice(0, 3)
              .map((u) => mapLabel(u.key) + " (" + shortName(u.side === "a" ? teamA : teamB) + ")")
              .join(" · "),
          ),
        );
        note.title = "A pool map absent from a team's last 30 is their de-facto permaban";
        box.append(note);
      }
    }

    function shortName(n) {
      return n.length > 14 ? n.slice(0, 14) + "…" : n;
    }

    // Toggle-only: nothing is re-created, so the node under the pointer (or
    // holding focus) survives the highlight it just triggered.
    function applyHot() {
      for (const a of refs.areas) a.classList.toggle("sr-mr-area--muted", !!hot);
      for (const d of refs.dots) {
        const on = !!hot && d.key === hot;
        d.node.classList.toggle("sr-mr-dotpt--hot", on);
        d.node.style.r = on ? "4.5px" : "3px"; // style, not attribute — see draw()
      }
      for (const [k, tag] of refs.vx) tag.classList.toggle("sr-mr-vx--hot", k === hot);
      for (const [k, row] of refs.rows) {
        row.classList.toggle("sr-mr-trow--hot", k === hot);
        row.classList.toggle("sr-mr-trow--pin", !!pinned && k === pinned);
      }
      if (refs.spoke) {
        const i = hot ? maps.findIndex((m) => m.key === hot) : -1;
        if (i >= 0) {
          const p = pt(i, 1.06);
          refs.spoke.setAttribute("x2", p.x.toFixed(1));
          refs.spoke.setAttribute("y2", p.y.toFixed(1));
          refs.spoke.style.display = "";
        } else {
          refs.spoke.style.display = "none";
        }
      }
      if (refs.center) {
        const m = hot ? maps.find((x) => x.key === hot) : null;
        if (m) {
          const va = metricOf(m.a, metric, totalA);
          const vb = metricOf(m.b, metric, totalB);
          refs.center.textContent = "";
          refs.center.append(el("span", "sr-mr-cmap", mapLabel(m.key)));
          const vals = el("span", "sr-mr-cvals");
          vals.append(
            el("span", "sr-mr-vxv--a", fmtMetric(va, metric)),
            el("span", "sr-mr-vxsep", "·"),
            el("span", "sr-mr-vxv--b", fmtMetric(vb, metric)),
          );
          refs.center.append(vals);
          const gap = va != null && vb != null ? va - vb : null;
          if (gap == null) {
            refs.center.append(el("span", "sr-mr-cedge", m.a.n + " v " + m.b.n + " matches"));
          } else if (Math.abs(gap) < (metric === "kd" ? 0.02 : 1)) {
            refs.center.append(el("span", "sr-mr-cedge", "dead even"));
          } else {
            const lead = gap > 0 ? "a" : "b";
            refs.center.append(el("span", "sr-mr-cedge sr-mr-cedge--" + lead,
              shortName(lead === "a" ? teamA : teamB) + " +" + fmtMetric(Math.abs(gap), metric)));
          }
          refs.center.classList.add("sr-mr-center--on");
        } else {
          refs.center.classList.remove("sr-mr-center--on");
        }
      }
    }

    function setHot(key) {
      if (hot === key) return;
      hot = key;
      applyHot();
    }

    function setMetric(next) {
      if (metric === next) return;
      for (const k in btns) btns[k].classList.toggle("sr-mr-tbtn--on", k === next);
      metric = next;
      draw();
      drawTable(side);
      applyHot();
    }

    draw();
    drawTable(side);
    applyHot();
    return panel;
  }
  function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Fewer than three shared maps: a radar would be a line. Say the numbers.
  function flatMapList(maps, metric) {
    const box = el("div", "sr-mr-flat");
    for (const m of maps) {
      const row = el("div", "sr-mr-vrow");
      const fmt = (e) => {
        const v = metricOf(e, metric);
        return v == null ? "—" : metric === "kills" ? v.toFixed(1) : Math.round(v) + "%";
      };
      row.append(
        el("span", "sr-mr-vmap", mapLabel(m.key)),
        el("span", "sr-mr-vnum sr-mr-vnum--a sr-num", fmt(m.a)),
        el("span", "sr-mr-vnum sr-mr-vnum--b sr-num", fmt(m.b)),
      );
      box.append(row);
    }
    return box;
  }

  // ---- footer ------------------------------------------------------------

  function footer() {
    const foot = el("div", "sr-mr-foot");
    const brand = el("a", "sr-mr-wordmark");
    brand.href = "https://csrun.win";
    brand.target = "_blank";
    brand.rel = "noreferrer";
    brand.title = "CSRun — csrun.win";
    brand.append(el("span", null, "CS"), el("b", null, "Run"));
    foot.append(brand, el("span", "sr-mr-note", "estimates, not betting advice"));
    return foot;
  }

  // ---- room lifecycle ----------------------------------------------------

  async function enter(id) {
    state.id = id;
    state.dead = false;
    const g = ++state.gen;

    if (typeof SRApi === "undefined" || !SRApi) {
      state.dead = true;
      return;
    }
    if (!(await allowed())) {
      state.dead = true;
      return;
    }
    if (g !== state.gen) return;

    const mount = insertMount();
    if (!mount) {
      // No host container YET — the room shell renders asynchronously. This is
      // retryable, not terminal: leaving state.dead false lets the observer
      // call us again once the SPA has built the page. (Marking it dead here
      // is what silently disabled the panel on every match room.)
      state.id = null;
      return;
    }
    renderSkeleton(mount);

    let room = null;
    try {
      room = await SRApi.room(id);
    } catch {
      room = null;
    }
    if (g !== state.gen) return;
    if (!room || !Array.isArray(room.teams) || room.teams.length < 2) {
      mount.remove(); // silent no-op — never leave the page looking broken
      // A room fetch that dies during a cold page load is the boot race, not
      // a verdict on the room. Dead used to be terminal until the route
      // changed, which is why the panel sometimes needed a refresh to appear.
      // Three spaced retries first; only then go quiet for the room.
      state.tries += 1;
      if (state.tries <= 3) {
        state.dead = true;
        state.deadUntil = Date.now() + 8000 * state.tries;
        setTimeout(schedule, 8000 * state.tries + 200);
      } else {
        state.dead = true;
        state.deadUntil = 0;
      }
      return;
    }

    state.tries = 0;
    const [ta, tb] = room.teams;
    let avgA = avgElo(ta.roster);
    let avgB = avgElo(tb.roster);

    // Now that the roster is known, walk the panel to it. The room shell and
    // the player cards paint at different times, so this is retried a couple
    // of times rather than assumed to work on the first attempt — without it
    // the panel stays wherever the fallback host put it, which on a Premier
    // room is above FACEIT's entire app.
    const nicks = [...(ta.roster || []), ...(tb.roster || [])]
      .map((m) => m && m.nick)
      .filter(Boolean);
    if (!placeByRoster(mount, nicks)) {
      for (const wait of [600, 1800, 4000]) {
        setTimeout(() => {
          if (g === state.gen) placeByRoster(mount, nicks);
        }, wait);
      }
    }

    mount.textContent = "";
    const teams = el("div", "sr-mr-teams");
    const A = teamCard(ta, avgA, avgB);
    const B = teamCard(tb, avgB, avgA);
    teams.append(A.card, B.card);

    let veto = vetoSkeleton();
    mount.append(teams, veto, footer());

    // Fill in an average the roster did not carry. Same lookup, same cache as
    // the history fetch below, so this is free once that has run.
    if (avgA == null || avgB == null) {
      const resolve = (team) =>
        Promise.all(
          (team.roster || []).slice(0, MAX_PER_TEAM).map((m) =>
            m.elo != null
              ? m.elo
              : m.nick
                ? SRApi.user(m.nick).then((u) => (u ? u.elo : null)).catch(() => null)
                : null,
          ),
        ).then((elos) => {
          const real = elos.filter((e) => typeof e === "number" && e > 0);
          return real.length ? Math.round(real.reduce((x, y) => x + y, 0) / real.length) : null;
        });
      Promise.all([avgA == null ? resolve(ta) : avgA, avgB == null ? resolve(tb) : avgB])
        .then(([a2, b2]) => {
          if (g !== state.gen || !A.card.isConnected) return;
          avgA = a2;
          avgB = b2;
          A.renderRight(avgA, avgB);
          B.renderRight(avgB, avgA);
        })
        .catch(() => {});
    }

    // The radar needs every player's last-30 maps. Per-player DISPLAY now
    // happens inline under FACEIT's own cards (roominline.js), so this only
    // aggregates — and the two modules share api.js's cache, so asking for
    // the same history twice costs one request, not two.
    // A Premier room's roster names its players but does not always carry
    // their FACEIT ids, and history is keyed by id — so skipping the ones
    // without a uuid meant fetching nothing at all and rendering an empty
    // chart. Resolve the id from the nickname first; it is the same lookup the
    // strips do, through the same cache, so it costs one request per player at
    // most and usually none.
    //
    // The whole aggregation RETRIES. It used to run exactly once, at the
    // moment the room was entered — on a cold load the worst moment there is:
    // twenty lookups racing FACEIT's own boot traffic. When they failed, the
    // radar built from empty aggregates and never looked again; the strips
    // healed (roominline retries forever) while the chart stayed gone until a
    // refresh. Now a build that came up empty because lookups FAILED — not
    // because the players genuinely lack history — reruns after the api
    // layer's negative cache has expired, twice at most.
    const runAgg = (attempt) => {
      const aggA = new Map();
      const aggB = new Map();
      const jobs = [];
      let ok = 0;
      let fail = 0;
      const spawn = (team, agg) => {
        for (const p of (team.roster || []).slice(0, MAX_PER_TEAM)) {
          if (!p.uuid && !p.nick) continue;
          jobs.push(
            Promise.resolve()
              .then(() => (p.uuid ? p.uuid : SRApi.user(p.nick).then((u) => (u ? u.uuid : null))))
              .then((uuid) => (uuid ? SRApi.eloHistory(uuid, HIST_N) : null))
              .then((rows) => {
                if (g !== state.gen) return;
                if (Array.isArray(rows)) {
                  addMaps(agg, rows);
                  ok += 1;
                } else {
                  fail += 1;
                }
              })
              .catch(() => {
                fail += 1;
              }),
          );
        }
      };
      spawn(ta, aggA);
      spawn(tb, aggB);

      Promise.allSettled(jobs).then(() => {
        if (g !== state.gen || !veto.isConnected) return;
        const built = radarPanel(aggA, aggB, ta.name, tb.name);
        veto.replaceWith(built);
        veto = built;
        // Rebuild only when failures plausibly cost us the chart: nothing
        // loaded at all, or so little that the radar degraded below three
        // shared maps. Honest scarcity (no failures) is left alone.
        const shared = POOL.filter((k) => {
          const a = aggA.get(k);
          const b = aggB.get(k);
          return a && a.n > 0 && b && b.n > 0;
        }).length;
        if (attempt < 2 && fail > 0 && (ok === 0 || shared < 3)) {
          setTimeout(() => {
            if (g === state.gen && veto.isConnected) runAgg(attempt + 1);
          }, 12000);
        }
      });
    };
    runAgg(0);
  }

  function leave() {
    state.gen += 1; // cancels all in-flight fills
    state.id = null;
    state.dead = false;
    const m = document.getElementById(MOUNT_ID);
    if (m) m.remove();
  }

  // ---- routing -----------------------------------------------------------

  function currentRoomId() {
    const dm = DEV_RE.exec(location.hash || "");
    if (dm) {
      try {
        return decodeURIComponent(dm[1]);
      } catch {
        return dm[1];
      }
    }
    const m = ROOM_RE.exec(location.pathname);
    return m ? m[1] : null;
  }

  function route() {
    const id = currentRoomId();
    if (id === state.id) {
      // A paused retry whose time has come re-enters the same room.
      if (id && state.dead && state.deadUntil && Date.now() >= state.deadUntil) {
        state.dead = false;
        state.deadUntil = 0;
        void enter(id);
        return;
      }
      // SPA re-render may have wiped our mount — re-establish it.
      if (id && !state.dead && !document.getElementById(MOUNT_ID)) void enter(id);
      return;
    }
    state.tries = 0;
    state.deadUntil = 0;
    leave();
    if (id) void enter(id);
  }

  // A back/forward navigation can restore the page from the bfcache: the DOM
  // reappears fully formed, no mutations fire, and nothing wakes us. pageshow
  // is the one signal that covers it.
  window.addEventListener("pageshow", () => schedule());

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      route();
    }, 350); // debounce SPA churn (contract: ≥300ms)
  }

  function init() {
    route();
    const obs = new MutationObserver(schedule);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
  }

  init();
})();
