# StatRun Extension — Architecture Contract

Plain MV3, no build step. Module boundaries are hard: each file below has ONE
owner; modules communicate only through the documented contracts.

## Files

```
manifest.json         MV3 manifest (content scripts, worker, options, popup)
src/tokens.css        design tokens — the ONLY place colors/spacing live
src/lib/api.js        DATA LAYER — every network call in the extension
src/badge.js          sr-chip renderer (shared by faceit/steam scripts)
src/matchroom.js      flagship: match-room panel (teams, prediction, veto)
src/matchroom.css     styles for the panel (tokens only)
src/faceit.js         chips beside player links + page routing (existing, keep)
src/profile.js        elo widget + per-match elo deltas on player profiles
src/automation.js     option-gated QoL: auto-accept, modal close, notifications
src/steam.js          Steam profile panel
src/popup.html/js     toolbar popup: quick lookup + status
src/options.html/js   settings: grouped toggles
src/background.js     cache + fetch proxy to csrun.win + notifications
```

## Data layer (`src/lib/api.js`) — the only fetch surface

Two data planes, both cached (in-page Map, 5-min TTL, inflight dedupe):

1. **FACEIT frontend API — same-origin from the content script.** No key, no
   CORS, uses the visitor's own IP/session. Verified reachable anonymously:
   - `GET /api/users/v1/nicknames/{nick}` → `payload.id` (faceit uuid),
     `payload.games.cs2.{game_id (steam64), faceit_elo, skill_level}`,
     `payload.country`, `payload.avatar`
   - `GET /api/stats/v1/stats/time/users/{uuid}/games/cs2?page=0&size=100` →
     rows `{matchId, date(ms), i1(map), i6(kills), i8(deaths), i10(win '1'/'0'),
     elo, elo_delta}` — newest first; recent rows may omit elo (FACEIT lags)
   - `GET /api/match/v2/match/{roomId}` → `payload.teams.faction1/faction2`
     `{name, roster:[{id, nickname, gameId, elo, gameSkillLevel}]}`,
     `payload.matchCustom`, `payload.state`
   - Room id comes from the URL: `/[lang]/cs2/room/{roomId}[/...]`
   Frontend-API calls MUST go through `srFetch()` in api.js which sets
   `Accept: application/json`, tolerates `{payload}` wrapping, and returns
   null on any non-200 (UI shows honest empty states, never throws).
2. **StatRun public API — via background worker** (host_permissions):
   `GET {base}/api/public/cheatmeter?steamid=|faceit=` →
   `{cheat:{score,band}, premier, faceitElo, kd, gap, banned, profileUrl}`.
   Message `{type:"lookup", steamid|faceit}` → background caches 5 min.

## Contracts between modules

- `SRApi.user(nick)` → `{uuid, steam64, elo, level, country, avatar} | null`
- `SRApi.eloHistory(uuid, n)` → `[{matchId, date, map, kills, deaths, win,
  elo, delta}] | null` (rows without elo are INCLUDED with elo:null — the
  caller decides; per-map aggregation needs them)
- `SRApi.room(roomId)` → `{state, teams:[{name, roster:[{uuid, nick, steam64,
  elo, level}]}]} | null`
- `SRApi.cheatmeter({steamid|faceit})` → background lookup passthrough
- `SRBadge.chip(data)` → element (exists in badge.js as `SR.chip`)
- Settings: `chrome.storage.sync` keys — `enabled` (master, default true),
  `feature.matchroom`, `feature.profile`, `feature.steam`,
  `feature.chips` (default true), `auto.accept`, `auto.closeModals`,
  `notify.matchReady` (all default false for automation, true for display),
  `apiBase` (default https://csrun.win). Options page is the only writer.

## Elo prediction formula (matchroom.js)

Standard FACEIT model: `expected = 1 / (1 + 10^((avgElo(opp) − avgElo(own))/400))`,
gain = round(50·K·(1−expected)) with K=1 (display `+X / −Y` per side, clamp
±50). Label it "estimate".

## Level thresholds (profile.js)

`[1:100, 2:501, 3:751, 4:901, 5:1051, 6:1201, 7:1351, 8:1531, 9:1751, 10:2001]`
Progress bar = position between current level's floor and next level's floor.

## Dev harness (`dev/`)

`dev/matchroom.html` — standalone fixture replicating a FACEIT room's dark
shell with realistic markup hooks; loads tokens.css + matchroom.css + a mock
`SRApi` (dev/mock-api.js, deterministic data incl. edge cases: 4-stack +
solo, elo-less new player, banned player, 30k Premier, missing Leetify) and
renders the panel. Same pattern `dev/profile.html`, `dev/steam.html`,
`dev/popup.html` preview. These pages are what Playwright screenshots and the
judge scores — they must use ONLY the real extension code paths for rendering
(mock replaces network, never markup).

## Non-negotiables

- No innerHTML with untrusted strings — build DOM via helpers (XSS surface is
  host-page data). Nicknames/team names are untrusted.
- Every feature silently no-ops when its data is null — the host page must
  never look broken because we failed.
- MutationObserver work is debounced ≥300ms; disconnect when feature disabled.
- All storage reads go through one `SRSettings.get()` helper (api.js exports).
