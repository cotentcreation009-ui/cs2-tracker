-- 0004_demo_hash: dedupe identical demos (parse-once). A re-ingested file with
-- the same content hash reuses the existing match instead of double-counting.
-- Partial unique index so the many ''/seed rows (no hash) don't collide.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS demo_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_demo_hash
    ON matches (demo_hash) WHERE demo_hash <> '';
