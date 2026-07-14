// gc-bot — Steam Game Coordinator sidecar.
//
// Logs a dedicated Steam account into the CS2 Game Coordinator and exposes a
// tiny internal HTTP API that resolves a match share code (CSGO-xxxxx-…) to its
// GOTV replay URL (http://replay###.valve.net/730/…dem.bz2). This is the ONLY
// way to turn a share code into a demo file — Valve exposes no HTTP API for it.
//
// Endpoints (internal Docker network only — never expose through the proxy):
//   GET  /health            → { loggedOn, gcConnected, queued, guardPending }
//   POST /guard-code {code} → submit the one-time Steam Guard email code
//   POST /resolve {shareCode} → { demoUrl } | { error }
//   POST /recent {steamId} → { matches: [{matchId,time,demoUrl,scores}] } — the
//        player's ~8 most recent official matches (needs public Game details)
//
// Login flow: first start uses STEAM_BOT_USER/STEAM_BOT_PASS; Steam emails a
// Guard code — submit it via POST /guard-code. After login the refresh token is
// persisted to DATA_DIR and reused, so restarts need no code (tokens last ~200
// days; when one finally expires the same guard-code dance runs once again).

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const SteamUser = require("steam-user");
const GlobalOffensive = require("globaloffensive");

const USER = process.env.STEAM_BOT_USER || "";
const PASS = process.env.STEAM_BOT_PASS || "";
const PORT = Number(process.env.PORT || 7300);
const DATA_DIR = process.env.DATA_DIR || "/data";
const TOKEN_FILE = path.join(DATA_DIR, "refresh_token.json");
// GC etiquette: one match request at a time, spaced out.
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 2500);
const RESOLVE_TIMEOUT_MS = Number(process.env.RESOLVE_TIMEOUT_MS || 20000);
// Watchdog: steam-user's autoRelogin keeps the process alive but can wedge after
// a Steam-level drop (the socket dies and the GC never comes back), leaving the
// container "Up" yet dead. If the GC stays unreachable this long AFTER we've had
// a working session, exit so Docker's restart policy relaunches us — a fresh
// process re-logs from the saved token and reconnects cleanly (the manual fix).
const WATCHDOG_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 60000);
const GC_STALE_MS = Number(process.env.GC_STALE_MS || 180000);

const CREDS_OK = !!(USER && PASS);
if (!CREDS_OK) {
  // Stay up (health reports unavailable) instead of crash-looping — lets the
  // stack deploy before the bot account exists.
  console.error("gc-bot: STEAM_BOT_USER / STEAM_BOT_PASS not set — idle until configured");
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const user = new SteamUser({ dataDirectory: DATA_DIR, autoRelogin: true });
const csgo = new GlobalOffensive(user);

let loggedOn = false;
let gcConnected = false;
let guardCallback = null; // pending Steam Guard prompt → resolved via /guard-code
let guardDomain = null;
let loginAttempts = 0;
let everGcConnected = false;
let lastHealthyAt = Date.now(); // baseline so startup gets the same grace window

// share code → demo URL cache (immutable once resolved)
const cache = new Map();

function readToken() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    return typeof t.refreshToken === "string" && t.refreshToken ? t.refreshToken : null;
  } catch {
    return null;
  }
}

function logOn() {
  const refreshToken = readToken();
  if (refreshToken) {
    console.log("gc-bot: logging on with saved refresh token");
    user.logOn({ refreshToken });
  } else {
    console.log(`gc-bot: logging on as ${USER} (password + Steam Guard)`);
    user.logOn({ accountName: USER, password: PASS });
  }
}

user.on("refreshToken", (token) => {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refreshToken: token, savedAt: new Date().toISOString() }));
  console.log("gc-bot: refresh token saved");
});

user.on("steamGuard", (domain, callback, lastCodeWrong) => {
  guardCallback = callback;
  guardDomain = domain;
  console.log(
    `gc-bot: Steam Guard code required (email${domain ? " " + domain : ""})` +
      (lastCodeWrong ? " — last code was WRONG, submit a fresh one" : "") +
      " → POST /guard-code {\"code\":\"XXXXX\"}",
  );
});

user.on("loggedOn", () => {
  loggedOn = true;
  loginAttempts = 0;
  guardCallback = null;
  console.log(`gc-bot: logged on as ${user.steamID?.getSteamID64?.() || "?"}; launching CS2`);
  user.setPersona(SteamUser.EPersonaState.Invisible);
  user.gamesPlayed([730]);
});

csgo.on("connectedToGC", () => {
  gcConnected = true;
  everGcConnected = true;
  lastHealthyAt = Date.now();
  console.log("gc-bot: connected to the CS2 Game Coordinator");
});
csgo.on("disconnectedFromGC", (reason) => {
  gcConnected = false;
  console.log(`gc-bot: disconnected from GC (${reason}) — will reconnect`);
});

user.on("disconnected", (eresult, msg) => {
  loggedOn = false;
  gcConnected = false;
  console.log(`gc-bot: disconnected from Steam (${eresult} ${msg || ""})`);
});

user.on("error", (err) => {
  loggedOn = false;
  gcConnected = false;
  // A pending Steam Guard prompt belongs to the session that just died — drop it
  // so a code submitted during backoff isn't fed to a dead auth attempt.
  guardCallback = null;
  console.error(`gc-bot: steam error: ${err.message}`);
  // Bad saved token → drop it and retry with password (guard code needed once).
  if (String(err.message).includes("AccessDenied") || String(err.message).includes("Expired")) {
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {}
  }
  // Exponential backoff capped at 15 min so a persistently-wrong password can't
  // hammer Steam ~1440x/day.
  const backoff = Math.min(15 * 60000, 5000 * 2 ** Math.min(loginAttempts++, 8));
  console.log(`gc-bot: retrying login in ${Math.round(backoff / 1000)}s (attempt ${loginAttempts})`);
  setTimeout(logOn, backoff);
});

// Watchdog — self-heal a wedged connection. Only acts once we've actually had a
// session (logged on now, or the GC was up before), so a plain login failure is
// left to the exponential backoff above and bad creds never cause a restart loop.
setInterval(() => {
  if (!CREDS_OK || guardCallback) return; // idle, or waiting on a human Guard code
  if (gcConnected) {
    lastHealthyAt = Date.now();
    return;
  }
  const stuckMs = Date.now() - lastHealthyAt;
  if (stuckMs > GC_STALE_MS && (loggedOn || everGcConnected)) {
    console.error(
      `gc-bot: no GC connection for ${Math.round(stuckMs / 1000)}s (loggedOn=${loggedOn}) — exiting for a clean restart`,
    );
    process.exit(1);
  }
}, WATCHDOG_INTERVAL_MS);

// --- share-code decode (Valve's base-57; matchId is the first field) ---------
// Ported from the Go internal/sharecode package. We only need the matchId, to
// correlate a GC matchList reply with the request that asked for it.
const SC_DICT = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";

function decodeMatchId(shareCode) {
  const clean = shareCode.replace(/CSGO|-/g, "");
  let acc = 0n;
  for (let i = clean.length - 1; i >= 0; i--) {
    const idx = SC_DICT.indexOf(clean[i]);
    if (idx < 0) throw new Error("invalid share code character");
    acc = acc * 57n + BigInt(idx);
  }
  // 18-byte big-endian buffer; matchId = little-endian uint64 of bytes[0..8].
  const bytes = new Array(18).fill(0);
  let v = acc;
  for (let i = 17; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  let matchId = 0n;
  for (let i = 7; i >= 0; i--) matchId = (matchId << 8n) | BigInt(bytes[i]);
  return matchId.toString();
}

// Self-check: a broken decode would make every resolve silently time out, so
// fail loudly at boot instead. (Value cross-checked against the Go decoder.)
if (decodeMatchId("CSGO-yOJk4-YmmVm-KsSa5-rPTwZ-jPocG") !== "3829447576176820327") {
  console.error("gc-bot: FATAL — share-code decode self-check failed");
  process.exit(1);
}

// --- share-code resolution (serialized queue, one in flight) -----------------

const queue = [];
let busy = false;
let current = null; // the in-flight item; a global matchList listener reads it

function enqueueResolve(shareCode) {
  return new Promise((resolve, reject) => {
    let wantMatchId;
    try {
      wantMatchId = decodeMatchId(shareCode);
    } catch (e) {
      return reject(e);
    }
    const item = { kind: "sharecode", shareCode, wantMatchId, resolve, reject, settled: false };
    // Deadline covers BOTH queue-wait and in-flight time, so a request can't
    // strand forever if the GC drops while it's queued behind another.
    item.timer = setTimeout(
      () => settle(item, item.reject, new Error("timeout waiting for the Game Coordinator")),
      RESOLVE_TIMEOUT_MS,
    );
    queue.push(item);
    pump();
  });
}

// enqueueRecent asks the GC for a player's recent matches (their last ~8
// official games). Works only while the account's "Game details" privacy is
// Public. Serialized through the same single-flight queue as share codes.
function enqueueRecent(steamId64) {
  return new Promise((resolve, reject) => {
    const item = { kind: "recent", steamId64, resolve, reject, settled: false };
    item.timer = setTimeout(
      () => settle(item, item.reject, new Error("timeout waiting for the Game Coordinator")),
      RESOLVE_TIMEOUT_MS,
    );
    queue.push(item);
    pump();
  });
}

// summarize a GC match for the /recent reply: time, demo URL and final score.
function summarizeMatch(m) {
  const stats = m.roundstatsall || (m.roundstats_legacy ? [m.roundstats_legacy] : []);
  let demoUrl = null;
  let scores = null;
  for (const rs of stats) {
    if (rs && typeof rs.map === "string" && rs.map.startsWith("http")) demoUrl = rs.map;
    if (rs && Array.isArray(rs.team_scores) && rs.team_scores.length === 2) {
      scores = [Number(rs.team_scores[0]), Number(rs.team_scores[1])];
    }
  }
  return {
    matchId: String(m.matchid),
    time: Number(m.matchtime) || 0, // unix seconds
    demoUrl,
    scores,
  };
}

function settle(item, fn, val) {
  if (item.settled) return;
  item.settled = true;
  clearTimeout(item.timer);
  if (current === item) {
    current = null;
    // Space out GC requests (etiquette + rate safety) before the next one.
    setTimeout(() => {
      busy = false;
      pump();
    }, REQUEST_GAP_MS);
  } else {
    const i = queue.indexOf(item);
    if (i >= 0) queue.splice(i, 1);
  }
  fn(val);
}

// Single global listener: the GC emits ONE uncorrelated matchList per reply, so
// we verify each reply's matchid against the in-flight request. A late reply
// from a timed-out request (matchid mismatch) is ignored — never mis-cached.
csgo.on("matchList", (matches) => {
  const item = current;
  if (!item || item.settled) return;
  // recent-games request: the reply is the player's match list itself (no
  // matchid to correlate) — single-flight queueing keeps replies unambiguous.
  if (item.kind === "recent") {
    return settle(item, item.resolve, (matches || []).map(summarizeMatch));
  }
  let found = false;
  let url = null;
  for (const m of matches || []) {
    if (String(m.matchid) !== item.wantMatchId) continue;
    found = true;
    const stats = m.roundstatsall || (m.roundstats_legacy ? [m.roundstats_legacy] : []);
    for (const rs of stats) {
      if (rs && typeof rs.map === "string" && rs.map.startsWith("http")) url = rs.map;
    }
  }
  if (!found) return; // stale/foreign reply — keep waiting for ours (or time out)
  if (!url) {
    return settle(item, item.reject, Object.assign(new Error("match has no replay URL (expired or not recorded)"), { code: 404 }));
  }
  cache.set(item.shareCode, url);
  settle(item, item.resolve, url);
});

function pump() {
  if (busy || queue.length === 0 || !gcConnected) return;
  const item = queue.shift();
  if (item.settled) return pump(); // timed out while queued
  busy = true;
  current = item;
  try {
    if (item.kind === "recent") csgo.requestRecentGames(item.steamId64);
    else csgo.requestGame(item.shareCode);
  } catch (e) {
    settle(item, item.reject, e);
  }
}

csgo.on("connectedToGC", pump);

// --- tiny HTTP API ------------------------------------------------------------

function readBody(req, cb) {
  let buf = "";
  req.on("data", (c) => {
    buf += c;
    if (buf.length > 4096) req.destroy();
  });
  req.on("end", () => cb(buf));
}

const SHARECODE_RE = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

const server = http.createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "GET" && req.url === "/health") {
    return send(200, {
      loggedOn,
      gcConnected,
      everGcConnected,
      sinceHealthyMs: gcConnected ? 0 : Date.now() - lastHealthyAt,
      queued: queue.length,
      guardPending: !!guardCallback,
      guardDomain,
      cached: cache.size,
    });
  }

  if (req.method === "POST" && req.url === "/guard-code") {
    return readBody(req, (body) => {
      let code = "";
      try {
        code = String(JSON.parse(body).code || "").trim();
      } catch {}
      if (!code) return send(400, { error: "body must be {\"code\":\"XXXXX\"}" });
      if (!guardCallback) return send(409, { error: "no Steam Guard prompt is pending" });
      const cb = guardCallback;
      guardCallback = null;
      cb(code);
      return send(200, { ok: true });
    });
  }

  if (req.method === "POST" && req.url === "/recent") {
    return readBody(req, async (body) => {
      let steamId = "";
      try {
        steamId = String(JSON.parse(body).steamId || "").trim();
      } catch {}
      if (!/^7656119\d{10}$/.test(steamId)) {
        return send(400, { error: "invalid steamId (expected a SteamID64)" });
      }
      if (!gcConnected) {
        return send(503, { error: "not connected to the Game Coordinator yet — try again shortly", guardPending: !!guardCallback });
      }
      try {
        const matches = await enqueueRecent(steamId);
        return send(200, { matches });
      } catch (e) {
        return send(502, { error: e.message });
      }
    });
  }

  if (req.method === "POST" && req.url === "/resolve") {
    return readBody(req, async (body) => {
      let shareCode = "";
      try {
        shareCode = String(JSON.parse(body).shareCode || "").trim();
      } catch {}
      if (!SHARECODE_RE.test(shareCode)) {
        return send(400, { error: "invalid share code (expected CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx)" });
      }
      const hit = cache.get(shareCode);
      if (hit) return send(200, { demoUrl: hit, cached: true });
      if (!gcConnected) {
        return send(503, { error: "not connected to the Game Coordinator yet — try again shortly", guardPending: !!guardCallback });
      }
      try {
        const demoUrl = await enqueueResolve(shareCode);
        return send(200, { demoUrl });
      } catch (e) {
        return send(e.code === 404 ? 404 : 502, { error: e.message });
      }
    });
  }

  return send(404, { error: "not found" });
});

server.listen(PORT, () => console.log(`gc-bot: listening on :${PORT}`));
if (CREDS_OK) logOn();
