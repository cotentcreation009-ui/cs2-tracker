// Steam profile content script — injects the CSRun sr-steam-panel under the
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
.sr-steam-panel{width:100%;margin:12px 0;background:linear-gradient(180deg,color-mix(in srgb,var(--sr-panel2) 88%,var(--sr-brand)) 0%,var(--sr-panel) 34%,color-mix(in srgb,var(--sr-bg) 30%,var(--sr-panel)) 100%);border:1px solid var(--sr-line);border-radius:var(--sr-r-panel);box-shadow:var(--sr-shadow),inset 0 1px 0 rgb(255 255 255/.05);color:var(--sr-ink);font-family:var(--sr-font);font-size:12px;line-height:1.35;font-variant-numeric:tabular-nums;text-align:left;overflow:hidden}

/* hero: the rank badge, who they are, and the one verdict — the shape the
   reference card gets right. The badge is the anchor and everything else
   hangs off it, rather than a row of equal-weight cells with no focal point. */
.sr-steam-hero{display:flex;align-items:center;gap:16px;padding:16px 18px 14px}
/* Drawn with a conic gradient rather than SVG on purpose: tokens.css resets
   every descendant with all:revert, and in Chrome an SVG circle's r/cx/cy
   ARE css properties — so the reset collapsed the ring to r=0 and it silently
   never appeared. A gradient background survives the same reset. The inner
   disc is a pseudo-element, which the universal selector does not match. */
.sr-steam-ring{position:relative;flex:none;width:62px;height:62px;border-radius:50%;background:conic-gradient(var(--lvl,var(--sr-brand)) calc(var(--pct,0) * 1%), var(--sr-line2) 0);box-shadow:0 0 20px color-mix(in srgb,var(--lvl,var(--sr-brand)) 22%,transparent)}
.sr-steam-ring::after{content:"";position:absolute;inset:5px;border-radius:50%;background:linear-gradient(180deg,color-mix(in srgb,var(--sr-panel2) 80%,var(--sr-panel)),var(--sr-panel))}
.sr-steam-ring--na{background:var(--sr-line)}
.sr-steam-ringnum{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:800;line-height:1;color:var(--lvl,var(--sr-ink));text-shadow:0 0 12px color-mix(in srgb,var(--lvl,var(--sr-ink)) 35%,transparent)}
.sr-steam-ringnum--na{font-size:15px;font-weight:700;color:var(--sr-faint)}
.sr-steam-id{min-width:0;flex:1 1 auto}
.sr-steam-name{display:flex;align-items:center;gap:7px;font-size:18px;font-weight:800;letter-spacing:-0.01em;color:var(--sr-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-steam-flag{flex:none;padding:1px 5px;border-radius:3px;background:var(--sr-panel2);border:1px solid var(--sr-line2);font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--sr-muted)}
.sr-steam-meta{margin-top:4px;font-size:11px;letter-spacing:.01em;color:var(--sr-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-steam-meta b{color:var(--sr-orange);font-weight:700}

/* the divided figure strip */
.sr-steam-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid var(--sr-line);background:color-mix(in srgb,var(--sr-bg) 45%,transparent)}\n/* the sampled-performance row sits a shade quieter than the headline strip */\n.sr-steam-grid--perf{background:color-mix(in srgb,var(--sr-bg) 25%,transparent)}\n.sr-steam-grid--perf .sr-steam-val{font-size:15px}\n.sr-steam-grid--perf .sr-steam-cell{padding:10px 18px 11px}
.sr-steam-cell{min-width:0;padding:13px 18px}
.sr-steam-cell+.sr-steam-cell{border-left:1px solid color-mix(in srgb,var(--sr-line) 65%,transparent)}
.sr-steam-cell .sr-label{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:9px;letter-spacing:.11em;order:2;margin-top:5px}
.sr-steam-cell{display:flex;flex-direction:column}
.sr-steam-val{display:flex;align-items:center;gap:5px;order:1;font-size:18px;font-weight:700;color:var(--sr-ink);white-space:nowrap;line-height:1.1}
.sr-steam-val--na{color:var(--sr-faint);font-weight:400;font-size:15px}
.sr-steam-score{font-size:17px;font-weight:700;color:var(--band)}
.sr-steam-plate{display:inline-flex;align-items:center;padding:1px 7px;border-radius:var(--sr-r-chip);font-size:15px;font-weight:700;color:color-mix(in srgb, var(--tier) 62%, white);background:color-mix(in srgb,var(--tier) 12%,transparent);border:1px solid color-mix(in srgb,var(--tier) 45%,transparent)}
.sr-steam-lvl{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:var(--sr-r-chip);font-size:11px;font-weight:700;line-height:1}
.sr-steam-elo{color:var(--sr-orange)}

/* rank by year */
.sr-steam-years{border-top:1px solid var(--sr-line);padding:12px 18px 14px}
.sr-steam-yearrow{display:grid;grid-template-columns:42px 24px 1fr auto;align-items:center;gap:12px;padding:6px 0}

.sr-steam-year{font-size:12px;font-weight:700;color:var(--sr-muted)}
.sr-steam-ylvl{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:var(--sr-r-chip);font-size:11px;font-weight:700;line-height:1}
.sr-steam-ybar{position:relative;height:6px;border-radius:3px;background:color-mix(in srgb,var(--sr-line) 55%,transparent)}
.sr-steam-ybarfill{position:absolute;left:0;top:0;height:100%;border-radius:3px;background:linear-gradient(90deg,color-mix(in srgb,var(--lvl,var(--sr-brand)) 25%,transparent),var(--lvl,var(--sr-brand)))}.sr-steam-ybarfill::after{content:"";position:absolute;right:-2px;top:50%;transform:translateY(-50%);width:10px;height:10px;border-radius:50%;background:var(--lvl,var(--sr-brand));box-shadow:0 0 10px color-mix(in srgb,var(--lvl,var(--sr-brand)) 65%,transparent),inset 0 0 0 2px color-mix(in srgb,#fff 25%,transparent)}
.sr-steam-ymeta{font-size:11px;color:var(--sr-faint);white-space:nowrap;text-align:right}
.sr-steam-ymeta b{color:var(--sr-orange);font-weight:700}

.sr-steam-heroright{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:none}\n.sr-steam-formbox{display:inline-flex;align-items:center;gap:7px}\n.sr-steam-form{display:inline-flex;align-items:center;gap:4px}\n.sr-steam-fdot{width:8px;height:8px}\n.sr-steam-fdot--w{border-radius:50%;background:var(--sr-good)}\n.sr-steam-fdot--l{border-radius:2px;background:var(--sr-bad)}\n.sr-steam-streak{font-size:10px;font-weight:700;color:var(--sr-good);letter-spacing:.04em}\n.sr-steam-bandchip{display:inline-flex;align-items:center;gap:5px;flex:none;padding:3px 8px;border-radius:var(--sr-r-chip);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--band);background:color-mix(in srgb,var(--band) 12%,transparent);border:1px solid color-mix(in srgb,var(--band) 40%,transparent)}
.sr-steam-bandchip--severe{box-shadow:0 0 8px color-mix(in srgb,var(--band) 25%,transparent)}
.sr-steam-dot{width:6px;height:6px;border-radius:50%;background:var(--band)}
.sr-steam-ban{padding:8px 14px;border-top:1px solid var(--sr-line);background:color-mix(in srgb,var(--sr-bad) 12%,transparent);color:var(--sr-bad);font-size:11px;font-weight:700}
.sr-steam-empty{padding:16px 12px;font-size:11px;color:var(--sr-faint);text-align:center}
.sr-steam-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--sr-line);padding:0 14px}
.sr-steam-brand{font-size:11px;font-weight:700;color:var(--sr-ink);white-space:nowrap}
.sr-steam-brand b{font-weight:700;color:var(--sr-brand)}
.sr-steam-foot a{display:block;padding:9px 0;font-size:11px;font-weight:700;color:var(--sr-brand) !important;text-decoration:none !important}
.sr-steam-foot a:hover{text-decoration:underline !important}
.sr-steam-foot a:focus-visible{outline:2px solid var(--sr-brand);outline-offset:-2px}
.sr-steam-skel-label{width:56px;height:12px}
.sr-steam-skel-value{width:72px;height:16px;margin-top:8px}
@media (max-width:620px){.sr-steam-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.sr-steam-cell:nth-child(n+4){border-top:1px solid var(--sr-line)}.sr-steam-cell:nth-child(4){border-left:0}}
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

  // The persona name, from the same inline blob the SteamID comes from. When
  // the lookup returns no name (Leetify and FACEIT both unaware of the
  // account), the card said "This player" while the page banner right above it
  // said who they are — read from script text, never executed.
  function personaName() {
    for (const sc of document.scripts) {
      const t = sc.textContent || "";
      const m = t.match(/g_rgProfileData\s*=\s*\{[^]*?"personaname"\s*:\s*"((?:[^"\\]|\\.){1,64})"/);
      if (m) {
        try {
          return JSON.parse('"' + m[1] + '"');
        } catch {
          return null;
        }
      }
    }
    return null;
  }

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


  // Colour as a second channel: thresholds shared with the match-room strip so
  // the same number never reads good on one surface and neutral on another.
  function gradeHex(v, good, bad) {
    if (v == null) return null;
    if (v >= good) return "var(--sr-good)";
    if (v < bad) return "var(--sr-bad)";
    return null;
  }

  function perfCell(label, value, hex, title) {
    const c = statCell(label, title);
    if (value == null) {
      c.appendChild(naRow());
      return c;
    }
    const v = el("div", "sr-steam-val", value);
    if (hex) v.style.color = hex;
    c.appendChild(v);
    return c;
  }

  // The sampled performance figures — the same numbers the match-room strip
  // shows, so a player reads one story on both surfaces. Rendered only when
  // the stats block arrived at all; a payload from before it existed gets the
  // old card, not a row of dashes.
  function perfRow(st) {
    if (!st || typeof st !== "object") return null;
    const have = ["rating", "adr", "kr", "hsPct", "winRatePct"].filter(
      (k) => typeof st[k] === "number" && isFinite(st[k]) && st[k] > 0,
    );
    if (have.length < 2) return null;

    const n = posNum(st.recentMatches) || 0;
    const sampled = n ? " over their last " + n + " matches" : "";
    const grid = el("div", "sr-steam-grid sr-steam-grid--perf");
    grid.appendChild(perfCell(
      "Rating",
      posNum(st.rating) ? st.rating.toFixed(2) : null,
      gradeHex(st.rating, 1.1, 0.95),
      "HLTV Rating 1.0" + sampled,
    ));
    grid.appendChild(perfCell(
      "ADR",
      posNum(st.adr) ? String(Math.round(st.adr)) : null,
      gradeHex(st.adr, 85, 65),
      "Average damage per round" + sampled,
    ));
    grid.appendChild(perfCell(
      "K/R",
      posNum(st.kr) ? st.kr.toFixed(2) : null,
      null,
      "Kills per round" + sampled,
    ));
    grid.appendChild(perfCell(
      "HS",
      posNum(st.hsPct) ? Math.round(st.hsPct) + "%" : null,
      null,
      "Headshot percentage, all time on FACEIT",
    ));
    grid.appendChild(perfCell(
      "Win",
      posNum(st.winRatePct) ? Math.round(st.winRatePct) + "%" : null,
      gradeHex(st.winRatePct, 55, 45),
      "Win rate, all time on FACEIT",
    ));
    return grid;
  }

  // Their last five FACEIT results, newest first, as marks a colour-blind
  // reader can still split: a round dot for a win, a square for a loss — the
  // same convention the profile card's match list uses.
  function formCluster(d) {
    const rows = Array.isArray(d.recentResults) ? d.recentResults.slice(0, 5) : [];
    if (!rows.length) return null;
    const box = el("div", "sr-steam-formbox");
    const dots = el("span", "sr-steam-form");
    let wins = 0;
    for (const r of rows) {
      const won = r === "1" || r === 1;
      if (won) wins += 1;
      dots.appendChild(el("span", "sr-steam-fdot" + (won ? " sr-steam-fdot--w" : " sr-steam-fdot--l")));
    }
    box.appendChild(dots);
    const streak = posNum(d.winStreak) || 0;
    if (streak >= 2) {
      box.appendChild(el("span", "sr-steam-streak", "W" + streak));
    }
    box.title =
      "Last " + rows.length + " FACEIT matches, newest first: " + wins + " won" +
      (streak >= 2 ? " \u00b7 on a " + streak + "-win streak" : "");
    return box;
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


  // The rank badge: a ring filled to their progress through the current level,
  // with the level in the level's own colour. At level 10 the ring is full,
  // because there is nothing above it to be part-way towards.
  // The official ladder colours. Borrowed as a VALUE rather than by adding
  // .sr-lvl to the ring — that class also carries a border and a tinted fill,
  // which turned the ring into a square chip with the arc invisible inside it.
  const LEVEL_HEX = [
    "#eeeeee", "#47e36c", "#47e36c", "#ffc659", "#ffc659",
    "#ffc659", "#ffc659", "#ff8a50", "#ff8a50", "#fe1f00",
  ];

  function levelRing(level, elo) {
    const box = el("div", "sr-steam-ring");
    const lvl = level > 0 ? level : 0;
    if (lvl) box.style.setProperty("--lvl", LEVEL_HEX[lvl - 1]);

    // Progress through the current level. Level 10 has nothing above it, so the
    // ring reads full rather than pretending at a fraction.
    let pct = 100;
    if (lvl >= 1 && lvl < 10 && elo > 0) {
      const floor = LEVEL_FLOORS[lvl - 1];
      const next = LEVEL_FLOORS[lvl];
      pct = Math.max(4, Math.min(100, Math.round(((elo - floor) / (next - floor)) * 100)));
    }
    box.style.setProperty("--pct", String(lvl ? pct : 0));
    if (!lvl) box.classList.add("sr-steam-ring--na");

    const num = el("div", "sr-steam-ringnum" + (lvl ? "" : " sr-steam-ringnum--na"), lvl ? String(lvl) : "—");
    box.appendChild(num);
    box.title = lvl
      ? "FACEIT level " + lvl + (elo > 0 ? " · " + Number(elo).toLocaleString("en-US") + " elo" +
          (lvl < 10 ? " · " + pct + "% of the way to level " + (lvl + 1) : "") : "")
      : "No FACEIT level on record";
    return box;
  }

  function hero(d, cheat, band) {
    const lvl = posNum(d.faceitLevel) || (posNum(d.faceitElo) ? levelFromElo(d.faceitElo) : 0);
    const elo = posNum(d.faceitElo) || 0;

    const wrap = el("div", "sr-steam-hero");
    wrap.appendChild(levelRing(lvl, elo));

    const id = el("div", "sr-steam-id");
    const name = el("div", "sr-steam-name");
    name.appendChild(document.createTextNode(String(d.name || personaName() || "This player")));
    if (typeof d.country === "string" && /^[a-z]{2}$/i.test(d.country)) {
      // Windows ships no flag glyphs, so an emoji flag degrades to two bare
      // capitals floating beside the name. The country code as a small tag is
      // what that actually is, and it reads the same on every platform.
      const f = el("span", "sr-steam-flag", d.country.toUpperCase());
      f.title = "Country: " + d.country.toUpperCase();
      name.appendChild(f);
    }
    id.appendChild(name);

    const meta = el("div", "sr-steam-meta");
    if (lvl && elo) {
      meta.appendChild(document.createTextNode("FACEIT level " + lvl + " · "));
      meta.appendChild(el("b", null, Number(elo).toLocaleString("en-US")));
      meta.appendChild(document.createTextNode(" elo"));
    } else {
      meta.appendChild(document.createTextNode("No FACEIT rank on record"));
    }
    // Volume and age — the two numbers anyone suspicious of an account checks
    // first. A thousand matches since 2019 and thirty matches since last month
    // are different players wearing the same level.
    const st = d.stats || {};
    const matches = posNum(st.matches);
    if (matches) {
      meta.appendChild(document.createTextNode(" · " + matches.toLocaleString("en-US") + " matches"));
    }
    if (typeof st.firstMatch === "string") {
      const t = Date.parse(st.firstMatch);
      if (isFinite(t)) {
        meta.appendChild(document.createTextNode(" · since " + new Date(t).getFullYear()));
      }
    }
    id.appendChild(meta);
    wrap.appendChild(id);

    const right = el("div", "sr-steam-heroright");
    if (cheat && band) {
      const chip = el("span", "sr-steam-bandchip" + (cheat.band === "severe" ? " sr-steam-bandchip--severe" : ""));
      chip.title = DISCLAIMER;
      chip.appendChild(el("span", "sr-steam-dot"));
      chip.appendChild(document.createTextNode(band.word));
      right.appendChild(chip);
    }
    const form = formCluster(d);
    if (form) right.appendChild(form);
    if (right.childNodes.length) wrap.appendChild(right);
    return wrap;
  }

  // Rank across the years they have played. FACEIT elo has no seasons — no
  // reset, no numbered period — so this says "by year" rather than inventing
  // one. Years with too little play to characterise are dropped upstream.
  function yearsBlock(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    const wrap = el("div", "sr-steam-years");
    wrap.appendChild(el("span", "sr-label", "FACEIT rank by year"));

    // A shared elo scale across the years shown. Scaling each bar to the best
    // peak looked broken for a stable player: four years within a hundred elo
    // of each other all rendered as full-width bars. The scale is therefore
    // anchored to the data BUT never allowed to span less than 400 elo — one
    // level's worth — so a flat career reads as markers clustered mid-track
    // (which is the truth) instead of tiny differences stretched to the full
    // width (which would be noise dressed as movement).
    const peaks = rows.map((r) => posNum(r.peakElo) || 0).filter(Boolean);
    let lo = 0, hi = 1;
    if (peaks.length) {
      hi = Math.max.apply(null, peaks);
      lo = Math.min.apply(null, peaks);
      const MIN_SPAN = 400;
      if (hi - lo < MIN_SPAN) {
        const mid = (hi + lo) / 2;
        lo = Math.max(0, mid - MIN_SPAN / 2);
        hi = lo + MIN_SPAN;
      }
      const pad = Math.round((hi - lo) * 0.08);
      lo = Math.max(0, lo - pad);
      hi = hi + pad;
    }

    for (const r of rows) {
      const row = el("div", "sr-steam-yearrow");
      row.appendChild(el("span", "sr-steam-year", String(r.year)));

      const lvl = posNum(r.peakLevel) || (posNum(r.peakElo) ? levelFromElo(r.peakElo) : 0);
      const badge = el("span", "sr-steam-ylvl" + (lvl ? " sr-lvl sr-lvl-" + lvl : ""), lvl ? String(lvl) : "\u2014");
      badge.title = lvl ? "Highest level reached in " + r.year : "No level recorded";
      row.appendChild(badge);

      const track = el("span", "sr-steam-ybar");
      const peakElo = posNum(r.peakElo) || 0;
      if (peakElo) {
        const fill = el("span", "sr-steam-ybarfill");
        const pct = Math.max(6, Math.min(100, Math.round(((peakElo - lo) / (hi - lo)) * 100)));
        fill.style.width = pct + "%";
        if (lvl) fill.style.setProperty("--lvl", LEVEL_HEX[lvl - 1]);
        track.appendChild(fill);
      }
      row.appendChild(track);

      const meta = el("span", "sr-steam-ymeta");
      if (peakElo) {
        meta.appendChild(el("b", null, Number(peakElo).toLocaleString("en-US")));
        meta.appendChild(document.createTextNode(" peak \u00b7 "));
      }
      meta.appendChild(document.createTextNode(r.matches + " games \u00b7 " + r.winRatePct + "%"));
      row.title =
        r.year + ": " + r.matches + " FACEIT matches, " + r.winRatePct + "% won" +
        (peakElo ? ", peak " + Number(peakElo).toLocaleString("en-US") + " elo" : "");
      row.appendChild(meta);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function footer(profileUrl) {
    const foot = el("div", "sr-steam-foot");
    const brand = el("span", "sr-steam-brand", "CS");
    brand.appendChild(el("b", null, "Run"));
    foot.appendChild(brand);
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
    root.appendChild(hero(d, cheat, band));

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
      // The level and elo now lead the hero, so the strip carries the figures
      // that were competing with them for attention rather than repeating one.
      grid.appendChild(cellFaceit(d));
      grid.appendChild(cellPremier(d.premier));
      grid.appendChild(cellKd(d.kd));
      grid.appendChild(cellCheat(cheat, band));
      grid.appendChild(cellGap(d.gap));
      root.appendChild(grid);
      const perf = perfRow(d.stats);
      if (perf) root.appendChild(perf);
    } else {
      root.appendChild(el("div", "sr-steam-empty", "No data yet"));
    }

    const years = yearsBlock(d.rankHistory);
    if (years) root.appendChild(years);

    if (d.banned) root.appendChild(el("div", "sr-steam-ban", "VAC or game ban on record"));
    root.appendChild(footer(d.profileUrl));
    return root;
  }

  // Loading state: same shell, shimmering cells.
  function skeleton() {
    ensureStyle();
    const root = el("div", "sr-reset sr-steam-panel");
    root.appendChild(hero({}, null, null));
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
        skel.remove(); // silent no-op, page never looks broken —
        // — but not a permanent one: a cold service worker or a backend blip
        // at load is transient, and giving up forever is why the card
        // sometimes needed a refresh to appear. Two spaced retries, timed to
        // outlive the api layer's 8s negative cache so each one is real.
        retries += 1;
        if (retries <= 2) setTimeout(init, 9000 * retries);
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

  // Steam profiles are server-rendered (not an SPA): one pass at idle is
  // enough — plus a bounded retry on transient failure, and a re-run when the
  // page returns from the bfcache with our panel gone.
  let retries = 0;
  init();
  window.addEventListener("pageshow", () => {
    if (!document.getElementById(ROOT_ID)) {
      retries = 0;
      void init();
    }
  });
})();
