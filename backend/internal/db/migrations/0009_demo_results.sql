-- User-uploaded demo analysis results (server-side parse). Kept separate from
-- the trusted match/career tables: these are private, per-browser demo replays
-- and must never feed leaderboards or cross-user profiles. The normalized replay
-- JSON is stored gzipped in `data`; the raw .dem is deleted after parsing.
CREATE TABLE IF NOT EXISTS demo_results (
    id          TEXT PRIMARY KEY,                       -- = parse job id
    status      TEXT NOT NULL DEFAULT 'queued',         -- queued | running | done | failed
    client_ip   TEXT,                                   -- for per-IP quota
    filename    TEXT,
    map_name    TEXT,
    size_bytes  BIGINT,                                 -- raw .dem size
    error       TEXT,
    data        BYTEA,                                  -- gzipped normalized replay JSON (null until done)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_results_created ON demo_results (created_at);
CREATE INDEX IF NOT EXISTS idx_demo_results_ip_created ON demo_results (client_ip, created_at);
