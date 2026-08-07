// CSRun data layer — the ONLY fetch surface in the extension.
// Two planes: FACEIT's frontend API (same-origin from the content script, no
// key, the visitor's own session) and the CSRun public API (proxied through
// the background worker via {type:"lookup"} messages). Every call is cached
// in-memory for 5 minutes with inflight-promise dedupe, and every failure
// resolves to null — callers render honest empty states, never throw.
//
// Exposes window.SRApi  { user, eloHistory, room, cheatmeter }
//     and window.SRSettings { get, onChange }.

(function () {
  "use strict";

  // Tag the document so tokens.css can swap injected surfaces to FACEIT's
  // neutral chrome (see .sr-host-faceit). Done here because api.js is the
  // first content script on both hosts, so the class is set before any
  // module renders.
  if (location.hostname.endsWith("faceit.com")) {
    document.documentElement.classList.add("sr-host-faceit");
  }

  const TTL_MS = 5 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 8000;
  const PAGE_GAP_MS = 350;
  const PAGE_SIZE = 100; // FACEIT stats endpoint page ceiling
  const MAX_PAGES = 3;

  // ---- cache: Map key -> { at, promise } --------------------------------
  // Storing the promise (not the value) gives inflight dedupe for free: a
  // second caller during a pending fetch gets the same promise back.

  const cache = new Map();

  function cached(key, make) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = Promise.resolve()
      .then(make)
      .catch(() => null); // the data layer never throws
    cache.set(key, { at: Date.now(), promise });
    return promise;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- srFetch: same-origin JSON with an 8s budget ----------------------

  async function srFetch(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      // FACEIT wraps most responses in { payload }; some (stats rows) are bare.
      return body && typeof body === "object" && "payload" in body
        ? body.payload
        : body;
    } catch {
      return null; // network error, abort, or invalid JSON — all the same to callers
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- SRApi.user(nick) -------------------------------------------------

  function user(nick) {
    const key = `u:${String(nick).toLowerCase()}`;
    return cached(key, async () => {
      const p = await srFetch(
        `/api/users/v1/nicknames/${encodeURIComponent(nick)}`,
      );
      if (!p || !p.id) return null;
      const cs2 = (p.games && p.games.cs2) || {};
      return {
        uuid: p.id,
        steam64: cs2.game_id || null,
        elo: cs2.faceit_elo != null ? +cs2.faceit_elo : null,
        level: cs2.skill_level != null ? +cs2.skill_level : null,
        country: p.country || null,
        avatar: p.avatar || null,
      };
    });
  }

  // ---- SRApi.eloHistory(uuid, n) ----------------------------------------
  // Newest first. Recent rows may omit elo (FACEIT lags) — they are included
  // with elo:null so per-map aggregation still counts them.

  // A genuine 0 is a reading, not a gap — only absent/NaN becomes null.
  function statNum(v) {
    if (v == null || v === "") return null;
    const n = +v;
    return Number.isFinite(n) ? n : null;
  }

  function mapHistoryRow(r) {
    r = r || {};
    // ONLY i1/i6/i8/i10 are confirmed against live responses. FACEIT's stat
    // columns are positional and undocumented, and a wrong index yields a
    // plausible-looking wrong number — the worst possible failure for a stats
    // tool. Assists, rounds and ADR therefore come from the official Data API
    // via our own backend (see the public cheatmeter route), not from guesses
    // at this row's remaining slots.
    return {
      matchId: r.matchId || null,
      date: new Date(+r.date),
      map: r.i1 || null,
      kills: statNum(r.i6),
      deaths: statNum(r.i8),
      win: r.i10 === "1",
      elo: r.elo ? +r.elo : null,
      delta: r.elo_delta ? +r.elo_delta : null,
    };
  }

  function eloHistory(uuid, n) {
    const want = Math.max(1, Math.floor(+n) || 100);
    return cached(`h:${uuid}:${want}`, async () => {
      const size = Math.min(want, PAGE_SIZE);
      const rows = [];
      for (let page = 0; page * size < want && page < MAX_PAGES; page++) {
        if (page > 0) await sleep(PAGE_GAP_MS); // be polite between pages
        const batch = await srFetch(
          `/api/stats/v1/stats/time/users/${encodeURIComponent(uuid)}` +
            `/games/cs2?page=${page}&size=${size}`,
        );
        if (!Array.isArray(batch)) {
          if (page === 0) return null; // nothing at all → honest null
          break; // partial history beats none
        }
        for (const r of batch) rows.push(mapHistoryRow(r));
        if (batch.length < size) break; // short page — history exhausted
      }
      return rows.slice(0, want);
    });
  }

  // ---- SRApi.room(roomId) -----------------------------------------------

  function mapTeam(t) {
    t = t || {};
    const roster = Array.isArray(t.roster) ? t.roster : [];
    return {
      name: typeof t.name === "string" ? t.name : "",
      roster: roster.map((m) => {
        m = m || {};
        return {
          uuid: m.id || null,
          nick: typeof m.nickname === "string" ? m.nickname : "",
          steam64: m.gameId || null,
          elo: m.elo != null ? +m.elo : null,
          level: m.gameSkillLevel != null ? +m.gameSkillLevel : null,
          // present on FACEIT's roster payload; the panel degrades when absent
          avatar: typeof m.avatar === "string" ? m.avatar : null,
          country: typeof m.country === "string" ? m.country : null,
        };
      }),
    };
  }

  // Which map is actually being played. FACEIT states it in more than one
  // shape depending on how the match was made, so every known location is
  // tried and anything unrecognised simply yields null.
  function pickedMap(p) {
    const v = p && p.voting && p.voting.map;
    if (v && Array.isArray(v.pick) && v.pick.length) return String(v.pick[0]);
    if (v && Array.isArray(v.entities) && v.entities.length === 1 && v.entities[0]) {
      return String(v.entities[0].guid || v.entities[0].game_map_id || "") || null;
    }
    const tree = p && p.matchCustom && p.matchCustom.tree && p.matchCustom.tree.map;
    const val = tree && tree.values && tree.values.value;
    if (Array.isArray(val) && val.length === 1 && val[0]) {
      return String(val[0].guid || val[0].game_map_id || "") || null;
    }
    return null;
  }

  function room(roomId) {
    return cached(`r:${roomId}`, async () => {
      const p = await srFetch(
        `/api/match/v2/match/${encodeURIComponent(roomId)}`,
      );
      if (!p || !p.teams) return null;
      return {
        state: p.state || null,
        map: pickedMap(p),
        teams: [mapTeam(p.teams.faction1), mapTeam(p.teams.faction2)],
      };
    });
  }

  // ---- SRApi.cheatmeter({steamid|faceit}) -------------------------------
  // Passthrough to the background worker, which owns the cross-origin call
  // and its own cache; we still cache here to skip the message round-trip.

  function cheatmeter(params) {
    params = params || {};
    const key = params.steamid
      ? `c:s:${params.steamid}`
      : `c:f:${String(params.faceit || "").toLowerCase()}`;
    return cached(key, () => {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { type: "lookup", steamid: params.steamid, faceit: params.faceit },
            (r) => {
              resolve(chrome.runtime.lastError || !r || r.error ? null : r);
            },
          );
        } catch {
          resolve(null); // extension context gone — silent no-op
        }
      });
    });
  }

  // ---- SRSettings --------------------------------------------------------
  // One cached chrome.storage.sync read; invalidated (and re-broadcast) on
  // every storage change. The options page is the only writer.

  const DEFAULTS = {
    enabled: true,
    "feature.matchroom": true,
    "feature.profile": true,
    "feature.steam": true,
    "feature.chips": true,
    "auto.accept": false,
    "auto.closeModals": false,
    "notify.matchReady": false,
    apiBase: "https://csrun.win",
  };

  let settingsPromise = null;
  const changeListeners = new Set();

  function settingsGet() {
    if (!settingsPromise) {
      settingsPromise = new Promise((resolve) => {
        try {
          chrome.storage.sync.get(DEFAULTS, (stored) => {
            resolve(
              chrome.runtime.lastError
                ? { ...DEFAULTS }
                : { ...DEFAULTS, ...stored },
            );
          });
        } catch {
          resolve({ ...DEFAULTS });
        }
      });
    }
    return settingsPromise;
  }

  // cb(settings, changes) — called with the fresh, defaults-merged snapshot.
  function settingsOnChange(cb) {
    if (typeof cb === "function") changeListeners.add(cb);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      settingsPromise = null; // next get() re-reads
      settingsGet().then((settings) => {
        changeListeners.forEach((cb) => {
          try {
            cb(settings, changes);
          } catch {
            /* a broken listener must not break the rest */
          }
        });
      });
    });
  } catch {
    /* no chrome.storage here (e.g. dev harness) — onChange simply never fires */
  }

  // ---- export ------------------------------------------------------------

  // ---- SRDom: finding FACEIT's player cards -----------------------------
  //
  // Shared because both the panel and the inline strips need the same answer:
  // the panel wants to sit next to the roster, the strips want to sit on each
  // card in it. Earlier versions each guessed separately, and both guessed by
  // looking for an <img> avatar and an <a href="/players/…"> — neither of
  // which FACEIT guarantees. A Premier room's cards carry decorative avatar
  // frames rather than a plain image, and its names are not always links, so
  // the walk found nothing and the panel fell back to mounting above the
  // entire app.
  //
  // The reliable signal is the roster itself. We already know the ten
  // nicknames, so a card is simply "the smallest box containing exactly one of
  // them, sitting beside boxes that each contain one of the others". That
  // needs no avatar, no link, and no class name.

  function ourNode(node) {
    return !!(
      node.closest &&
      node.closest("#statrun-room, [data-sr-inline], .sr-reset, .sr-mr, .sr-chip")
    );
  }

  // The node whose OWN text is exactly this nickname, ignoring nodes that
  // merely contain it — so a chat line mentioning the name never wins.
  function nodeForNick(nick) {
    const want = String(nick || "").trim().toLowerCase();
    if (!want) return null;
    for (const a of document.querySelectorAll('a[href*="/players/"]')) {
      if (a.offsetParent === null || ourNode(a)) continue;
      if ((a.textContent || "").trim().toLowerCase() === want) return a;
    }
    for (const n of document.querySelectorAll("span,div,p,h1,h2,h3,h4,strong,b,a")) {
      if (n.children.length > 2 || n.offsetParent === null || ourNode(n)) continue;
      if ((n.textContent || "").trim().toLowerCase() === want) return n;
    }
    return null;
  }

  // Map of nickname -> the node naming that player on this page.
  function nameNodes(nicks) {
    const out = new Map();
    for (const nick of nicks || []) {
      const n = nodeForNick(nick);
      if (n) out.set(nick, n);
    }
    return out;
  }

  // The card holding `node`, given every roster name-node on the page.
  function cardFor(node, all) {
    const others = all || [];
    let n = node;
    for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
      if (n === document.body || n === document.documentElement) break;
      const r = n.getBoundingClientRect();
      if (r.width < 60 || r.height < 24) continue;
      let inside = 0;
      for (const o of others) if (n.contains(o)) inside += 1;
      if (inside > 1) return null; // walked out of the card and into the roster
      if (inside !== 1) continue;
      const p = n.parentElement;
      if (!p) continue;
      let peers = 0;
      for (const c of p.children) {
        if (c === n || ourNode(c)) continue;
        for (const o of others) {
          if (c.contains(o)) { peers += 1; break; }
        }
      }
      if (peers >= 1) return n; // a roster: at least one more card beside it
    }
    return null;
  }

  // Smallest element containing all of `nodes` — the roster block itself.
  function commonAncestor(nodes) {
    const list = (nodes || []).filter(Boolean);
    if (!list.length) return null;
    let a = list[0];
    for (let i = 1; i < list.length; i++) {
      let b = list[i];
      while (a && !a.contains(b)) a = a.parentElement;
      if (!a) return null;
    }
    return a === document.body || a === document.documentElement ? null : a;
  }

  window.SRApi = { user, eloHistory, room, cheatmeter };
  window.SRDom = { nodeForNick, nameNodes, cardFor, commonAncestor };
  window.SRSettings = { get: settingsGet, onChange: settingsOnChange };
})();
