package db

import (
	"context"
	"errors"
	"time"

	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/stats"
	"github.com/jackc/pgx/v5"
)

// Column lists kept next to their scan helpers so SELECT order and Scan order
// never drift.
const matchCols = `id, COALESCE(share_code,''), demo_source, map, game_mode,
	played_at, duration_s, rounds_total, team_a_score, team_b_score, tick_rate,
	parsed_at, created_at`

const matchPlayerCols = `match_id, steam_id64, persona_name, start_side,
	rounds_played, kills, deaths, assists, headshot_kills, damage, utility_damage,
	enemies_flashed, kast_rounds, opening_kills, opening_deaths, clutches_won,
	clutches_lost, mvps, k1, k2, k3, k4, k5, adr, kast_pct, hs_pct, kd, kpr, dpr,
	rating, won`

// --- Player identity --------------------------------------------------------

// UpsertPlayer writes the Steam-sourced identity for a player.
func (d *DB) UpsertPlayer(ctx context.Context, p models.Player) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO players (steam_id64, persona_name, avatar_url, profile_url, vanity_url, country_code, steam_created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7, now())
		ON CONFLICT (steam_id64) DO UPDATE SET
			persona_name = EXCLUDED.persona_name,
			avatar_url   = EXCLUDED.avatar_url,
			profile_url  = EXCLUDED.profile_url,
			vanity_url   = CASE WHEN EXCLUDED.vanity_url <> '' THEN EXCLUDED.vanity_url ELSE players.vanity_url END,
			country_code = EXCLUDED.country_code,
			steam_created_at = COALESCE(EXCLUDED.steam_created_at, players.steam_created_at),
			updated_at   = now()`,
		int64(p.SteamID64), p.PersonaName, p.AvatarURL, p.ProfileURL, p.VanityURL, p.CountryCode, p.SteamCreatedAt)
	return err
}

// GetProfile returns a player's identity plus their rolling career aggregate.
// Returns ErrNotFound when we have never seen the player.
func (d *DB) GetProfile(ctx context.Context, steamID uint64) (models.PlayerProfile, error) {
	var prof models.PlayerProfile
	var id int64
	err := d.Pool.QueryRow(ctx, `
		SELECT steam_id64, persona_name, avatar_url, profile_url, vanity_url, country_code, steam_created_at, created_at, updated_at
		FROM players WHERE steam_id64=$1`, int64(steamID)).
		Scan(&id, &prof.Player.PersonaName, &prof.Player.AvatarURL, &prof.Player.ProfileURL,
			&prof.Player.VanityURL, &prof.Player.CountryCode, &prof.Player.SteamCreatedAt,
			&prof.Player.CreatedAt, &prof.Player.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return prof, ErrNotFound
	}
	if err != nil {
		return prof, err
	}
	prof.Player.SteamID64 = uint64(id)

	career, err := d.getCareer(ctx, d.Pool, steamID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return prof, err
	}
	prof.Career = career
	return prof, nil
}

// --- Reads: matches ---------------------------------------------------------

// ListPlayerMatches returns a player's recent matches (newest first), each with
// that player's individual line.
func (d *DB) ListPlayerMatches(ctx context.Context, steamID uint64, limit, offset int) ([]models.PlayerMatchSummary, error) {
	// matches and match_players have disjoint column names, so an unqualified
	// projection is unambiguous and the scan order stays aligned with the
	// matchCols / matchPlayerCols constants.
	rows, err := d.Pool.Query(ctx, `
		SELECT `+matchCols+`, `+matchPlayerCols+`
		FROM match_players mp
		JOIN matches m ON m.id = mp.match_id
		WHERE mp.steam_id64 = $1
		ORDER BY m.played_at DESC, m.id DESC
		LIMIT $2 OFFSET $3`, int64(steamID), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.PlayerMatchSummary
	for rows.Next() {
		var s models.PlayerMatchSummary
		dst := append(matchScanTargets(&s.Match), matchPlayerScanTargets(&s.Line)...)
		if err := rows.Scan(dst...); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CountPlayerMatches returns how many matches a player has (for pagination).
func (d *DB) CountPlayerMatches(ctx context.Context, steamID uint64) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM match_players WHERE steam_id64=$1`, int64(steamID)).Scan(&n)
	return n, err
}

// GetMatchDetail returns a single match with its full scoreboard and rounds.
func (d *DB) GetMatchDetail(ctx context.Context, matchID int64) (models.MatchDetail, error) {
	var detail models.MatchDetail
	err := d.Pool.QueryRow(ctx, `SELECT `+matchCols+` FROM matches WHERE id=$1`, matchID).
		Scan(matchScanTargets(&detail.Match)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return detail, ErrNotFound
	}
	if err != nil {
		return detail, err
	}

	prows, err := d.Pool.Query(ctx,
		`SELECT `+matchPlayerCols+` FROM match_players WHERE match_id=$1 ORDER BY rating DESC`, matchID)
	if err != nil {
		return detail, err
	}
	defer prows.Close()
	for prows.Next() {
		var mp models.MatchPlayer
		if err := prows.Scan(matchPlayerScanTargets(&mp)...); err != nil {
			return detail, err
		}
		detail.Players = append(detail.Players, mp)
	}
	if err := prows.Err(); err != nil {
		return detail, err
	}

	rrows, err := d.Pool.Query(ctx,
		`SELECT match_id, number, winner_side, end_reason, ct_buy, t_buy, ct_equip_value, t_equip_value
		 FROM rounds WHERE match_id=$1 ORDER BY number`, matchID)
	if err != nil {
		return detail, err
	}
	defer rrows.Close()
	for rrows.Next() {
		var r models.Round
		var ws string
		if err := rrows.Scan(&r.MatchID, &r.Number, &ws, &r.EndReason,
			&r.CTBuy, &r.TBuy, &r.CTEquipValue, &r.TEquipValue); err != nil {
			return detail, err
		}
		r.WinnerSide = models.Side(ws)
		detail.Rounds = append(detail.Rounds, r)
	}
	return detail, rrows.Err()
}

// ListTopPlayers returns the highest-rated tracked players for the leaderboard.
func (d *DB) ListTopPlayers(ctx context.Context, limit int) ([]models.LeaderboardEntry, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT p.steam_id64, p.persona_name, p.avatar_url, pc.matches, pc.rating, pc.kd, pc.adr, pc.win_rate
		FROM player_careers pc
		JOIN players p ON p.steam_id64 = pc.steam_id64
		WHERE pc.matches >= 1
		ORDER BY pc.rating DESC, pc.matches DESC, p.steam_id64 ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.LeaderboardEntry
	for rows.Next() {
		var e models.LeaderboardEntry
		if err := rows.Scan(&e.SteamID64, &e.PersonaName, &e.AvatarURL, &e.Matches,
			&e.Rating, &e.KD, &e.ADR, &e.WinRate); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- Reads: killfeed-derived analytics --------------------------------------

// GetWeaponStats returns a player's most-used weapons (by kills) across every
// stored match, with headshot counts. Derived from the killfeed.
func (d *DB) GetWeaponStats(ctx context.Context, steamID uint64, limit int) ([]models.WeaponStat, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT weapon, COUNT(*) AS kills, COUNT(*) FILTER (WHERE headshot) AS hs
		FROM kills
		WHERE killer_id = $1 AND weapon <> ''
		GROUP BY weapon
		ORDER BY kills DESC, weapon ASC
		LIMIT $2`, int64(steamID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.WeaponStat
	for rows.Next() {
		var w models.WeaponStat
		if err := rows.Scan(&w.Weapon, &w.Kills, &w.Headshots); err != nil {
			return nil, err
		}
		if w.Kills > 0 {
			w.HSPct = float64(int(float64(w.Headshots)/float64(w.Kills)*1000+0.5)) / 10
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// GetMapStats returns a player's per-map career aggregates. Derived metrics are
// computed through the same stats helpers as the overall career so the numbers
// stay consistent.
func (d *DB) GetMapStats(ctx context.Context, steamID uint64) ([]models.MapStat, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT m.map,
			COUNT(*) AS matches,
			COUNT(*) FILTER (WHERE mp.won) AS wins,
			COALESCE(SUM(mp.rounds_played),0), COALESCE(SUM(mp.kills),0), COALESCE(SUM(mp.deaths),0),
			COALESCE(SUM(mp.damage),0), COALESCE(SUM(mp.kast_rounds),0), COALESCE(SUM(mp.headshot_kills),0),
			COALESCE(SUM(mp.k1),0), COALESCE(SUM(mp.k2),0), COALESCE(SUM(mp.k3),0), COALESCE(SUM(mp.k4),0), COALESCE(SUM(mp.k5),0)
		FROM match_players mp
		JOIN matches m ON m.id = mp.match_id
		WHERE mp.steam_id64 = $1
		GROUP BY m.map
		ORDER BY matches DESC, m.map ASC`, int64(steamID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.MapStat
	for rows.Next() {
		var mapName string
		// Reuse PlayerCareer + FillCareerDerived for identical rating/ADR math.
		var c models.PlayerCareer
		if err := rows.Scan(&mapName, &c.Matches, &c.Wins, &c.RoundsPlayed, &c.Kills, &c.Deaths,
			&c.Damage, &c.KASTRounds, &c.HeadshotKills, &c.K1, &c.K2, &c.K3, &c.K4, &c.K5); err != nil {
			return nil, err
		}
		c.Losses = c.Matches - c.Wins
		stats.FillCareerDerived(&c)
		out = append(out, models.MapStat{
			Map:          mapName,
			Matches:      c.Matches,
			Wins:         c.Wins,
			Losses:       c.Losses,
			WinRate:      c.WinRate,
			RoundsPlayed: c.RoundsPlayed,
			Rating:       c.Rating,
			ADR:          c.ADR,
			KD:           c.KD,
			HSPct:        c.HSPct,
		})
	}
	return out, rows.Err()
}

// ListMatchKills returns the ordered killfeed for a match.
func (d *DB) ListMatchKills(ctx context.Context, matchID int64) ([]models.Kill, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT round, time_seconds, COALESCE(killer_id,0), COALESCE(victim_id,0), COALESCE(assister_id,0),
			weapon, headshot, opening, trade
		FROM kills WHERE match_id=$1 ORDER BY round, time_seconds`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Kill
	for rows.Next() {
		k := models.Kill{MatchID: matchID}
		if err := rows.Scan(&k.Round, &k.TimeSeconds, &k.KillerID, &k.VictimID, &k.AssisterID,
			&k.Weapon, &k.Headshot, &k.Opening, &k.Trade); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// --- Jobs: durable parse-job status -----------------------------------------

// InsertJob records a freshly-enqueued job in the 'queued' state.
func (d *DB) InsertJob(ctx context.Context, j models.IngestJob) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO jobs (id, type, status, source, demo_path, demo_url, share_code)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (id) DO NOTHING`,
		j.ID, j.Type, j.Status, j.Source, j.DemoPath, j.DemoURL, j.ShareCode)
	return err
}

// SetJobStatus updates a job's status (upserting so a worker can record status
// even for jobs that were enqueued without a prior InsertJob). matchID is set
// when the job completes.
func (d *DB) SetJobStatus(ctx context.Context, id, status string, matchID *int64, errMsg string) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO jobs (id, status, match_id, error, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (id) DO UPDATE SET
			status   = EXCLUDED.status,
			match_id = COALESCE(EXCLUDED.match_id, jobs.match_id),
			error    = EXCLUDED.error,
			updated_at = now()`,
		id, status, matchID, errMsg)
	return err
}

// GetJob returns a job's current status. Returns ErrNotFound when unknown.
func (d *DB) GetJob(ctx context.Context, id string) (models.IngestJob, error) {
	var j models.IngestJob
	err := d.Pool.QueryRow(ctx, `
		SELECT id, type, status, source, demo_path, demo_url, share_code, match_id, error, created_at, updated_at
		FROM jobs WHERE id=$1`, id).
		Scan(&j.ID, &j.Type, &j.Status, &j.Source, &j.DemoPath, &j.DemoURL, &j.ShareCode,
			&j.MatchID, &j.Error, &j.CreatedAt, &j.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	if err != nil {
		return j, err
	}
	return j, nil
}

// --- Writes: persist a parsed match -----------------------------------------

// InsertParsedMatch persists a fully-parsed match transactionally: the match
// row, every player's line, rounds, the killfeed, and a recomputed career
// aggregate for each player who appeared. Returns the new match id. If the match
// carries a share code that already exists, it is treated as idempotent and the
// existing id is returned.
func (d *DB) InsertParsedMatch(ctx context.Context, pm *models.ParsedMatch) (int64, error) {
	if pm.Match.PlayedAt.IsZero() {
		pm.Match.PlayedAt = time.Now().UTC()
	}

	var matchID int64
	err := withTx(ctx, d.Pool, func(tx pgx.Tx) error {
		// Parse-once: if this exact demo was already ingested, reuse the match.
		if pm.Match.DemoHash != "" {
			var existing int64
			e := tx.QueryRow(ctx, `SELECT id FROM matches WHERE demo_hash=$1`, pm.Match.DemoHash).Scan(&existing)
			if e == nil {
				matchID = existing
				return nil
			}
			if !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
		}

		var shareCode *string
		if pm.Match.ShareCode != "" {
			shareCode = &pm.Match.ShareCode
		}

		// Insert the match; if the share code already exists, reuse that match.
		err := tx.QueryRow(ctx, `
			INSERT INTO matches (share_code, demo_source, map, game_mode, played_at, duration_s, rounds_total, team_a_score, team_b_score, tick_rate, demo_hash, parsed_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
			ON CONFLICT (share_code) DO NOTHING
			RETURNING id`,
			shareCode, pm.Match.DemoSource, pm.Match.Map, pm.Match.GameMode, pm.Match.PlayedAt,
			pm.Match.DurationS, pm.Match.RoundsTotal, pm.Match.TeamAScore, pm.Match.TeamBScore, pm.Match.TickRate, pm.Match.DemoHash,
		).Scan(&matchID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Conflict on share_code: match already ingested.
			return tx.QueryRow(ctx, `SELECT id FROM matches WHERE share_code=$1`, shareCode).Scan(&matchID)
		}
		if err != nil {
			return err
		}

		for _, mp := range pm.Players {
			if err := ensurePlayer(ctx, tx, mp.SteamID64, mp.PersonaName); err != nil {
				return err
			}
			if err := insertMatchPlayer(ctx, tx, matchID, mp); err != nil {
				return err
			}
		}

		for _, r := range pm.Rounds {
			if _, err := tx.Exec(ctx,
				`INSERT INTO rounds (match_id, number, winner_side, end_reason, ct_buy, t_buy, ct_equip_value, t_equip_value)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				 ON CONFLICT (match_id, number) DO NOTHING`,
				matchID, r.Number, string(r.WinnerSide), r.EndReason,
				r.CTBuy, r.TBuy, r.CTEquipValue, r.TEquipValue); err != nil {
				return err
			}
		}

		if len(pm.Kills) > 0 {
			if err := insertKills(ctx, tx, matchID, pm.Kills); err != nil {
				return err
			}
		}

		// Aggregate-on-write: recompute each appearing player's career.
		for _, mp := range pm.Players {
			if err := recomputeCareer(ctx, tx, mp.SteamID64); err != nil {
				return err
			}
		}
		return nil
	})
	return matchID, err
}

func ensurePlayer(ctx context.Context, tx pgx.Tx, steamID uint64, name string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO players (steam_id64, persona_name) VALUES ($1,$2)
		ON CONFLICT (steam_id64) DO UPDATE SET
			persona_name = CASE WHEN players.persona_name = '' THEN EXCLUDED.persona_name ELSE players.persona_name END,
			updated_at = now()`,
		int64(steamID), name)
	return err
}

func insertMatchPlayer(ctx context.Context, tx pgx.Tx, matchID int64, mp models.MatchPlayer) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO match_players (`+matchPlayerCols+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
		ON CONFLICT (match_id, steam_id64) DO NOTHING`,
		matchID, int64(mp.SteamID64), mp.PersonaName, string(mp.StartSide),
		mp.RoundsPlayed, mp.Kills, mp.Deaths, mp.Assists, mp.HeadshotKills, mp.Damage, mp.UtilityDamage,
		mp.EnemiesFlashed, mp.KASTRounds, mp.OpeningKills, mp.OpeningDeaths, mp.ClutchesWon,
		mp.ClutchesLost, mp.MVPs, mp.K1, mp.K2, mp.K3, mp.K4, mp.K5, mp.ADR, mp.KASTPct, mp.HSPct,
		mp.KD, mp.KPR, mp.DPR, mp.Rating, mp.Won)
	return err
}

func insertKills(ctx context.Context, tx pgx.Tx, matchID int64, kills []models.Kill) error {
	rows := make([][]any, len(kills))
	for i, k := range kills {
		rows[i] = []any{
			matchID, k.Round, k.TimeSeconds,
			nullableID(k.KillerID), nullableID(k.VictimID), nullableID(k.AssisterID),
			k.Weapon, k.Headshot, k.Opening, k.Trade,
		}
	}
	_, err := tx.CopyFrom(ctx,
		pgx.Identifier{"kills"},
		[]string{"match_id", "round", "time_seconds", "killer_id", "victim_id", "assister_id", "weapon", "headshot", "opening", "trade"},
		pgx.CopyFromRows(rows))
	return err
}

// nullableID converts a SteamID64 to a value pgx writes as NULL when it is 0
// (e.g. a bot or the world as the killer).
func nullableID(id uint64) any {
	if id == 0 {
		return nil
	}
	return int64(id)
}

// --- Career aggregate -------------------------------------------------------

func recomputeCareer(ctx context.Context, tx pgx.Tx, steamID uint64) error {
	var c models.PlayerCareer
	c.SteamID64 = steamID
	err := tx.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE won),
			COUNT(*) FILTER (WHERE NOT won),
			COALESCE(SUM(rounds_played),0),
			COALESCE(SUM(kills),0), COALESCE(SUM(deaths),0), COALESCE(SUM(assists),0), COALESCE(SUM(headshot_kills),0),
			COALESCE(SUM(damage),0), COALESCE(SUM(kast_rounds),0), COALESCE(SUM(opening_kills),0), COALESCE(SUM(opening_deaths),0),
			COALESCE(SUM(clutches_won),0), COALESCE(SUM(clutches_lost),0),
			COALESCE(SUM(utility_damage),0), COALESCE(SUM(enemies_flashed),0), COALESCE(SUM(mvps),0),
			COALESCE(SUM(k1),0), COALESCE(SUM(k2),0), COALESCE(SUM(k3),0), COALESCE(SUM(k4),0), COALESCE(SUM(k5),0)
		FROM match_players WHERE steam_id64=$1`, int64(steamID)).
		Scan(&c.Matches, &c.Wins, &c.Losses, &c.RoundsPlayed,
			&c.Kills, &c.Deaths, &c.Assists, &c.HeadshotKills,
			&c.Damage, &c.KASTRounds, &c.OpeningKills, &c.OpeningDeaths,
			&c.ClutchesWon, &c.ClutchesLost,
			&c.UtilityDamage, &c.EnemiesFlashed, &c.MVPs,
			&c.K1, &c.K2, &c.K3, &c.K4, &c.K5)
	if err != nil {
		return err
	}
	stats.FillCareerDerived(&c)

	_, err = tx.Exec(ctx, `
		INSERT INTO player_careers (steam_id64, matches, wins, losses, rounds_played, kills, deaths, assists,
			headshot_kills, damage, kast_rounds, opening_kills, opening_deaths, clutches_won, clutches_lost,
			k1, k2, k3, k4, k5, kd, adr, kast_pct, hs_pct, rating, win_rate,
			utility_damage, enemies_flashed, mvps, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29, now())
		ON CONFLICT (steam_id64) DO UPDATE SET
			matches=EXCLUDED.matches, wins=EXCLUDED.wins, losses=EXCLUDED.losses, rounds_played=EXCLUDED.rounds_played,
			kills=EXCLUDED.kills, deaths=EXCLUDED.deaths, assists=EXCLUDED.assists, headshot_kills=EXCLUDED.headshot_kills,
			damage=EXCLUDED.damage, kast_rounds=EXCLUDED.kast_rounds, opening_kills=EXCLUDED.opening_kills,
			opening_deaths=EXCLUDED.opening_deaths, clutches_won=EXCLUDED.clutches_won, clutches_lost=EXCLUDED.clutches_lost,
			k1=EXCLUDED.k1, k2=EXCLUDED.k2, k3=EXCLUDED.k3, k4=EXCLUDED.k4, k5=EXCLUDED.k5,
			kd=EXCLUDED.kd, adr=EXCLUDED.adr, kast_pct=EXCLUDED.kast_pct, hs_pct=EXCLUDED.hs_pct,
			rating=EXCLUDED.rating, win_rate=EXCLUDED.win_rate,
			utility_damage=EXCLUDED.utility_damage, enemies_flashed=EXCLUDED.enemies_flashed, mvps=EXCLUDED.mvps,
			updated_at=now()`,
		int64(c.SteamID64), c.Matches, c.Wins, c.Losses, c.RoundsPlayed, c.Kills, c.Deaths, c.Assists,
		c.HeadshotKills, c.Damage, c.KASTRounds, c.OpeningKills, c.OpeningDeaths, c.ClutchesWon, c.ClutchesLost,
		c.K1, c.K2, c.K3, c.K4, c.K5, c.KD, c.ADR, c.KASTPct, c.HSPct, c.Rating, c.WinRate,
		c.UtilityDamage, c.EnemiesFlashed, c.MVPs)
	return err
}

func (d *DB) getCareer(ctx context.Context, q pgxQuerier, steamID uint64) (models.PlayerCareer, error) {
	var c models.PlayerCareer
	var id int64
	err := q.QueryRow(ctx, `
		SELECT steam_id64, matches, wins, losses, rounds_played, kills, deaths, assists, headshot_kills, damage,
			kast_rounds, opening_kills, opening_deaths, clutches_won, clutches_lost,
			utility_damage, enemies_flashed, mvps, k1, k2, k3, k4, k5,
			kd, adr, kast_pct, hs_pct, rating, win_rate, updated_at
		FROM player_careers WHERE steam_id64=$1`, int64(steamID)).
		Scan(&id, &c.Matches, &c.Wins, &c.Losses, &c.RoundsPlayed, &c.Kills, &c.Deaths, &c.Assists,
			&c.HeadshotKills, &c.Damage, &c.KASTRounds, &c.OpeningKills, &c.OpeningDeaths, &c.ClutchesWon,
			&c.ClutchesLost, &c.UtilityDamage, &c.EnemiesFlashed, &c.MVPs,
			&c.K1, &c.K2, &c.K3, &c.K4, &c.K5, &c.KD, &c.ADR, &c.KASTPct, &c.HSPct,
			&c.Rating, &c.WinRate, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	if err != nil {
		return c, err
	}
	c.SteamID64 = uint64(id)
	return c, nil
}

// --- scan helpers -----------------------------------------------------------

// matchScanTargets returns Scan destinations for matchCols, in order. ID and
// SteamID-less; the id is read through an int64 shim handled by the caller via
// pointer aliasing on the Match.ID field.
func matchScanTargets(m *models.Match) []any {
	return []any{
		&m.ID, &m.ShareCode, &m.DemoSource, &m.Map, &m.GameMode,
		&m.PlayedAt, &m.DurationS, &m.RoundsTotal, &m.TeamAScore, &m.TeamBScore, &m.TickRate,
		&m.ParsedAt, &m.CreatedAt,
	}
}

// matchPlayerScanTargets relies on pgx v5 scanning BIGINT into uint64 (range
// checked) and TEXT into the string-kind models.Side directly.
func matchPlayerScanTargets(mp *models.MatchPlayer) []any {
	return []any{
		&mp.MatchID, &mp.SteamID64, &mp.PersonaName, &mp.StartSide,
		&mp.RoundsPlayed, &mp.Kills, &mp.Deaths, &mp.Assists, &mp.HeadshotKills, &mp.Damage, &mp.UtilityDamage,
		&mp.EnemiesFlashed, &mp.KASTRounds, &mp.OpeningKills, &mp.OpeningDeaths, &mp.ClutchesWon,
		&mp.ClutchesLost, &mp.MVPs, &mp.K1, &mp.K2, &mp.K3, &mp.K4, &mp.K5, &mp.ADR, &mp.KASTPct, &mp.HSPct,
		&mp.KD, &mp.KPR, &mp.DPR, &mp.Rating, &mp.Won,
	}
}
