# StatRun Extension — Design Contract

Every module obeys this file. If a module wants something this file doesn't
define, the module is wrong or this file gets amended — never improvise tokens.

## Identity

StatRun ("csrun.win") injected INTO faceit.com and steamcommunity.com. The UI
must read as a premium native layer: FACEIT's dark chrome, StatRun's accent
language. Never clash with the host page; never look bolted-on.

## Tokens (tokens.css — the only source of colors/spacing)

All styling uses `var(--sr-*)` custom properties, prefixed to never collide
with host-page CSS:

- Surfaces: `--sr-bg #0b0f1a`, `--sr-panel #10182b`, `--sr-panel2 #141d33`,
  `--sr-line #22314f`, `--sr-line2 #31456b`
- Ink: `--sr-ink #e8edf6`, `--sr-muted #9aa7bd`, `--sr-faint #66748c`
- Accents: `--sr-brand #38d6ff` (StatRun cyan — links/identity),
  `--sr-orange #ff8a50` (FACEIT/elo), `--sr-good #46d369`, `--sr-mid #f5b942`,
  `--sr-bad #f5694a`
- CheatMeter bands: low `--sr-good`, guarded `--sr-mid`, high `#ff7a3d`,
  severe `--sr-bad`
- Premier tier hexes (CS2 rarity scale, by rating): <5k `#b0c3d9`,
  5–10k `#5e98d9`, 10–15k `#4b69ff`, 15–20k `#8847ff`, 20–25k `#d32ce6`,
  25–30k `#eb4b4b`, 30k+ `#ffd700`
- Radii: chip 4px, card 10px, panel 12px. Borders 1px `--sr-line`.
- Type: system stack (`-apple-system, "Segoe UI", Roboto, sans-serif`);
  sizes 10/11/12/13px only; numerals ALWAYS `font-variant-numeric: tabular-nums`;
  labels uppercase 10px `letter-spacing: .08em` `--sr-faint`.
- Spacing: 4px grid. Card padding 10–12px. Chip padding 2px 6px.
- Shadows: panels `0 8px 24px rgb(0 0 0 / .35)`; never glows except the
  CheatMeter severe band (`0 0 8px` at 25% of band color).
- Motion: 120ms ease-out on hover; no entrance animations over 160ms; respect
  `prefers-reduced-motion`.

## Components (names are law — modules reference these)

- **sr-chip** — inline pill next to a player name: CheatMeter score dot +
  number, optional BAN flag. Height 18px. Never wraps; truncates gracefully.
- **sr-player-row** — one row of the match-room table: avatar 24px, name,
  level badge (official 1–10 hex colors), elo (orange, tabular), elo Δ today
  (signed, good/bad), K/D, WR%, streak (W3 green / L2 red), maps count,
  CheatMeter chip, Premier plate (mini, tier hex), Leetify aim (0–100).
- **sr-team-card** — 5 sr-player-rows + header (team name, avg elo, elo
  prediction `+25 / −25` for THIS match from the standard formula over avg
  elo diff).
- **sr-veto-panel** — per-map row: map name + both teams' matches played and
  win% on it, bar pair, most/least-played markers. Sits under the team cards.
- **sr-elo-widget** — compact card on profile/sidebar: current elo, level
  badge, progress bar to next level threshold (official floors — the list in
  ARCHITECTURE.md is authoritative: [100,501,751,…,2001]), today's Δ.
- **sr-steam-panel** — Steam profile card: CheatMeter band, Premier plate,
  FACEIT level+elo, K/D, cross-platform gap note, link to full report.
- **sr-settings** — options page: grouped toggles (Overlay / Automation /
  Notifications), each with a one-line honest description. Same tokens.

## Quality bar (the judge scores these 6 axes, 1–10; ship needs ≥9 on each)

1. **Cohesion** — every surface reads as one system; zero default-styled elements.
2. **Typography** — sizes/weights/tabular numerals per spec; no orphan px values.
3. **Color discipline** — tokens only; accents mean something (orange=elo,
   cyan=StatRun, band colors=risk); never decorative rainbow.
4. **Density & alignment** — 10 players scannable in one glance; columns align
   to the pixel; nothing jitters on hover.
5. **Native fit** — sits inside FACEIT's page like FACEIT shipped it; spacing
   matches host rhythm; no clipped/overflowing content at 1280–1920w.
6. **Detail** — empty/loading/error states designed (skeleton shimmer, "—" for
   missing, tooltip explanations); focus rings; reduced-motion respected.

## Hard rules

- No external fonts, no CDN, no frameworks. Plain MV3 JS + CSS.
- Every network call goes through the data layer (`src/lib/api.js`); UI modules
  never fetch.
- All injected roots use `#statrun-` ids and `.sr-` classes exclusively.
- Copy tone: honest and short. "No data yet" not "Oops!". No exclamation marks.
- Attribution: tiny "StatRun" wordmark link on the match-room panel only.
- NEVER copy Repeek's name, assets, icons, or distinctive UI layouts.
