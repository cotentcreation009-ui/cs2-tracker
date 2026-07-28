-- Pro-match win predictions ledger: one row per series, written ONCE when the
-- estimate is first computed for an UPCOMING match — predictions can never be
-- revised after the fact, which is what makes the model's public record
-- honest. winner/correct fill in at lazy reconciliation once the series
-- finishes.
CREATE TABLE IF NOT EXISTS pro_predictions (
    series_id   TEXT PRIMARY KEY,
    made_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    model       TEXT NOT NULL,
    p_a         DOUBLE PRECISION NOT NULL,
    team_a_id   TEXT NOT NULL,
    team_b_id   TEXT NOT NULL,
    team_a_name TEXT NOT NULL DEFAULT '',
    team_b_name TEXT NOT NULL DEFAULT '',
    winner_id   TEXT,
    correct     BOOLEAN,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pro_predictions_unresolved
    ON pro_predictions (made_at)
    WHERE resolved_at IS NULL;
