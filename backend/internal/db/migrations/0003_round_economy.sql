-- 0003_round_economy: per-round buy types and team equipment values, captured
-- at freeze-time end. Buy thresholds are heuristic (see internal/stats) and
-- tunable as we gather real-demo data.

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ct_buy         TEXT    NOT NULL DEFAULT '';
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS t_buy          TEXT    NOT NULL DEFAULT '';
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ct_equip_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS t_equip_value  INTEGER NOT NULL DEFAULT 0;
