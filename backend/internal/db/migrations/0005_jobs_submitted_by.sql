-- 0005_jobs_submitted_by: attribute a parse job to the Steam account that
-- submitted it (set when the user is signed in via "Sign in through Steam").
-- Empty string = anonymous/unattributed ingest. Stored as TEXT (SteamID64) to
-- match the other id-ish columns and sidestep bigint/JSON precision concerns.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS submitted_by TEXT NOT NULL DEFAULT '';

-- Partial index so a future "my recent ingests" lookup is cheap without the many
-- anonymous ('') rows bloating it.
CREATE INDEX IF NOT EXISTS idx_jobs_submitted_by
    ON jobs (submitted_by, created_at DESC) WHERE submitted_by <> '';
