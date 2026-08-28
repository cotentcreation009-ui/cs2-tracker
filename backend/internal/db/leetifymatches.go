package db

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/cs2tracker/server/internal/leetify"
	"github.com/jackc/pgx/v5"
)

// Storage for Leetify match reports, which is how a player Leetify will not
// describe directly gets a profile here: their matches carry a row for them
// whether or not they registered.
//
// Two rules the schema exists to keep (see 0017_leetify_match_rows.sql):
// a share code is fetched once and never again, and everything is evictable in
// one statement because Leetify's guidelines oblige deletion of data that stops
// being available from their API.

// errBadSteamID marks a row whose steam id is not a number — unservable, so
// it is skipped rather than failing the whole match.
var errBadSteamID = errors.New("db: malformed steam id")

// SeenShareCodes returns the subset of codes already stored, so a caller can
// spend its rate budget only on the ones it has never fetched.
func (d *DB) SeenShareCodes(ctx context.Context, codes []string) (map[string]bool, error) {
	seen := make(map[string]bool, len(codes))
	if len(codes) == 0 {
		return seen, nil
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT source_id FROM leetify_matches
		  WHERE data_source='matchmaking' AND source_id = ANY($1)`, codes)
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

// SaveMatch stores a match report and a row for every player in it.
//
// All ten rows are written, not just the player whose profile prompted the
// fetch — that is what makes coverage compound: a lookup for one player leaves
// nine others partly filled in for free.
//
// Idempotent: re-saving the same match is a no-op on the match row and refreshes
// the player rows in place.
func (d *DB) SaveMatch(ctx context.Context, m *leetify.Match) error {
	if m == nil || m.ID == "" {
		return nil
	}
	payload, err := json.Marshal(m)
	if err != nil {
		return err
	}
	var finished any
	if t := m.FinishedTime(); !t.IsZero() {
		finished = t
	}
	var sourceID any
	if m.DataSourceMatchID != "" {
		sourceID = m.DataSourceMatchID
	}

	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO leetify_matches
		   (match_id, data_source, source_id, map_name, finished_at, payload)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (match_id) DO UPDATE
		   SET payload = EXCLUDED.payload, fetched_at = now()`,
		m.ID, m.DataSource, sourceID, m.MapName, finished, payload); err != nil {
		return err
	}

	for i := range m.Stats {
		p := &m.Stats[i]
		sid, err := parseSteamID(p.Steam64ID)
		if err != nil {
			continue // a row we cannot key is a row we cannot serve
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO leetify_match_players
			   (match_id, steam_id, finished_at, preaim, reaction_time, accuracy_head,
			    accuracy, spray_accuracy, leetify_rating, kd_ratio, dpr,
			    total_kills, total_deaths, rounds_count)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			 ON CONFLICT (match_id, steam_id) DO UPDATE SET
			   preaim=EXCLUDED.preaim, reaction_time=EXCLUDED.reaction_time,
			   accuracy_head=EXCLUDED.accuracy_head, accuracy=EXCLUDED.accuracy,
			   spray_accuracy=EXCLUDED.spray_accuracy,
			   leetify_rating=EXCLUDED.leetify_rating, kd_ratio=EXCLUDED.kd_ratio,
			   dpr=EXCLUDED.dpr, total_kills=EXCLUDED.total_kills,
			   total_deaths=EXCLUDED.total_deaths, rounds_count=EXCLUDED.rounds_count`,
			m.ID, int64(sid), finished, p.Preaim, p.ReactionTime, p.AccuracyHead,
			p.Accuracy, p.SprayAccuracy, p.LeetifyRating, p.KDRatio, p.DPR,
			p.TotalKills, p.TotalDeaths, p.RoundsCount); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// PlayerMatchRow is one stored match as it matters to a player.
type PlayerMatchRow struct {
	MatchID       string    `json:"matchId"`
	MapName       string    `json:"mapName,omitempty"`
	DataSource    string    `json:"dataSource,omitempty"`
	FinishedAt    time.Time `json:"finishedAt"`
	Preaim        float64   `json:"preaim,omitempty"`
	ReactionTime  float64   `json:"reactionTime,omitempty"`
	AccuracyHead  float64   `json:"accuracyHead,omitempty"`
	Accuracy      float64   `json:"accuracy,omitempty"`
	SprayAccuracy float64   `json:"sprayAccuracy,omitempty"`
	LeetifyRating float64   `json:"leetifyRating,omitempty"`
	KDRatio       float64   `json:"kdRatio,omitempty"`
	DPR           float64   `json:"dpr,omitempty"`
	TotalKills    int       `json:"totalKills,omitempty"`
	TotalDeaths   int       `json:"totalDeaths,omitempty"`
	RoundsCount   int       `json:"roundsCount,omitempty"`
	// RoundsWon is the player's team's rounds, read from the stored payload
	// rather than a column: it earns its keep for win/loss display, not for
	// scoring, and a payload read spares a migration on a table already live.
	RoundsWon int `json:"roundsWon,omitempty"`
}

// Won reports the match outcome for this row. ok is false for a tie or when
// the rounds are missing — a caller must not guess a winner from silence.
func (r PlayerMatchRow) Won() (won, ok bool) {
	if r.RoundsCount <= 0 || r.RoundsWon <= 0 {
		return false, false
	}
	lost := r.RoundsCount - r.RoundsWon
	if r.RoundsWon == lost {
		return false, false
	}
	return r.RoundsWon > lost, true
}

// PlayerMatches returns every stored match for a player, newest first.
func (d *DB) PlayerMatches(ctx context.Context, steamID uint64, limit int) ([]PlayerMatchRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := d.Pool.Query(ctx,
		`SELECT p.match_id, COALESCE(m.map_name,''), COALESCE(m.data_source,''),
		        COALESCE(p.finished_at, 'epoch'::timestamptz),
		        COALESCE(p.preaim,0), COALESCE(p.reaction_time,0),
		        COALESCE(p.accuracy_head,0), COALESCE(p.accuracy,0),
		        COALESCE(p.spray_accuracy,0), COALESCE(p.leetify_rating,0),
		        COALESCE(p.kd_ratio,0), COALESCE(p.dpr,0),
		        COALESCE(p.total_kills,0), COALESCE(p.total_deaths,0),
		        COALESCE(p.rounds_count,0),
		        COALESCE((SELECT (st->>'rounds_won')::int
		                    FROM jsonb_array_elements(m.payload->'stats') st
		                   WHERE st->>'steam64_id' = p.steam_id::text
		                   LIMIT 1), 0)
		   FROM leetify_match_players p
		   JOIN leetify_matches m ON m.match_id = p.match_id
		  WHERE p.steam_id = $1
		  ORDER BY p.finished_at DESC NULLS LAST
		  LIMIT $2`, int64(steamID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PlayerMatchRow
	for rows.Next() {
		var r PlayerMatchRow
		if err := rows.Scan(&r.MatchID, &r.MapName, &r.DataSource, &r.FinishedAt,
			&r.Preaim, &r.ReactionTime, &r.AccuracyHead, &r.Accuracy,
			&r.SprayAccuracy, &r.LeetifyRating, &r.KDRatio, &r.DPR,
			&r.TotalKills, &r.TotalDeaths, &r.RoundsCount, &r.RoundsWon); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// PlayerMatchCount reports how many matches are stored for a player. Cheaper
// than fetching them, and it decides whether a profile needs a refresh at all.
func (d *DB) PlayerMatchCount(ctx context.Context, steamID uint64) (int, time.Time, error) {
	var n int
	var newest *time.Time
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*), MAX(finished_at) FROM leetify_match_players WHERE steam_id=$1`,
		int64(steamID)).Scan(&n, &newest)
	if err != nil && err != pgx.ErrNoRows {
		return 0, time.Time{}, err
	}
	if newest == nil {
		return n, time.Time{}, nil
	}
	return n, *newest, nil
}

// EvictLeetifyMatches drops every stored Leetify row. Leetify's developer
// guidelines require deleting data that ceases to be available from their API,
// so this is deliberately one call with no arguments and no exceptions.
func (d *DB) EvictLeetifyMatches(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx,
		`TRUNCATE leetify_match_players, leetify_matches`)
	return err
}

func parseSteamID(s string) (uint64, error) {
	var v uint64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, errBadSteamID
		}
		v = v*10 + uint64(c-'0')
	}
	if v == 0 {
		return 0, errBadSteamID
	}
	return v, nil
}

// CorpusTeammate is a player who keeps appearing on the subject's team in the
// matches we hold — the bridge's answer to "who do they queue with", built
// from our own rows rather than a profile Leetify will not serve.
type CorpusTeammate struct {
	SteamID      uint64
	Name         string
	Together     int     // shared matches on the same team
	TogetherWins int     // of those, ones their team won
	RatingAvg    float64 // avg per-match leetify_rating across shared games
	KDAvg        float64 // avg kd across shared games; 0 = unknown
	TotalMatches int     // matches we hold for the teammate themself
}

// CorpusTeammates lists the subject's recurring same-team lobby-mates.
//
// Team membership and rounds live in the stored payload rather than columns —
// the columns carry only what the scorer reads, and this query is rare enough
// (one per Friends-panel open, cached upstream) that JSONB reads are the right
// price for not widening a live table.
func (d *DB) CorpusTeammates(ctx context.Context, steamID uint64, limit int) ([]CorpusTeammate, error) {
	if limit <= 0 || limit > 12 {
		limit = 6
	}
	rows, err := d.Pool.Query(ctx, `
		WITH mine AS (
		  SELECT m.match_id, m.payload,
		         (SELECT st FROM jsonb_array_elements(m.payload->'stats') st
		           WHERE st->>'steam64_id' = $1::text LIMIT 1) AS me
		    FROM leetify_match_players p
		    JOIN leetify_matches m ON m.match_id = p.match_id
		   WHERE p.steam_id = $1
		)
		SELECT t.mate, t.name, t.together, t.wins, t.rating, t.kd,
		       (SELECT count(*) FROM leetify_match_players q
		         WHERE q.steam_id = t.mate)::int AS total
		  FROM (
		    SELECT (st2->>'steam64_id')::bigint            AS mate,
		           max(COALESCE(st2->>'name',''))          AS name,
		           count(*)::int                           AS together,
		           count(*) FILTER (
		             WHERE COALESCE((mine.me->>'rounds_won')::float, 0) >
		                   COALESCE((mine.me->>'rounds_count')::float, 0) / 2
		           )::int                                  AS wins,
		           avg(COALESCE((st2->>'leetify_rating')::float, 0)) AS rating,
		           COALESCE(avg(NULLIF((st2->>'kd_ratio')::float, 0)), 0) AS kd
		      FROM mine,
		           jsonb_array_elements(mine.payload->'stats') st2
		     WHERE st2->>'steam64_id' <> $1::text
		       AND st2->>'steam64_id' ~ '^[0-9]+$'
		       AND mine.me IS NOT NULL
		       AND st2->>'initial_team_number' = mine.me->>'initial_team_number'
		     GROUP BY 1
		    HAVING count(*) >= 2
		  ) t
		 ORDER BY t.together DESC, t.mate
		 LIMIT $2`, int64(steamID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []CorpusTeammate
	for rows.Next() {
		var t CorpusTeammate
		var mate int64
		if err := rows.Scan(&mate, &t.Name, &t.Together, &t.TogetherWins,
			&t.RatingAvg, &t.KDAvg, &t.TotalMatches); err != nil {
			return nil, err
		}
		t.SteamID = uint64(mate)
		out = append(out, t)
	}
	return out, rows.Err()
}
