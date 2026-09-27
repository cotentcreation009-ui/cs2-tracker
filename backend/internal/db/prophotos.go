package db

import (
	"context"
	"strings"
)

// ProPhoto is one nick → Liquipedia photo URL pair, reported by a visitor's
// browser after it resolved the photo itself (see internal/api/prophotos.go
// for why the browser, and for what the URL is checked against before it
// lands here).
type ProPhoto struct {
	Nick string
	URL  string
}

func proPhotoKey(nick string) string {
	return strings.ToLower(strings.TrimSpace(nick))
}

// UpsertProPhotos records reported photos, newest report winning. A nick that
// trims to nothing is skipped rather than stored under an empty key.
func (d *DB) UpsertProPhotos(ctx context.Context, photos []ProPhoto) error {
	for _, p := range photos {
		key := proPhotoKey(p.Nick)
		if key == "" || p.URL == "" {
			continue
		}
		if _, err := d.Pool.Exec(ctx, `
			INSERT INTO pro_photos (nick_key, nick, url)
			VALUES ($1, $2, $3)
			ON CONFLICT (nick_key) DO UPDATE
			SET url = EXCLUDED.url,
			    nick = EXCLUDED.nick,
			    reports = pro_photos.reports + 1,
			    reported_at = now()`,
			key, strings.TrimSpace(p.Nick), p.URL); err != nil {
			return err
		}
	}
	return nil
}

// ProPhotos returns the known photo URL for each of the nicks that has one,
// keyed by the lower-cased, trimmed nick. Nicks nobody has reported are simply
// absent — the browser then resolves them and reports them for next time.
func (d *DB) ProPhotos(ctx context.Context, nicks []string) (map[string]string, error) {
	keys := make([]string, 0, len(nicks))
	seen := make(map[string]bool, len(nicks))
	for _, n := range nicks {
		if k := proPhotoKey(n); k != "" && !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	out := make(map[string]string, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	rows, err := d.Pool.Query(ctx, `SELECT nick_key, url FROM pro_photos WHERE nick_key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, u string
		if err := rows.Scan(&k, &u); err != nil {
			return nil, err
		}
		out[k] = u
	}
	return out, rows.Err()
}
