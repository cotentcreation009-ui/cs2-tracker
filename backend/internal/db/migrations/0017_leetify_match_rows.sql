-- Per-player rows from Leetify match reports.
--
-- Leetify's PROFILE endpoints answer only for accounts registered with them,
-- but their MATCH endpoints still carry a row for every player in the lobby.
-- Storing those rows lets a player Leetify will not describe be assembled from
-- the matches they played — and because one fetched match writes all ten rows,
-- coverage compounds across every profile anyone views.
--
-- Two properties this table exists to guarantee:
--
--  1. A share code is fetched ONCE, ever. Finished matches are immutable
--     upstream (byte-identical responses) and the API ignores conditional
--     requests, so re-fetching spends a scarce rate budget to learn nothing.
--  2. It is EVICTABLE IN ONE STATEMENT. Leetify's developer guidelines oblige
--     us to delete stored data that ceases to be available from their API, so
--     this lives in its own table with no foreign keys pointing at it:
--         TRUNCATE leetify_match_players, leetify_matches;
CREATE TABLE IF NOT EXISTS leetify_matches (
    -- Leetify's own match id (a uuid), which is also the View-on-Leetify key.
    match_id     TEXT PRIMARY KEY,
    -- 'matchmaking' | 'faceit' | 'hltv'
    data_source  TEXT NOT NULL,
    -- The share code for matchmaking games; whatever the source's own id is
    -- otherwise. Unique so a code is never fetched twice.
    source_id    TEXT,
    map_name     TEXT,
    finished_at  TIMESTAMPTZ,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload      JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS leetify_matches_source
    ON leetify_matches (data_source, source_id)
    WHERE source_id IS NOT NULL;

-- One row per player per match. The columns are the fields the CheatMeter
-- scores; the rest of Leetify's schema stays in leetify_matches.payload rather
-- than being widened into columns nobody reads.
CREATE TABLE IF NOT EXISTS leetify_match_players (
    match_id      TEXT   NOT NULL REFERENCES leetify_matches(match_id) ON DELETE CASCADE,
    steam_id      BIGINT NOT NULL,
    finished_at   TIMESTAMPTZ,

    -- The demo-derived tells. No scoreboard aggregator has these, and they are
    -- the reason this pipeline exists.
    preaim        DOUBLE PRECISION,
    reaction_time DOUBLE PRECISION,
    accuracy_head DOUBLE PRECISION,
    accuracy      DOUBLE PRECISION,
    spray_accuracy DOUBLE PRECISION,

    leetify_rating DOUBLE PRECISION,
    kd_ratio      DOUBLE PRECISION,
    dpr           DOUBLE PRECISION,
    total_kills   INTEGER,
    total_deaths  INTEGER,
    rounds_count  INTEGER,

    PRIMARY KEY (match_id, steam_id)
);

-- The read path: every match we hold for one player, newest first.
CREATE INDEX IF NOT EXISTS leetify_match_players_player
    ON leetify_match_players (steam_id, finished_at DESC);
