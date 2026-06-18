-- 0002_jobs: track the lifecycle of demo-parse jobs so the ingest endpoint can
-- hand back an id the caller can poll. The queue itself stays fire-and-forget;
-- this table is the durable status record (queued -> running -> done | failed).

CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,                 -- the queue job id
    type       TEXT        NOT NULL DEFAULT 'parse_demo',
    status     TEXT        NOT NULL DEFAULT 'queued', -- queued | running | done | failed
    source     TEXT        NOT NULL DEFAULT '',
    demo_path  TEXT        NOT NULL DEFAULT '',
    demo_url   TEXT        NOT NULL DEFAULT '',
    share_code TEXT        NOT NULL DEFAULT '',
    match_id   BIGINT,                           -- set when status = done
    error      TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at DESC);
