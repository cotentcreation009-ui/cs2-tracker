package db

import (
	"context"
	"time"

	"github.com/cs2tracker/server/internal/parser"
)

// Storage for demos CSRun parsed itself. Kept apart from the Leetify mirror on
// purpose: this data is ours, and the page must be able to say so.

// ParsedRow is one player's line from one demo we parsed.
type ParsedRow struct {
	ShareCode  string    `json:"shareCode"`
	MapName    string    `json:"mapName,omitempty"`
	FinishedAt time.Time `json:"finishedAt,omitempty"`
	parser.PlayerSummary
}

// SaveParsedMatch writes a parsed demo's per-player rows.
//
// Idempotent: re-parsing the same share code overwrites, which is what makes a
// recalibrated aim rating a re-run rather than a migration.
func (d *DB) SaveParsedMatch(ctx context.Context, shareCode, mapName string, finishedAt time.Time, rounds int, players []parser.PlayerSummary) error {
	if shareCode == "" || len(players) == 0 {
		return nil
	}
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var fin any
	if !finishedAt.IsZero() {
		fin = finishedAt
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parsed_matches (share_code, map_name, finished_at, rounds)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (share_code) DO UPDATE
		   SET map_name = EXCLUDED.map_name,
		       finished_at = COALESCE(EXCLUDED.finished_at, parsed_matches.finished_at),
		       rounds = EXCLUDED.rounds,
		       parsed_at = now()`,
		shareCode, mapName, fin, rounds); err != nil {
		return err
	}

	for _, p := range players {
		if p.SteamID == 0 {
			continue
		}
		// Absent rank stays NULL rather than zero: a dash and "rating 0" are
		// very different claims about a player.
		var rOld, rNew, rChange any
		if p.RankNew > 0 {
			rNew = p.RankNew
			if p.RankOld > 0 {
				rOld = p.RankOld
			}
			if p.RankChange != 0 {
				rChange = p.RankChange
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO parsed_match_players (
				share_code, steam_id, name, rank_old, rank_new, rank_change,
				kills, deaths, assists, hs_kills, damage, rounds,
				shots, hits, hs_hits, leg_hits,
				reaction_ms, preaim, snap_kills,
				opening_kills, opening_deaths,
				wallbangs, through_smoke, no_scopes, blind_kills, aim_rating)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
			        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
			ON CONFLICT (share_code, steam_id) DO UPDATE SET
				name=EXCLUDED.name, rank_old=EXCLUDED.rank_old,
				rank_new=EXCLUDED.rank_new, rank_change=EXCLUDED.rank_change,
				kills=EXCLUDED.kills, deaths=EXCLUDED.deaths,
				assists=EXCLUDED.assists, hs_kills=EXCLUDED.hs_kills,
				damage=EXCLUDED.damage, rounds=EXCLUDED.rounds,
				shots=EXCLUDED.shots, hits=EXCLUDED.hits,
				hs_hits=EXCLUDED.hs_hits, leg_hits=EXCLUDED.leg_hits,
				reaction_ms=EXCLUDED.reaction_ms, preaim=EXCLUDED.preaim,
				snap_kills=EXCLUDED.snap_kills,
				opening_kills=EXCLUDED.opening_kills,
				opening_deaths=EXCLUDED.opening_deaths,
				wallbangs=EXCLUDED.wallbangs, through_smoke=EXCLUDED.through_smoke,
				no_scopes=EXCLUDED.no_scopes, blind_kills=EXCLUDED.blind_kills,
				aim_rating=EXCLUDED.aim_rating`,
			shareCode, int64(p.SteamID), p.Name, rOld, rNew, rChange,
			p.Kills, p.Deaths, p.Assists, p.HSKills, p.Damage, p.Rounds,
			p.Shots, p.Hits, p.HsHits, p.LegHits,
			nilIfZero(p.ReactionMs), nilIfZero(p.Preaim), p.SnapKills,
			p.OpeningKills, p.OpeningDeaths,
			p.Wallbangs, p.ThroughSmoke, p.NoScopes, p.BlindKills,
			nilIfZero(p.AimRating)); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ParsedRowsFor returns a player's parsed-demo lines, newest first.
func (d *DB) ParsedRowsFor(ctx context.Context, steamID uint64, limit int) ([]ParsedRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT p.share_code, COALESCE(m.map_name,''),
		       COALESCE(m.finished_at, 'epoch'::timestamptz),
		       COALESCE(p.name,''),
		       COALESCE(p.rank_old,0), COALESCE(p.rank_new,0), COALESCE(p.rank_change,0),
		       COALESCE(p.kills,0), COALESCE(p.deaths,0), COALESCE(p.assists,0),
		       COALESCE(p.hs_kills,0), COALESCE(p.damage,0), COALESCE(p.rounds,0),
		       COALESCE(p.shots,0), COALESCE(p.hits,0), COALESCE(p.hs_hits,0),
		       COALESCE(p.leg_hits,0),
		       COALESCE(p.reaction_ms,0), COALESCE(p.preaim,0), COALESCE(p.snap_kills,0),
		       COALESCE(p.opening_kills,0), COALESCE(p.opening_deaths,0),
		       COALESCE(p.wallbangs,0), COALESCE(p.through_smoke,0),
		       COALESCE(p.no_scopes,0), COALESCE(p.blind_kills,0),
		       COALESCE(p.aim_rating,0)
		  FROM parsed_match_players p
		  JOIN parsed_matches m ON m.share_code = p.share_code
		 WHERE p.steam_id = $1
		 ORDER BY m.finished_at DESC NULLS LAST
		 LIMIT $2`, int64(steamID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ParsedRow
	for rows.Next() {
		var r ParsedRow
		var sid = steamID
		if err := rows.Scan(&r.ShareCode, &r.MapName, &r.FinishedAt, &r.Name,
			&r.RankOld, &r.RankNew, &r.RankChange,
			&r.Kills, &r.Deaths, &r.Assists, &r.HSKills, &r.Damage, &r.Rounds,
			&r.Shots, &r.Hits, &r.HsHits, &r.LegHits,
			&r.ReactionMs, &r.Preaim, &r.SnapKills,
			&r.OpeningKills, &r.OpeningDeaths,
			&r.Wallbangs, &r.ThroughSmoke, &r.NoScopes, &r.BlindKills,
			&r.AimRating); err != nil {
			return nil, err
		}
		r.SteamID = sid
		out = append(out, r)
	}
	return out, rows.Err()
}

// ParsedShareCodes reports which of these codes we have already parsed, so a
// demo is downloaded once and never again.
func (d *DB) ParsedShareCodes(ctx context.Context, codes []string) (map[string]bool, error) {
	seen := make(map[string]bool, len(codes))
	if len(codes) == 0 {
		return seen, nil
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT share_code FROM parsed_matches WHERE share_code = ANY($1)`, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		seen[c] = true
	}
	return seen, rows.Err()
}

func nilIfZero(v float64) any {
	if v == 0 {
		return nil
	}
	return v
}
