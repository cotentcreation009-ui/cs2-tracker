// StatRun flagship: the match-room panel. Watches FACEIT's SPA for
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
  const ROOM_RE = /\/cs2\/room\/([^/?#]+)/i;
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
  const state = { id: null, gen: 0, dead: false };

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
      const e = agg.get(key) || { n: 0, w: 0 };
      e.n += 1;
      if (winOf(r)) e.w += 1;
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

  function insertMount() {
    const old = document.getElementById(MOUNT_ID);
    if (old) old.remove();
    const main = document.querySelector("main");
    if (!main) return null; // no stable anchor — degrade to nothing
    const mount = el("div", "sr-reset sr-mr");
    mount.id = MOUNT_ID;
    const anchor = main.firstElementChild;
    if (anchor) main.insertBefore(mount, anchor);
    else main.appendChild(mount);
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
    for (let i = 0; i < MAX_PER_TEAM; i++) card.append(skelRow());
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
      a.title = "VAC/game ban on record — view on StatRun";
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
        " — view on StatRun";
      a.setAttribute("aria-label", a.title);
      a.append(el("span", "sr-mr-cmdot"), el("span", null, String(cheat.score)));
      return a;
    }
    a.classList.add("sr-mr-cm--neutral");
    a.title = "View this player on StatRun";
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

  function teamCard(team, ownAvg, oppAvg) {
    const card = el("section", "sr-mr-card");

    const head = el("header", "sr-mr-head");
    const name = el("h3", "sr-mr-teamname", String(team.name || "Team"));
    name.title = String(team.name || "Team");
    const right = el("div", "sr-mr-headright");
    const avg = el("span", "sr-mr-avg");
    avg.append(el("span", "sr-label", "avg"));
    avg.append(
      ownAvg != null
        ? el("span", "sr-mr-avgval sr-num", fmtInt(ownAvg))
        : el("span", "sr-mr-dash", "—"),
    );
    avg.title = "Average FACEIT elo of this roster";
    right.append(avg);
    if (ownAvg != null && oppAvg != null) {
      const p = predict(ownAvg, oppAvg);
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
    head.append(name, right);
    card.append(head);

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

  function vetoPanel(aggA, aggB, nameA, nameB) {
    const panel = el("section", "sr-veto-panel");

    const head = el("div", "sr-mr-vhead");
    const hA = el("span", "sr-mr-vteam sr-mr-vteam--a", String(nameA || "Team A"));
    hA.title = String(nameA || "Team A");
    const hB = el("span", "sr-mr-vteam sr-mr-vteam--b", String(nameB || "Team B"));
    hB.title = String(nameB || "Team B");
    head.append(
      el("span", "sr-label sr-mr-vh-map", "Map"),
      hA,
      el("span", "sr-label sr-mr-vh-mid", "Last 30"),
      hB,
    );
    panel.append(head);

    const keys = new Set([...aggA.keys(), ...aggB.keys()]);
    if (!keys.size) {
      panel.append(el("div", "sr-mr-empty", "No recent map data"));
      return panel;
    }

    const maps = [...keys].map((key) => ({
      key,
      a: aggA.get(key) || { n: 0, w: 0 },
      b: aggB.get(key) || { n: 0, w: 0 },
    }));
    maps.sort((x, y) => y.a.n + y.b.n - (x.a.n + x.b.n) || x.key.localeCompare(y.key));

    const maxN = Math.max(1, ...maps.map((m) => Math.max(m.a.n, m.b.n)));
    const topA = Math.max(...maps.map((m) => m.a.n));
    const topB = Math.max(...maps.map((m) => m.b.n));

    const num = (e, top, side) => {
      const s = el("span", "sr-mr-vnum sr-num sr-mr-vnum--" + side);
      if (!e.n) {
        s.classList.add("sr-mr-dash");
        s.textContent = "—";
        s.title = "Not played in the last 30";
      } else {
        s.textContent = e.n + " · " + Math.round((e.w / e.n) * 100) + "%";
        s.title = e.n + " played, " + e.w + " won" + (top ? " — most played" : "");
        if (top) s.classList.add("sr-mr-vnum--top");
      }
      return s;
    };
    const half = (n, top, side) => {
      const wrap = el("span", "sr-mr-vhalf sr-mr-vhalf--" + side);
      if (n > 0) {
        const bar = el("span", "sr-mr-vbar" + (top ? " sr-mr-vbar--top" : ""));
        bar.style.width = Math.max(4, Math.round((n / maxN) * 100)) + "%";
        wrap.append(bar);
      }
      return wrap;
    };

    for (const m of maps) {
      const isTopA = m.a.n > 0 && m.a.n === topA;
      const isTopB = m.b.n > 0 && m.b.n === topB;
      const row = el("div", "sr-mr-vrow");
      const bars = el("span", "sr-mr-vbars");
      bars.append(half(m.a.n, isTopA, "a"), half(m.b.n, isTopB, "b"));
      row.append(
        el("span", "sr-mr-vmap", mapLabel(m.key)),
        num(m.a, isTopA, "a"),
        bars,
        num(m.b, isTopB, "b"),
      );
      panel.append(row);
    }
    return panel;
  }

  // ---- footer ------------------------------------------------------------

  function footer() {
    const foot = el("div", "sr-mr-foot");
    const brand = el("a", "sr-mr-wordmark");
    brand.href = "https://csrun.win";
    brand.target = "_blank";
    brand.rel = "noreferrer";
    brand.title = "StatRun — csrun.win";
    brand.append(el("span", null, "Stat"), el("b", null, "Run"));
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
      state.dead = true;
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
      state.dead = true;
      return;
    }

    const [ta, tb] = room.teams;
    const avgA = avgElo(ta.roster);
    const avgB = avgElo(tb.roster);

    mount.textContent = "";
    const teams = el("div", "sr-mr-teams");
    const A = teamCard(ta, avgA, avgB);
    const B = teamCard(tb, avgB, avgA);
    teams.append(A.card, B.card);

    let veto = vetoSkeleton();
    mount.append(teams, veto, footer());

    // Per player (max 10, all in parallel): last-30 form + CheatMeter read.
    // Rows fill progressively as each promise lands.
    const aggA = new Map();
    const aggB = new Map();
    const histJobs = [];
    const spawn = (handles, agg) => {
      for (const h of handles) {
        const p = h.p;
        histJobs.push(
          Promise.resolve()
            .then(() => (p.uuid ? SRApi.eloHistory(p.uuid, HIST_N) : null))
            .then((rows) => {
              if (g !== state.gen) return;
              fillForm(h.cells, computeForm(rows));
              if (Array.isArray(rows)) addMaps(agg, rows);
            })
            .catch(() => {
              if (g === state.gen) fillForm(h.cells, null);
            }),
        );
        Promise.resolve()
          .then(() => {
            const q = p.steam64
              ? { steamid: String(p.steam64) }
              : p.nick
                ? { faceit: String(p.nick) }
                : null;
            return q ? SRApi.cheatmeter(q) : null;
          })
          .then((data) => {
            if (g === state.gen) fillCM(h.cells, data);
          })
          .catch(() => {
            if (g === state.gen) fillCM(h.cells, null);
          });
      }
    };
    spawn(A.handles, aggA);
    spawn(B.handles, aggB);

    Promise.allSettled(histJobs).then(() => {
      if (g !== state.gen || !veto.isConnected) return;
      const built = vetoPanel(aggA, aggB, ta.name, tb.name);
      veto.replaceWith(built);
      veto = built;
    });
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
      // SPA re-render may have wiped our mount — re-establish it.
      if (id && !state.dead && !document.getElementById(MOUNT_ID)) void enter(id);
      return;
    }
    leave();
    if (id) void enter(id);
  }

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
