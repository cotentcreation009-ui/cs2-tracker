package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// AuthChain is one connected account's walking state. AuthCode is a credential
// and must never leave the backend.
type AuthChain struct {
	SteamID  uint64
	AuthCode string
	HeadCode string
	Status   string // active | needs_reseed | revoked
	WalkedAt time.Time
}

// ErrNoChain reports that an account has not connected its match history.
var ErrNoChain = errors.New("no auth chain for this account")

// UpsertAuthChain connects (or re-seeds) an account. Always resets the status
// to active: the owner handing over fresh codes is exactly the recovery path
// for needs_reseed and revoked.
func (d *DB) UpsertAuthChain(ctx context.Context, steamID uint64, authCode, headCode string) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO match_auth_codes (steam_id, auth_code, head_code, status, updated_at)
		VALUES ($1, $2, $3, 'active', now())
		ON CONFLICT (steam_id) DO UPDATE
		   SET auth_code = EXCLUDED.auth_code,
		       head_code = EXCLUDED.head_code,
		       status    = 'active',
		       updated_at = now()`,
		int64(steamID), authCode, headCode)
	return err
}

// AuthChainFor returns one account's chain state, ErrNoChain when absent.
func (d *DB) AuthChainFor(ctx context.Context, steamID uint64) (AuthChain, error) {
	var c AuthChain
	var id int64
	var walked *time.Time
	err := d.Pool.QueryRow(ctx, `
		SELECT steam_id, auth_code, head_code, status, walked_at
		  FROM match_auth_codes WHERE steam_id = $1`, int64(steamID)).
		Scan(&id, &c.AuthCode, &c.HeadCode, &c.Status, &walked)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNoChain
	}
	if err != nil {
		return c, err
	}
	c.SteamID = uint64(id)
	if walked != nil {
		c.WalkedAt = *walked
	}
	return c, nil
}

// ActiveAuthChains lists connected accounts in walking order, least recently
// walked first, so a stalled account cannot starve the others.
func (d *DB) ActiveAuthChains(ctx context.Context, limit int) ([]AuthChain, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT steam_id, auth_code, head_code, status, walked_at
		  FROM match_auth_codes
		 WHERE status = 'active'
		 ORDER BY walked_at ASC NULLS FIRST
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuthChain
	for rows.Next() {
		var c AuthChain
		var id int64
		var walked *time.Time
		if err := rows.Scan(&id, &c.AuthCode, &c.HeadCode, &c.Status, &walked); err != nil {
			return nil, err
		}
		c.SteamID = uint64(id)
		if walked != nil {
			c.WalkedAt = *walked
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AdvanceAuthChain moves the head forward after a walk and stamps walked_at.
// Called with the head unchanged too — the stamp is what spaces out polling.
func (d *DB) AdvanceAuthChain(ctx context.Context, steamID uint64, headCode string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE match_auth_codes
		   SET head_code = $2, walked_at = now(), updated_at = now()
		 WHERE steam_id = $1`, int64(steamID), headCode)
	return err
}

// MarkAuthChain records a terminal walk outcome (needs_reseed / revoked) so the
// poller stops burning API budget on an account only the owner can fix.
func (d *DB) MarkAuthChain(ctx context.Context, steamID uint64, status string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE match_auth_codes
		   SET status = $2, walked_at = now(), updated_at = now()
		 WHERE steam_id = $1`, int64(steamID), status)
	return err
}
