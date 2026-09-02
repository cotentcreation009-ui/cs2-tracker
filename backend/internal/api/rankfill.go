package api

import (
	"context"
	"time"

	"github.com/cs2tracker/server/internal/db"
)

// Filling in ladder standings for stored matches.
//
// The bridge fetches match REPORTS, which carry no rank — that is why the rank
// column has been dashed on every bridged profile. Leetify's legacy per-game
// endpoint does carry it, and the site already reads that endpoint for the
// expanded scoreboard: one match at a time, lazily, discarding it afterwards.
//
// This pass fetches the same thing once per match and keeps it, which fills
// the column for the whole list instead of only for rows someone expanded.

// How many matches one pass will enrich. The Leetify rate budget is shared by
// the whole site, and the newest matches are the ones a visitor is looking at,
// so a small newest-first batch beats a big sweep.
const maxRankFillPerPass = 6

// fillRanks fetches ladder standings for a player's most recent matches that
// do not have them yet. Best-effort: an enrichment failure must never affect
// the sync or the page that triggered it.
func (s *Server) fillRanks(ctx context.Context, steamID uint64) {
	if s.leetify == nil {
		return
	}
	ids, err := s.db.MatchesNeedingRank(ctx, steamID, maxRankFillPerPass)
	if err != nil {
		s.log.Warn("rank fill: listing failed", "steam", steamID, "err", err)
		return
	}
	if len(ids) == 0 {
		return
	}

	filled, rated := 0, 0
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		// The per-game endpoint wants a viewer; any player in the match works,
		// and the subject is guaranteed to be one of them.
		gs, err := s.leetify.GetGameStats(ctx, id, steamID)
		if err != nil || gs == nil {
			// Mark it fetched anyway on a definitive miss so the pass does not
			// come back to the same match every ten minutes forever.
			if err == nil {
				_ = s.db.SaveMatchRanks(ctx, id, nil)
			}
			continue
		}
		var ranks []db.MatchRank
		for _, team := range gs.Scoreboard {
			for _, row := range team.Players {
				sid := parseSteamID64(row.SteamID)
				if sid == 0 || row.RankAfter <= 0 {
					continue
				}
				ranks = append(ranks, db.MatchRank{
					SteamID:    sid,
					RankType:   row.RankType,
					RankAfter:  row.RankAfter,
					RankBefore: row.RankBefore,
				})
			}
		}
		if err := s.db.SaveMatchRanks(ctx, id, ranks); err != nil {
			s.log.Warn("rank fill: save failed", "match", id, "err", err)
			continue
		}
		filled++
		rated += len(ranks)
	}
	s.log.Info("rank fill", "steam", steamID,
		"matches", filled, "player_ranks", rated, "candidates", len(ids))
}

// rankFillEvery paces the enrichment when it runs off the poller.
const rankFillEvery = 10 * time.Minute

func parseSteamID64(s string) uint64 {
	var n uint64
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + uint64(c-'0')
	}
	if n < 76561197960265728 {
		return 0
	}
	return n
}
