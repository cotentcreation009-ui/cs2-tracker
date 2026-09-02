-- Ladder standing at match time, on the stored match rows.
--
-- Leetify's MATCH-REPORT endpoint (the one the bridge fetches by share code)
-- carries no rank at all, which is why the rank column has been dashed on
-- every bridged profile. Their legacy per-GAME endpoint does carry it, in a
-- matchmakingGameStats block — the site already reads it for the expanded
-- scoreboard, one match at a time, lazily, and then throws it away.
--
-- Persisting it turns that per-expand fetch into a one-time cost and fills the
-- column for every row in the list.
ALTER TABLE leetify_match_players
    ADD COLUMN IF NOT EXISTS rank_type   INTEGER,  -- 11 = Premier, 12 = Competitive
    ADD COLUMN IF NOT EXISTS rank_after  INTEGER,
    ADD COLUMN IF NOT EXISTS rank_before INTEGER;

-- Matches whose rank has been fetched, so the enrichment pass knows what is
-- left to do. Separate from the columns because "fetched and there was no
-- rank" (an unrated lobby) and "not fetched yet" are different states, and
-- conflating them would make the pass retry unrated matches forever.
ALTER TABLE leetify_matches
    ADD COLUMN IF NOT EXISTS rank_fetched_at TIMESTAMPTZ;
