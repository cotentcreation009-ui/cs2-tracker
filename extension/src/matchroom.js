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
      const e = agg.get(key) || { n: 0, w: 0, kills: 0, kn: 0 };
      e.n += 1;
      if (winOf(r)) e.w += 1;
      if (typeof r.kills === "number") {
        e.kills += r.kills;
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

  function insertMount() {
    const old = document.getElementById(MOUNT_ID);
    if (old) old.remove();
    const host = hostEl();
    if (!host) return null; // no stable anchor — degrade to nothing
    const mount = el("div", "sr-reset sr-mr");
    mount.id = MOUNT_ID;
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
    if (SUMMARY_ONLY) return { card, handles: [] };

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
  const R_MAX = 74;

  function metricOf(e, metric) {
    if (!e || !e.n) return null;
    if (metric === "kills") return e.kn ? e.kills / e.kn : null;
    return (e.w / e.n) * 100;
  }

  function radarPanel(aggA, aggB, nameA, nameB) {
    const panel = el("section", "sr-veto-panel");
    let metric = "winrate";

    const keys = new Set([...aggA.keys(), ...aggB.keys()]);
    if (!keys.size) {
      panel.append(el("div", "sr-mr-empty", "No recent map data"));
      return panel;
    }

    const head = el("div", "sr-mr-rhead");
    const title = el("span", "sr-label", "Map form");
    const toggle = el("div", "sr-mr-toggle");
    const bWin = el("button", "sr-mr-tbtn sr-mr-tbtn--on", "Win rate");
    const bKil = el("button", "sr-mr-tbtn", "Avg kills");
    bWin.type = "button";
    bKil.type = "button";
    toggle.append(bWin, bKil);
    const scope = el("span", "sr-label sr-mr-rscope", "Last 30");
    head.append(title, toggle, scope);

    const legend = el("div", "sr-mr-legend");
    const lg = (name, side) => {
      const s = el("span", "sr-mr-lg sr-mr-lg--" + side);
      s.append(el("span", "sr-mr-lgdot"), el("span", null, String(name || (side === "a" ? "Team A" : "Team B"))));
      s.title = String(name || "");
      return s;
    };
    legend.append(lg(nameA, "a"), lg(nameB, "b"));

    const holder = el("div", "sr-mr-radar");
    const edges = el("div", "sr-mr-edges");
    const body = el("div", "sr-mr-rbody");
    body.append(holder, edges);
    panel.append(head, legend, body);

    // Spokes are the active-duty pool ONLY, and only where BOTH teams have
    // played: a retired map nobody vetoes is noise, and a map one side has
    // never touched collapsed that side's polygon to the centre, which is
    // what made the chart look broken. Alphabetical so the shape means the
    // same thing from one room to the next.
    const paired = POOL.filter((key) => {
      const a = aggA.get(key);
      const b = aggB.get(key);
      return a && a.n > 0 && b && b.n > 0;
    });
    const maps = paired.map((key) => ({ key, a: aggA.get(key), b: aggB.get(key) }));

    // Maps one side has never played are the loudest veto signal there is, so
    // they get said out loud instead of drawn as a spike.
    const unplayed = POOL.map((key) => {
      const a = aggA.get(key);
      const b = aggB.get(key);
      const aN = a ? a.n : 0;
      const bN = b ? b.n : 0;
      if (aN === 0 && bN === 0) return null; // neither plays it — not a signal
      if (aN === 0) return { key, side: "a" };
      if (bN === 0) return { key, side: "b" };
      return null;
    }).filter(Boolean);

    if (maps.length < 3) {
      // A polygon needs three points to say anything — fall back to a list.
      holder.append(flatMapList(maps, metric));
      return panel;
    }

    function draw() {
      holder.textContent = "";
      const N = maps.length;
      const vals = [];
      for (const m of maps) {
        vals.push(metricOf(m.a, metric), metricOf(m.b, metric));
      }
      const real = vals.filter((v) => v != null);
      const hi = metric === "kills" ? Math.max(24, Math.ceil(Math.max(...real) + 2)) : 100;
      const lo = 0;
      const frac = (v) => (v == null ? 0 : clampNum((v - lo) / (hi - lo), 0.04, 1));

      const ang = (i) => -Math.PI / 2 + (i / N) * Math.PI * 2;
      const pt = (i, f) => ({
        x: R_C + Math.cos(ang(i)) * R_MAX * f,
        y: R_C + Math.sin(ang(i)) * R_MAX * f,
      });

      const svg = svgEl("svg", {
        viewBox: "0 0 " + R_SIZE + " " + R_SIZE,
        class: "sr-mr-rsvg",
        role: "img",
        "aria-label":
          "Per-map " + (metric === "kills" ? "average kills" : "win rate") + " for both teams over their last 30 matches",
      });

      // rings + spokes
      for (const f of [0.25, 0.5, 0.75, 1]) {
        svg.append(
          svgEl("polygon", {
            class: "sr-mr-ring" + (f === 0.5 ? " sr-mr-ring--mid" : ""),
            points: maps.map((_, i) => { const p = pt(i, f); return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" "),
          }),
        );
      }
      maps.forEach((_, i) => {
        const p = pt(i, 1);
        svg.append(svgEl("line", { class: "sr-mr-spoke", x1: R_C, y1: R_C, x2: p.x.toFixed(1), y2: p.y.toFixed(1) }));
      });

      const poly = (side) => {
        const pts = maps.map((m, i) => pt(i, frac(metricOf(side === "a" ? m.a : m.b, metric))));
        svg.append(
          svgEl("polygon", {
            class: "sr-mr-area sr-mr-area--" + side,
            points: pts.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" "),
          }),
        );
        pts.forEach((p, i) => {
          const e = side === "a" ? maps[i].a : maps[i].b;
          if (!e || !e.n) return;
          svg.append(svgEl("circle", { class: "sr-mr-dotpt sr-mr-dotpt--" + side, cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 2.5 }));
        });
      };
      poly("a");
      poly("b");
      holder.append(svg);

      drawRead(edges, maps, unplayed, metric, nameA, nameB);

      // vertex labels, positioned outside the ring
      maps.forEach((m, i) => {
        const o = pt(i, 1.3);
        const tag = el("div", "sr-mr-vx");
        tag.style.left = ((o.x / R_SIZE) * 100).toFixed(2) + "%";
        tag.style.top = ((o.y / R_SIZE) * 100).toFixed(2) + "%";
        const val = (e, side) => {
          const v = metricOf(e, metric);
          const s = el("span", "sr-mr-vxv sr-mr-vxv--" + side);
          s.textContent = v == null ? "—" : metric === "kills" ? v.toFixed(1) : Math.round(v) + "%";
          s.title = e && e.n ? e.n + " played" : "Not played in the last 30";
          return s;
        };
        tag.append(el("span", "sr-mr-vxname", mapLabel(m.key)));
        const row = el("span", "sr-mr-vxrow");
        row.append(val(m.a, "a"), el("span", "sr-mr-vxsep", "·"), val(m.b, "b"));
        tag.append(row);
        const n = el("span", "sr-mr-vxn", (m.a ? m.a.n : 0) + " v " + (m.b ? m.b.n : 0));
        n.title = "Matches played on this map in each team's last 30";
        tag.append(n);
        holder.append(tag);
      });
    }

    function setMetric(next, onBtn, offBtn) {
      if (metric === next) return;
      metric = next;
      onBtn.classList.add("sr-mr-tbtn--on");
      offBtn.classList.remove("sr-mr-tbtn--on");
      draw();
    }
    bWin.addEventListener("click", () => setMetric("winrate", bWin, bKil));
    bKil.addEventListener("click", () => setMetric("kills", bKil, bWin));

    draw();
    return panel;
  }

  // The radar shows the shape; this says what to DO with it. Deliberately NOT
  // a re-listing of every map — the chart already names them, and repeating
  // the same seven labels beside it read as duplication. Only the decisions:
  // where each side is strongest, and any map a side has never played.
  function drawRead(box, maps, unplayed, metric, nameA, nameB) {
    box.textContent = "";
    box.append(el("div", "sr-label", "Veto read"));

    const rows = maps
      .map((m) => {
        const a = metricOf(m.a, metric);
        const b = metricOf(m.b, metric);
        return a == null || b == null ? null : { key: m.key, gap: a - b };
      })
      .filter(Boolean)
      .sort((x, y) => y.gap - x.gap);

    const teamA = String(nameA || "Team A");
    const teamB = String(nameB || "Team B");
    const unit = (v) => (metric === "kills" ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v)) + "pp");

    const line = (label, mapKey, amt, side, why) => {
      const r = el("div", "sr-mr-read");
      r.append(el("span", "sr-mr-readk", label));
      const v = el("span", "sr-mr-readv");
      v.append(el("span", "sr-mr-readmap", mapLabel(mapKey)));
      if (amt != null) v.append(el("span", "sr-mr-eamt sr-mr-vxv--" + side, "+" + unit(amt)));
      r.title = why;
      r.append(v);
      box.append(r);
    };

    if (rows.length) {
      const best = rows[0];
      const worst = rows[rows.length - 1];
      if (best.gap > 0) {
        line("Your edge", best.key, best.gap, "a", teamA + " is strongest here relative to " + teamB);
      }
      if (worst.gap < 0) {
        line("Their edge", worst.key, worst.gap, "b", teamB + " is strongest here relative to " + teamA);
      }
      if (best.gap <= 0 && worst.gap >= 0) {
        box.append(el("div", "sr-mr-empty", "No clear edge either way"));
      }
    }

    for (const u of unplayed.slice(0, 3)) {
      const who = u.side === "a" ? teamA : teamB;
      const r = el("div", "sr-mr-read");
      r.append(el("span", "sr-mr-readk", "Never played"));
      const v = el("span", "sr-mr-readv");
      v.append(el("span", "sr-mr-readmap", mapLabel(u.key)));
      v.append(el("span", "sr-mr-eamt sr-mr-vxv--" + u.side, who.length > 12 ? who.slice(0, 12) + "…" : who));
      r.title = who + " has not played " + mapLabel(u.key) + " in their last 30 matches";
      r.append(v);
      box.append(r);
    }

    if (!box.querySelector(".sr-mr-read")) {
      box.append(el("div", "sr-mr-empty", "Not enough shared maps"));
    }
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

    // The radar needs every player's last-30 maps. Per-player DISPLAY now
    // happens inline under FACEIT's own cards (roominline.js), so this only
    // aggregates — and the two modules share api.js's cache, so asking for
    // the same history twice costs one request, not two.
    const aggA = new Map();
    const aggB = new Map();
    const histJobs = [];
    const spawn = (team, agg) => {
      for (const p of (team.roster || []).slice(0, MAX_PER_TEAM)) {
        if (!p.uuid) continue;
        histJobs.push(
          Promise.resolve()
            .then(() => SRApi.eloHistory(p.uuid, HIST_N))
            .then((rows) => {
              if (g !== state.gen) return;
              if (Array.isArray(rows)) addMaps(agg, rows);
            })
            .catch(() => {}),
        );
      }
    };
    spawn(ta, aggA);
    spawn(tb, aggB);

    Promise.allSettled(histJobs).then(() => {
      if (g !== state.gen || !veto.isConnected) return;
      const built = radarPanel(aggA, aggB, ta.name, tb.name);
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
