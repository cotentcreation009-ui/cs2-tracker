-- Durable CS2 inventory snapshots. Steam rate-limits its public inventory
-- endpoint per source IP, and every request from the site shares ONE datacenter
-- IP — so a cache that only lives in Redis means a restart or an eviction sends
-- the whole site back to hammering Steam and earning another 429 block.
-- Persisting the last successful read means a profile that was fetched once
-- stays viewable forever (labelled with its age), and Steam is only asked again
-- when the snapshot is genuinely old.
CREATE TABLE IF NOT EXISTS inventory_snapshots (
    steam_id   BIGINT PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload    JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS inventory_snapshots_fetched
    ON inventory_snapshots (fetched_at);
