# StatRun browser extension

Injects StatRun's **CheatMeter** risk score, Premier/FACEIT ranks and the
cross-platform gap directly into **FACEIT match rooms** and **Steam profiles** —
so you can size up 9 strangers without leaving the page.

## What it does

- **FACEIT** (`faceit.com/*`): finds every player link on the page (match rooms,
  team lists, hubs) and drops a compact CheatMeter chip next to each name — the
  risk score coloured by band, a `BAN` flag for VAC/game bans, click-through to
  the full StatRun profile.
- **Steam** (`steamcommunity.com/profiles/*` and `/id/*`): adds a CheatMeter
  panel under the profile header — score, band, Premier/FACEIT ranks, K/D,
  cross-platform gap, and a link to the full report.

All data comes from **one public endpoint** on your own site:
`GET /api/public/cheatmeter?steamid=…` (or `?faceit=<nickname>`), which reuses the
exact CheatMeter model from the site. No FACEIT/Steam scraping of private data;
only public profile stats, with attribution.

## Architecture

```
content script (faceit.js / steam.js)
   → finds player identifiers on the page
   → chrome.runtime.sendMessage({steamid | faceit})
background service worker (background.js)
   → fetch https://csrun.win/api/public/cheatmeter?…   (host_permission → no page CORS)
   → in-memory 5-min cache (dedupes a 10-player room)
   → replies with {cheat:{score,band}, premier, faceitElo, kd, gap, banned, profileUrl}
badge.js → renders the chip / panel
```

No build step — it's plain MV3 JavaScript. Load the folder as-is.

## Test it locally (load unpacked)

1. Chrome/Edge → `chrome://extensions` → toggle **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. (Optional, for a local site build) open the extension's **Options** and set the
   site URL to `http://localhost:3000` — otherwise it reads from
   `https://csrun.win`.
4. Visit a **FACEIT match room** and a **Steam profile** and confirm the chips /
   panel appear.

The public API must be deployed for real data (it lives in the site). Against
production it works immediately; against localhost you need the site + backend
running.

## Publish to the Chrome Web Store (when ready)

1. One-time **$5** developer registration at
   <https://chrome.google.com/webstore/devconsole>.
2. Zip this folder's contents (not the folder itself): `manifest.json`, `src/`,
   `icons/`.
3. Upload, fill the listing (name, description, screenshots, a small + large
   promo tile), link the **privacy policy** (your site already has `/privacy`),
   and justify the permissions: `storage` (settings) + host access to
   `csrun.win` (read stats), `faceit.com` / `steamcommunity.com` (inject
   badges).
4. Submit for review (Google typically reviews in a few days).
5. Edge Add-ons store takes the same zip separately if you want Edge too.

## Notes / next steps

- The FACEIT injector keys off the stable `/players/<nickname>` link pattern, so
  it's resilient to FACEIT's frequent DOM changes. If a specific match-room
  layout hides the badge or places it oddly, that's a CSS/placement tweak.
- Icons in `icons/` are generated placeholders (the StatRun chart mark) — swap in
  a polished logo before publishing if you have one.
- Consider adding: a config toggle per surface (FACEIT-only / Steam-only), and a
  hover card with the full factor breakdown (a later enhancement).
