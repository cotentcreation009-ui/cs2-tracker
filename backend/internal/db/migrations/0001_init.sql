-- 0001_init: core schema for the CS2 tracker.
--
-- Design notes:
--  * steam_id64 is stored as BIGINT. Individual SteamID64s fit comfortably in a
--    signed 64-bit integer, and the API serialises them as strings to avoid
--    JavaScript precision loss.
--  * match_players holds the per-match scoreboard plus the advanced metrics that
--    make this a tracker. player_careers is the rolling aggregate, recomputed on
--    write so profile reads are a single indexed lookup.

CREATE TABLE IF NOT EXISTS players (
    steam_id64   BIGINT PRIMARY KEY,
    persona_name TEXT        NOT NULL DEFAULT '',
    avatar_url   TEXT        NOT NULL DEFAULT '',
    profile_url  TEXT        NOT NULL DEFAULT '',
    vanity_url   TEXT        NOT NULL DEFAULT '',
    country_code TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
    id            BIGSERIAL PRIMARY KEY,
    share_code    TEXT UNIQUE,                 -- NULL for locally-ingested demos
    demo_source   TEXT        NOT NULL DEFAULT 'local',
    map           TEXT        NOT NULL DEFAULT 'unknown',
    game_mode     TEXT        NOT NULL DEFAULT '',
    played_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_s    INTEGER     NOT NULL DEFAULT 0,
    rounds_total  INTEGER     NOT NULL DEFAULT 0,
    team_a_score  INTEGER     NOT NULL DEFAULT 0, -- roster that started on T
    team_b_score  INTEGER     NOT NULL DEFAULT 0, -- roster that started on CT
    tick_rate     DOUBLE PRECISION NOT NULL DEFAULT 0,
    parsed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches (played_at DESC);

CREATE TABLE IF NOT EXISTS match_players (
    match_id        BIGINT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    steam_id64      BIGINT NOT NULL REFERENCES players (steam_id64) ON DELETE CASCADE,
    persona_name    TEXT    NOT NULL DEFAULT '',
    start_side      TEXT    NOT NULL DEFAULT '',
    rounds_played   INTEGER NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    assists         INTEGER NOT NULL DEFAULT 0,
    headshot_kills  INTEGER NOT NULL DEFAULT 0,
    damage          INTEGER NOT NULL DEFAULT 0,
    utility_damage  INTEGER NOT NULL DEFAULT 0,
    enemies_flashed INTEGER NOT NULL DEFAULT 0,
    kast_rounds     INTEGER NOT NULL DEFAULT 0,
    opening_kills   INTEGER NOT NULL DEFAULT 0,
    opening_deaths  INTEGER NOT NULL DEFAULT 0,
    clutches_won    INTEGER NOT NULL DEFAULT 0,
    clutches_lost   INTEGER NOT NULL DEFAULT 0,
    mvps            INTEGER NOT NULL DEFAULT 0,
    k1              INTEGER NOT NULL DEFAULT 0,
    k2              INTEGER NOT NULL DEFAULT 0,
    k3              INTEGER NOT NULL DEFAULT 0,
    k4              INTEGER NOT NULL DEFAULT 0,
    k5              INTEGER NOT NULL DEFAULT 0,
    adr             DOUBLE PRECISION NOT NULL DEFAULT 0,
    kast_pct        DOUBLE PRECISION NOT NULL DEFAULT 0,
    hs_pct          DOUBLE PRECISION NOT NULL DEFAULT 0,
    kd              DOUBLE PRECISION NOT NULL DEFAULT 0,
    kpr             DOUBLE PRECISION NOT NULL DEFAULT 0,
    dpr             DOUBLE PRECISION NOT NULL DEFAULT 0,
    rating          DOUBLE PRECISION NOT NULL DEFAULT 0,
    won             BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (match_id, steam_id64)
);

CREATE INDEX IF NOT EXISTS idx_match_players_steam ON match_players (steam_id64);

CREATE TABLE IF NOT EXISTS rounds (
    match_id    BIGINT  NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    winner_side TEXT    NOT NULL DEFAULT '',
    end_reason  TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (match_id, number)
);

CREATE TABLE IF NOT EXISTS kills (
    id           BIGSERIAL PRIMARY KEY,
    match_id     BIGINT  NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    round        INTEGER NOT NULL,
    time_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    killer_id    BIGINT,
    victim_id    BIGINT,
    assister_id  BIGINT,
    weapon       TEXT    NOT NULL DEFAULT '',
    headshot     BOOLEAN NOT NULL DEFAULT FALSE,
    opening      BOOLEAN NOT NULL DEFAULT FALSE,
    trade        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_kills_match ON kills (match_id, round);

CREATE TABLE IF NOT EXISTS player_careers (
    steam_id64     BIGINT PRIMARY KEY REFERENCES players (steam_id64) ON DELETE CASCADE,
    matches        INTEGER NOT NULL DEFAULT 0,
    wins           INTEGER NOT NULL DEFAULT 0,
    losses         INTEGER NOT NULL DEFAULT 0,
    rounds_played  INTEGER NOT NULL DEFAULT 0,
    kills          BIGINT  NOT NULL DEFAULT 0,
    deaths         BIGINT  NOT NULL DEFAULT 0,
    assists        BIGINT  NOT NULL DEFAULT 0,
    headshot_kills BIGINT  NOT NULL DEFAULT 0,
    damage         BIGINT  NOT NULL DEFAULT 0,
    kast_rounds    BIGINT  NOT NULL DEFAULT 0,
    opening_kills  BIGINT  NOT NULL DEFAULT 0,
    opening_deaths BIGINT  NOT NULL DEFAULT 0,
    clutches_won   BIGINT  NOT NULL DEFAULT 0,
    clutches_lost  BIGINT  NOT NULL DEFAULT 0,
    k1             BIGINT  NOT NULL DEFAULT 0,
    k2             BIGINT  NOT NULL DEFAULT 0,
    k3             BIGINT  NOT NULL DEFAULT 0,
    k4             BIGINT  NOT NULL DEFAULT 0,
    k5             BIGINT  NOT NULL DEFAULT 0,
    kd             DOUBLE PRECISION NOT NULL DEFAULT 0,
    adr            DOUBLE PRECISION NOT NULL DEFAULT 0,
    kast_pct       DOUBLE PRECISION NOT NULL DEFAULT 0,
    hs_pct         DOUBLE PRECISION NOT NULL DEFAULT 0,
    rating         DOUBLE PRECISION NOT NULL DEFAULT 0,
    win_rate       DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
