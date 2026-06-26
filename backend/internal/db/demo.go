package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// DemoJobStatus is the pollable status of a user-uploaded demo parse.
type DemoJobStatus struct {
	ID       string `json:"id"`
	Status   string `json:"status"` // queued | running | done | failed
	MapName  string `json:"map"`
	Filename string `json:"filename"`
	Error    string `json:"error,omitempty"`
}

// CreateDemoJob records a queued demo parse before it's enqueued.
func (d *DB) CreateDemoJob(ctx context.Context, id, clientIP, filename string, sizeBytes int64) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO demo_results (id, status, client_ip, filename, size_bytes)
		VALUES ($1, 'queued', $2, $3, $4)`, id, clientIP, filename, sizeBytes)
	return err
}

// CreateDemoJobIfAbsent inserts an 'enqueued' demo row, returning false if a row
// with this id already exists. The direct-upload parse trigger uses this to be
// idempotent: a second /parse for the same id is a no-op, so a double-click,
// retry, or at-least-once redelivery can't re-enqueue work or clobber a finished
// result.
func (d *DB) CreateDemoJobIfAbsent(ctx context.Context, id, clientIP string) (bool, error) {
	tag, err := d.Pool.Exec(ctx, `
		INSERT INTO demo_results (id, status, client_ip)
		VALUES ($1, 'enqueued', $2)
		ON CONFLICT (id) DO NOTHING`, id, clientIP)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// SetDemoStatus updates a demo job's status (e.g. running / failed). It never
// overwrites a completed result, so a late or failed re-run can't bury a 'done'
// row (whose still-present data would otherwise become unreachable).
func (d *DB) SetDemoStatus(ctx context.Context, id, status, errMsg string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE demo_results SET status=$2, error=NULLIF($3,''), updated_at=now()
		WHERE id=$1 AND status <> 'done'`,
		id, status, errMsg)
	return err
}

// SaveDemoResult stores the gzipped normalized replay JSON and marks it done. It
// returns ErrNotFound when no row matched, so a parse that ran against a missing
// row surfaces as a failure instead of a phantom success.
func (d *DB) SaveDemoResult(ctx context.Context, id, mapName string, gzipData []byte) error {
	tag, err := d.Pool.Exec(ctx, `
		UPDATE demo_results SET status='done', map_name=$2, data=$3, error=NULL, updated_at=now()
		WHERE id=$1`, id, mapName, gzipData)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetDemoJob returns a demo job's pollable status.
func (d *DB) GetDemoJob(ctx context.Context, id string) (DemoJobStatus, error) {
	var s DemoJobStatus
	err := d.Pool.QueryRow(ctx, `
		SELECT id, status, COALESCE(map_name,''), COALESCE(filename,''), COALESCE(error,'')
		FROM demo_results WHERE id=$1`, id).
		Scan(&s.ID, &s.Status, &s.MapName, &s.Filename, &s.Error)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	return s, err
}

// GetDemoData returns the gzipped normalized replay JSON for a finished demo.
func (d *DB) GetDemoData(ctx context.Context, id string) (data []byte, mapName string, err error) {
	err = d.Pool.QueryRow(ctx, `
		SELECT data, COALESCE(map_name,'') FROM demo_results
		WHERE id=$1 AND status='done' AND data IS NOT NULL`, id).Scan(&data, &mapName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	return data, mapName, err
}

// CountDemoJobsSince counts all demo jobs created since t (global quota).
func (d *DB) CountDemoJobsSince(ctx context.Context, t time.Time) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM demo_results WHERE created_at >= $1`, t).Scan(&n)
	return n, err
}

// CountDemoJobsByIPSince counts demo jobs from one IP since t (per-IP quota).
func (d *DB) CountDemoJobsByIPSince(ctx context.Context, ip string, t time.Time) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM demo_results WHERE client_ip=$1 AND created_at >= $2`, ip, t).Scan(&n)
	return n, err
}
