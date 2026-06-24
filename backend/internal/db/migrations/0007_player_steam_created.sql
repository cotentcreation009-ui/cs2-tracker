-- 0007_player_steam_created: store the Steam account creation time
-- (GetPlayerSummaries.timecreated, only present for public profiles) so the
-- profile can show account age. NULL until the player is hydrated/refreshed from
-- Steam with a public profile.

ALTER TABLE players ADD COLUMN IF NOT EXISTS steam_created_at TIMESTAMPTZ;
