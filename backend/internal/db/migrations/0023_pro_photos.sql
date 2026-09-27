-- Pro-player photos, as resolved by visitors' browsers from Liquipedia and
-- reported back (api/prophotos.go). The backend cannot resolve them itself:
-- Liquipedia rate-limits datacenter IPs, so every server-side attempt hangs
-- or 429s. One row per nick; the newest honest report wins, and the spotlight
-- response hands the whole map to the next visitor so their page paints its
-- photos at once instead of after a paced lookup.
CREATE TABLE IF NOT EXISTS pro_photos (
    nick_key    TEXT PRIMARY KEY,
    nick        TEXT NOT NULL,
    url         TEXT NOT NULL,
    reports     INTEGER NOT NULL DEFAULT 1,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
