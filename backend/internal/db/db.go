// Package db owns the Postgres connection pool, schema migrations and all SQL
// access for the backend. It is the single source of truth: the parser produces
// models, this package persists them and recomputes career aggregates on write.
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by read methods when no row matches.
var ErrNotFound = errors.New("db: not found")

//go:embed migrations/*.sql
var migrationFS embed.FS

// DB wraps a pgx connection pool.
type DB struct {
	Pool *pgxpool.Pool
}

// Connect opens (and pings) a pooled connection to Postgres.
func Connect(ctx context.Context, url string) (*DB, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}

// Close releases the pool.
func (d *DB) Close() {
	if d.Pool != nil {
		d.Pool.Close()
	}
}

// Ping verifies database connectivity (used by the API readiness check).
func (d *DB) Ping(ctx context.Context) error { return d.Pool.Ping(ctx) }

// migrateLockID is an arbitrary constant identifying this application's
// migration lock. Any value works as long as nothing else in the database
// picks the same one.
const migrateLockID int64 = 0x63733272756E6D67 // "cs2runmg"

// Migrate applies any embedded migrations that have not yet run, in filename
// order, tracked in schema_migrations.
//
// Serialized across processes with a session advisory lock, because "safe to
// call on every service start" was previously only true when starts did not
// overlap. The api and worker containers boot together, and CREATE TABLE IF
// NOT EXISTS is not atomic against a concurrent creation: both transactions
// see no table, both create it, and the loser dies on a duplicate key in
// pg_type — which is exactly how a worker crashed on 0020 in production.
//
// The lock is taken on a dedicated connection and held for the whole run, so
// the second process waits and then finds every migration already recorded.
func (d *DB) Migrate(ctx context.Context) error {
	conn, err := d.Pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("db: acquire migration lock conn: %w", err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, migrateLockID); err != nil {
		return fmt.Errorf("db: take migration lock: %w", err)
	}
	defer func() {
		// Best-effort: releasing the session lock explicitly returns the
		// connection to the pool clean; dropping the connection would release
		// it anyway.
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, migrateLockID)
	}()

	if _, err := d.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("db: create schema_migrations: %w", err)
	}

	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("db: read migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		version := strings.TrimSuffix(name, ".sql")

		var exists bool
		if err := d.Pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)`, version,
		).Scan(&exists); err != nil {
			return fmt.Errorf("db: check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		content, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("db: read migration %s: %w", name, err)
		}

		if err := withTx(ctx, d.Pool, func(tx pgx.Tx) error {
			// No-arg Exec uses the simple protocol, allowing multiple statements.
			if _, err := tx.Exec(ctx, string(content)); err != nil {
				return fmt.Errorf("apply %s: %w", name, err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO schema_migrations (version) VALUES ($1)`, version,
			); err != nil {
				return fmt.Errorf("record %s: %w", name, err)
			}
			return nil
		}); err != nil {
			return fmt.Errorf("db: migration %s failed: %w", name, err)
		}
	}
	return nil
}

// withTx runs fn inside a transaction, committing on success and rolling back on
// error or panic.
func withTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
