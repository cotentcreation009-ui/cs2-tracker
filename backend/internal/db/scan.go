package db

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// pgxQuerier is satisfied by both *pgxpool.Pool and pgx.Tx, letting read helpers
// run either on the pool directly or inside a transaction.
type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
