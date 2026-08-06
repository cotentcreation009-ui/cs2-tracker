# StatRun browser extension

Elo deltas, win prediction, map-veto stats, CheatMeter risk scores and
cross-platform Premier/Leetify ranks — inside **FACEIT match rooms**, **FACEIT
profiles** and **Steam profiles**.

Plain MV3 JavaScript. No build step, no frameworks, no CDN.

## What it does

**FACEIT match room** (`/cs2/room/{id}`) — the flagship. Two team cards with all
ten players: avatar, country, level badge, elo, last-30 K/D and win rate, win/loss
streak, CheatMeter chip, Premier plate and Leetify aim. Each card headlines its
average elo and this match's elo estimate (`+25 / −25`). Below them, a map panel
showing how often each team has played every map in the last 30 and how they did
there — the read you actually want during veto.

**FACEIT profile** (`/players/{nick}`) — current elo, level badge, progress to the
next level floor, today's net elo change, and the last ten matches with per-match
elo deltas.

**Steam profile** — CheatMeter band, Premier plate, FACEIT level + elo, K/D and the
cross-platform gap, with a VAC/game-ban banner when one is on record.

**Optional automation** (all default OFF, per-feature toggles): auto-accept the
ready dialog, dismiss cookie/promo modals, and a desktop notification when a match
is ready while the tab is in the background.

## Where the data comes from

Two planes, both cached 5 minutes in-page with inflight dedupe:

1. **FACEIT's own frontend API, same-origin from the content script** — no key, no
   CORS, and it runs on the visitor's own IP, so the rate limits that hit a
   server never apply. `users/v1/nicknames`, `stats/v1/stats/time`, `match/v2/match`.
2. **StatRun's public endpoint** via the background worker —
   `GET csrun.win/api/public/cheatmeter?steamid=|faceit=` for the CheatMeter score,
   Premier rank, ban flag and cross-platform gap. This is the layer no other FACEIT
   extension has.

Nothing is fetched from a UI module; every network call lives in `src/lib/api.js`.

## Install (load unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. Visit any FACEIT match room, FACEIT profile, or Steam profile.

Settings live in the toolbar popup (master toggle + quick lookup) and the options
page (per-feature toggles, automation, API base).

## Layout

```
manifest.json         MV3 manifest
src/tokens.css        design tokens — the ONLY place colors/spacing live
src/lib/api.js        data layer — every network call in the extension
src/badge.js          the inline CheatMeter chip
src/faceit.js         chips beside player links, SPA route watching
src/matchroom.js/.css the match-room panel
src/profile.js        the elo widget
src/steam.js          the Steam report panel
src/automation.js     option-gated QoL (all default off)
src/background.js     fetch proxy + cache + notifications
src/popup.*           toolbar popup
src/options.*         settings
dev/                  standalone fixtures — real render paths, mocked network
```

`DESIGN.md` is the design contract (tokens, component specs, the quality bar).
`ARCHITECTURE.md` is the module map and data contracts. Both are binding: a module
that wants something they don't define is wrong, or the doc gets amended first.

## Development

```
node --check src/*.js          # syntax
```

Open any file in `dev/` directly in a browser — the fixtures drive the real render
code with a mocked network, including the edge cases (a player with no history, a
banned player, a 30k Premier rating, missing Leetify, truncating nicknames).

## Notes

Independent project — not affiliated with FACEIT or Valve. Reads only public
profile data. The CheatMeter is a signal, not an accusation; elite legitimate
players score high too.
