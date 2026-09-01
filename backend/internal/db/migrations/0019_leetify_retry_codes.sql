-- Share codes whose Leetify report did not exist yet when we first asked.
--
-- The chain walker finds a match's code within minutes of the final round,
-- but Leetify needs up to a couple of hours to process the demo. Asking too
-- early gets a 404 that is indistinguishable from "nobody in that lobby is a
-- Leetify user, this match will never exist" — and the walker has already
-- advanced past the code, so without this table the freshest matches (the
-- entire point of connecting an account) would be permanently dropped by the
-- race between our discovery and their processing.
--
-- Rows are retried on later syncs and expire after a day: a report that has
-- not appeared by then genuinely is never coming.
CREATE TABLE IF NOT EXISTS leetify_retry_codes (
    share_code TEXT PRIMARY KEY,
    steam_id   BIGINT NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_try   TIMESTAMPTZ NOT NULL DEFAULT now(),
    tries      INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS leetify_retry_codes_player
    ON leetify_retry_codes (steam_id, first_seen);
