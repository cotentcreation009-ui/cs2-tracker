-- 0006_career_utility: surface utility & impact in the rolling career aggregate.
-- These are already stored per match (match_players.utility_damage,
-- enemies_flashed, mvps) but were never rolled up. Add the columns and backfill
-- existing careers from the per-match rows so profiles light up without waiting
-- for the next demo to recompute.

ALTER TABLE player_careers
    ADD COLUMN IF NOT EXISTS utility_damage  BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS enemies_flashed BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mvps            BIGINT NOT NULL DEFAULT 0;

UPDATE player_careers pc SET
    utility_damage  = sub.ud,
    enemies_flashed = sub.ef,
    mvps            = sub.mvps
FROM (
    SELECT steam_id64,
           COALESCE(SUM(utility_damage), 0)  AS ud,
           COALESCE(SUM(enemies_flashed), 0) AS ef,
           COALESCE(SUM(mvps), 0)            AS mvps
    FROM match_players
    GROUP BY steam_id64
) sub
WHERE pc.steam_id64 = sub.steam_id64;
