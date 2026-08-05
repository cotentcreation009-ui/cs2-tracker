package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// GetInventorySnapshot returns the last successfully fetched inventory for a
// player and how old it is. ok is false when we have never read theirs.
func (d *DB) GetInventorySnapshot(ctx context.Context, steamID uint64) (payload []byte, fetchedAt time.Time, ok bool, err error) {
	err = d.Pool.QueryRow(ctx,
		`SELECT payload, fetched_at FROM inventory_snapshots WHERE steam_id=$1`,
		int64(steamID)).Scan(&payload, &fetchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, time.Time{}, false, nil
	}
	if err != nil {
		return nil, time.Time{}, false, err
	}
	return payload, fetchedAt, true, nil
}

// SaveInventorySnapshot records a fresh read, replacing any earlier one.
func (d *DB) SaveInventorySnapshot(ctx context.Context, steamID uint64, payload []byte) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO inventory_snapshots (steam_id, fetched_at, payload)
		VALUES ($1, now(), $2)
		ON CONFLICT (steam_id) DO UPDATE SET fetched_at = now(), payload = EXCLUDED.payload`,
		int64(steamID), payload)
	return err
}
