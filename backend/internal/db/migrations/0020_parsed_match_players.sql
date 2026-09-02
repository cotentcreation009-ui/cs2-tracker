-- Per-player stats from demos CSRun parsed itself.
--
-- Deliberately separate from leetify_match_players. That table mirrors another
-- company's numbers and lives under their guidelines (evictable, unrenamed,
-- attributed). This one is ours: computed from a demo we downloaded and
-- parsed, owned outright, and safe to keep, publish and calibrate against.
-- Keeping them apart is also what lets the page honestly label which is which.
--
-- Some of this exists nowhere else. Premier rating is in the demo and in no
-- API we can reach — not Leetify's, not Valve's.
CREATE TABLE IF NOT EXISTS parsed_matches (
    -- The share code is the stable key: it identifies the match everywhere
    -- else in this pipeline, and it is what we fetched the demo by.
    share_code  TEXT PRIMARY KEY,
    map_name    TEXT,
    finished_at TIMESTAMPTZ,
    rounds      INTEGER,
    parsed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parsed_match_players (
    share_code TEXT   NOT NULL REFERENCES parsed_matches(share_code) ON DELETE CASCADE,
    steam_id   BIGINT NOT NULL,
    name       TEXT,

    -- Premier rating carried in and out. NULL means the demo said nothing (an
    -- uncalibrated player) and must render as a dash, never as a rating of 0.
    rank_old    INTEGER,
    rank_new    INTEGER,
    rank_change INTEGER,

    kills   INTEGER,
    deaths  INTEGER,
    assists INTEGER,
    hs_kills INTEGER,
    damage  INTEGER,
    rounds  INTEGER,

    shots    INTEGER,
    hits     INTEGER,
    hs_hits  INTEGER,
    leg_hits INTEGER,

    reaction_ms DOUBLE PRECISION,
    preaim      DOUBLE PRECISION,
    snap_kills  INTEGER,

    opening_kills  INTEGER,
    opening_deaths INTEGER,

    -- Kill context no scoreboard carries.
    wallbangs     INTEGER,
    through_smoke INTEGER,
    no_scopes     INTEGER,
    blind_kills   INTEGER,

    -- Our own 0-100 aim read. Stored because the inputs are stored too, so a
    -- recalibrated formula can be re-derived without re-downloading demos
    -- Valve has since deleted.
    aim_rating DOUBLE PRECISION,

    PRIMARY KEY (share_code, steam_id)
);

CREATE INDEX IF NOT EXISTS parsed_match_players_by_player
    ON parsed_match_players (steam_id);
