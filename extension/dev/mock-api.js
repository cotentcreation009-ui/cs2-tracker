// Deterministic mock of the StatRun data layer for the dev fixtures. It
// replaces NETWORK only (SRApi, SRSettings, the SR badge global) — never
// markup: fixtures must render through the real module code paths.
//
// Fixture roster: "Mix Masters" vs "ex-RUSTEC", with the contract edge cases:
//   - fresh_frag01: brand-new player — null elo, null history
//   - v1rt_master: banned (cheatmeter banned:true)
//   - premier_goliath: 30k+ Premier (gold tier)
//   - t0xic_shot: missing Leetify
//   - bomber_zn: no CheatMeter read at all (lookup returns null)
//   - xXx_LongNicknameThatTruncates_xXx: nickname truncation
// Team A never plays de_ancient; team B never plays de_train (veto "—" marks).

(function () {
  "use strict";

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const AVATAR =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%231b2a45'/%3E%3Ccircle cx='24' cy='18' r='8' fill='%2338d6ff'/%3E%3Cpath d='M8 44c2-10 8-14 16-14s14 4 16 14z' fill='%2338d6ff'/%3E%3C/svg%3E";

  const P = (uuid, nick, steam64, elo, level, country, avatar) => ({
    uuid,
    nick,
    steam64,
    elo,
    level,
    country,
    avatar: avatar || null,
  });

  const TEAMS = [
    {
      name: "Mix Masters",
      roster: [
        P("u-a1", "kolyapetrovv", "76561198000000001", 2841, 10, "ru", AVATAR),
        P("u-a2", "xXx_LongNicknameThatTruncates_xXx", "76561198000000002", 1560, 7, "de"),
        P("u-a3", "fresh_frag01", "76561198000000003", null, 1, "gb"),
        P("u-a4", "MapleScope", "76561198000000004", 1832, 8, "ca"),
        P("u-a5", "t0xic_shot", "76561198000000005", 2105, 9, "pl"),
      ],
    },
    {
      name: "ex-RUSTEC",
      roster: [
        P("u-b1", "v1rt_master", "76561198000000006", 2650, 10, "ua"),
        P("u-b2", "premier_goliath", "76561198000000007", 2380, 10, "se"),
        P("u-b3", "qu1et_aim", "76561198000000008", 1795, 8, "fi"),
        P("u-b4", "ru5tec_old", "76561198000000009", 1410, 6, "ru"),
        P("u-b5", "bomber_zn", "76561198000000010", 1180, 5, "kz"),
      ],
    },
  ];

  // Deterministic W/L string: fixed prefix (controls the streak), then a
  // seeded pattern targeting ~wr% wins. No Math.random anywhere.
  function wl(n, prefix, seed, wr) {
    let s = prefix;
    for (let i = prefix.length; i < n; i++) {
      s += (i * seed + 3) % 100 < wr ? "W" : "L";
    }
    return s.slice(0, n);
  }

  // Rows newest-first, matching SRApi.eloHistory: maps expands {map: plays}
  // in order; the two most recent rows have elo:null (FACEIT lags elo).
  function hist(results, maps, kBase, dBase) {
    const seq = [];
    for (const map of Object.keys(maps)) {
      for (let i = 0; i < maps[map]; i++) seq.push(map);
    }
    const rows = [];
    for (let i = 0; i < results.length && i < seq.length; i++) {
      const win = results[i] === "W";
      rows.push({
        matchId: "mock-" + i,
        date: 1754352000000 - i * 43200000,
        map: seq[i],
        kills: kBase + ((i * 7) % 11) + (win ? 3 : 0),
        deaths: dBase + ((i * 5) % 9) + (win ? 0 : 3),
        win,
        elo: i < 2 ? null : 2000 - i * 5,
        delta: win ? 25 : -23,
      });
    }
    return rows;
  }

  const HISTS = {
    "u-a1": hist(
      wl(30, "WWWW", 7, 58),
      { de_mirage: 11, de_dust2: 6, de_inferno: 5, de_nuke: 4, de_train: 2, de_anubis: 2 },
      18, 11,
    ),
    "u-a2": hist(
      wl(24, "LL", 11, 48),
      { de_mirage: 8, de_dust2: 6, de_inferno: 4, de_nuke: 3, de_train: 2, de_anubis: 1 },
      14, 13,
    ),
    "u-a3": null, // brand-new player — no history at all
    "u-a4": hist(
      wl(18, "W", 13, 45),
      { de_mirage: 6, de_inferno: 5, de_dust2: 4, de_nuke: 2, de_anubis: 1 },
      15, 13,
    ),
    "u-a5": hist(
      wl(27, "LL", 17, 52),
      { de_mirage: 9, de_dust2: 7, de_nuke: 5, de_inferno: 4, de_train: 1, de_anubis: 1 },
      16, 12,
    ),
    "u-b1": hist(
      wl(30, "WWWWWW", 19, 60),
      { de_dust2: 10, de_mirage: 7, de_ancient: 5, de_nuke: 4, de_inferno: 3, de_anubis: 1 },
      18, 12,
    ),
    "u-b2": hist(
      wl(28, "WWW", 23, 57),
      { de_dust2: 9, de_ancient: 6, de_mirage: 5, de_nuke: 4, de_inferno: 4 },
      17, 12,
    ),
    "u-b3": hist(
      wl(22, "L", 29, 50),
      { de_dust2: 8, de_mirage: 6, de_ancient: 3, de_inferno: 3, de_nuke: 2 },
      15, 13,
    ),
    "u-b4": hist(
      wl(15, "LL", 31, 44),
      { de_dust2: 6, de_ancient: 4, de_mirage: 3, de_anubis: 2 },
      13, 14,
    ),
    "u-b5": hist(
      wl(12, "W", 37, 50),
      { de_dust2: 5, de_mirage: 4, de_ancient: 2, de_nuke: 1 },
      12, 14,
    ),
  };

  const url = (sid) => "https://csrun.win/p/" + sid;
  const CMS = {
    "76561198000000001": { cheat: { score: 12, band: "verylow" }, premier: 24750, faceitElo: 2841, kd: 1.31, gap: 0.12, banned: false, leetify: 78, profileUrl: url("76561198000000001") },
    "76561198000000002": { cheat: { score: 34, band: "moderate" }, premier: 14300, faceitElo: 1560, kd: 1.02, gap: -0.08, banned: false, leetify: 55, profileUrl: url("76561198000000002") },
    "76561198000000003": { cheat: { score: 41, band: "moderate", lowConfidence: true }, premier: null, faceitElo: null, kd: null, gap: null, banned: false, leetify: null, profileUrl: url("76561198000000003") },
    "76561198000000004": { cheat: { score: 22, band: "low" }, premier: 15600, faceitElo: 1832, kd: 1.11, gap: 0.05, banned: false, leetify: 61, profileUrl: url("76561198000000004") },
    "76561198000000005": { cheat: { score: 48, band: "moderate" }, premier: 19850, faceitElo: 2105, kd: 1.18, gap: 0.31, banned: false, leetify: null, profileUrl: url("76561198000000005") },
    "76561198000000006": { cheat: { score: 97, band: "veryhigh" }, premier: 22100, faceitElo: 2650, kd: 1.44, gap: 0.62, banned: true, leetify: 71, profileUrl: url("76561198000000006") },
    "76561198000000007": { cheat: { score: 74, band: "high" }, premier: 30450, faceitElo: 2380, kd: 1.36, gap: 0.4, banned: false, leetify: 89, profileUrl: url("76561198000000007") },
    "76561198000000008": { cheat: { score: 18, band: "verylow" }, premier: 17400, faceitElo: 1795, kd: 1.08, gap: 0.02, banned: false, leetify: 66, profileUrl: url("76561198000000008") },
    "76561198000000009": { cheat: { score: 29, band: "low" }, premier: 9800, faceitElo: 1410, kd: 0.94, gap: -0.15, banned: false, leetify: 48, profileUrl: url("76561198000000009") },
    "76561198000000010": null, // CheatMeter has never seen this account
  };

  // Staggered, deterministic latencies so the progressive fill is visible.
  const HIST_DELAY = {
    "u-a1": 260, "u-a2": 720, "u-a3": 420, "u-a4": 980, "u-a5": 540,
    "u-b1": 340, "u-b2": 860, "u-b3": 460, "u-b4": 620, "u-b5": 1120,
  };
  const cmDelay = (sid) => 150 + (Number(String(sid).slice(-2)) % 10) * 95;

  window.SRSettings = {
    get: () =>
      Promise.resolve({
        enabled: true,
        "feature.matchroom": true,
        "feature.profile": true,
        "feature.steam": true,
        "feature.chips": true,
        apiBase: "https://csrun.win",
      }),
  };

  window.SRApi = {
    async user() {
      return null;
    },
    async room(roomId) {
      await wait(240);
      if (!roomId) return null;
      return {
        state: "READY",
        teams: TEAMS.map((t) => ({
          name: t.name,
          roster: t.roster.map((p) => ({ ...p })),
        })),
      };
    },
    async eloHistory(uuid, n) {
      await wait(HIST_DELAY[uuid] || 500);
      const rows = HISTS[uuid];
      return rows ? rows.slice(0, n || 30) : null;
    },
    async cheatmeter(q) {
      const sid = q && q.steamid;
      await wait(cmDelay(sid || "0"));
      return (sid && CMS[sid]) || null;
    },
  };

  // badge.js is not part of the fixture bundle, so SR carries no chip() here —
  // matchroom.js exercises its own fallback chip (production delegates to
  // SR.chip from badge.js, which fixtures for other modules cover).
  window.SR = window.SR || {};
})();
