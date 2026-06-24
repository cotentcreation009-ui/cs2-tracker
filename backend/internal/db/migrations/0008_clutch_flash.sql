-- 0008_clutch_flash: richer per-match utility & clutch capture.
--   flash_duration  REAL  — total seconds of enemy blindness the player dealt
--                           (a real flashbang grade, vs the raw "enemies flashed"
--                           count we already store).
--   clutch_matrix   JSONB — 1vX won/lost distribution {"wonBySize":[..],
--                           "lostBySize":[..]} indexed by opponent count 1..5,
--                           which unlocks a clutch matrix and situational
--                           win-rates.
-- Both are written by the demo parser; existing rows default to empty.

ALTER TABLE match_players
    ADD COLUMN IF NOT EXISTS flash_duration REAL  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS clutch_matrix  JSONB NOT NULL DEFAULT '{}';
