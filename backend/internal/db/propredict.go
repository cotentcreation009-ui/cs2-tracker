package db

import (
	"context"
)

// ProPredictionRow is an unresolved ledger entry awaiting its outcome.
type ProPredictionRow struct {
	SeriesID string
	PA       float64
	TeamAID  string
}

// ProPredictionRecord is the model's resolved track record.
type ProPredictionRecord struct {
	Model   string `json:"model"`
	N       int    `json:"n"`
	Correct int    `json:"correct"`
}

// InsertProPrediction writes a series' FIRST pre-match estimate; later
// computations are no-ops (the ledger is append-once so the record stays
// honest — no revising a call after the odds moved).
func (d *DB) InsertProPrediction(ctx context.Context, seriesID, model string, pA float64, aID, bID, aName, bName string) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO pro_predictions (series_id, model, p_a, team_a_id, team_b_id, team_a_name, team_b_name)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (series_id) DO NOTHING`,
		seriesID, model, pA, aID, bID, aName, bName)
	return err
}

// ListUnresolvedProPredictions returns the oldest ledger entries still waiting
// for an outcome (bounded — reconciliation is lazy and best-effort).
func (d *DB) ListUnresolvedProPredictions(ctx context.Context, limit int) ([]ProPredictionRow, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT series_id, p_a, team_a_id FROM pro_predictions
		WHERE resolved_at IS NULL ORDER BY made_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProPredictionRow
	for rows.Next() {
		var r ProPredictionRow
		if err := rows.Scan(&r.SeriesID, &r.PA, &r.TeamAID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ResolveProPrediction records a series' outcome against its pre-match call.
func (d *DB) ResolveProPrediction(ctx context.Context, seriesID, winnerID string, correct bool) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE pro_predictions SET winner_id=$2, correct=$3, resolved_at=now()
		WHERE series_id=$1 AND resolved_at IS NULL`, seriesID, winnerID, correct)
	return err
}

// GetProPredictionRecord returns the model's resolved W-L record.
func (d *DB) GetProPredictionRecord(ctx context.Context, model string) (ProPredictionRecord, error) {
	rec := ProPredictionRecord{Model: model}
	err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE correct)
		FROM pro_predictions WHERE model=$1 AND resolved_at IS NOT NULL`, model).
		Scan(&rec.N, &rec.Correct)
	return rec, err
}
