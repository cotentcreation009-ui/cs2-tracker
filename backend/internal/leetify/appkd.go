package leetify

// Kills and deaths for a MEMBER's match list, and where they come from now.
//
// A member's list is v3's recent_matches (GetProfile), and v3 carries no
// kills or deaths per game. Those used to be merged in from the app host's
// per-game route, /api/games/{id}, asked once per row — until the host's bot
// wall took that route away from this network in mid-September 2026 (511 on
// every request, keyed or not). The merge then silently yielded nothing, and
// every member's row read "—" for K and D while every NON-member's row read
// fine, because the non-member list comes from the app's /match-history
// through the relay (appprofile.go, "THE WALL"), and that list carries
// kills and deaths.
//
// So a member's list is now completed from the same /match-history: one
// request through the relay, the player's last 30 games newest-first across
// every pool — map, score, outcome, pool, the game's Leetify rating, kills,
// deaths, and (since 2026-10-01; checked live through the relay) Leetify's
// game id, the same id v3 lists the game under. Where both sides carry an
// id the join is exact. Where one side lacks it — the list carried no id
// at all when it was first read on 2026-09-25, and may not again — the two
// lists are walked together, both newest-first, and a v3 row takes an app
// row's kills only when the two describe the same game on every field they
// share (sameGame) and nothing nearby could be mistaken for either. A doubt
// stops the walk rather than guessing: a wrong K/D on a row is worse than a
// dash, because a dash says "not known" and a number says "known".
//
// The limit is the list's: 30 games. Rows past the thirtieth keep no K/D
// and the page shows "—" for them, as it did for every row before.

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"
)

// kdRatingTolerance is how far two leetify_rating values may sit apart and
// still be one game's. Both surfaces serve the rating as a four-decimal
// fraction (0.0561 on v3, 0.3736 on the app), so this is half a unit in the
// last place: a float formatting difference, never a different game.
const kdRatingTolerance = 0.0005

// kdPairLookahead bounds how far past its cursor either list is searched for
// the game the other list's cursor stands on. The lists disagree where one
// carries a pool the other omits — a wingman session, say — and a session is
// a handful of games, not dozens.
const kdPairLookahead = 8

// memberKDTimeout bounds the one extra request a member's profile makes. The
// profile stands without it; a hanging relay must not hold the page.
const memberKDTimeout = 5 * time.Second

// memberKDLogEvery bounds the "could not complete K/D" line to one per pause
// window, like publicrelay.go: the first failure logs, the rest are counted
// and reported with the next line.
const memberKDLogEvery = appBlockMax

// sameGame reports whether a v3 row and an app row describe one game. When
// both carry Leetify's game id, the id decides and nothing else is looked
// at: two rows with different ids are two games however alike they read.
// Otherwise: the same map, the same score pair (both lists put the player's
// side first — checked live 2026-10-01: a "loss [3,13]" on v3, a "win
// [13,10]" on the app), the same outcome, the same pool once the app's
// matchmaking_competitive is folded into v3's "matchmaking" (which
// appMatchHistory.recentMatches already does) and the same per-game rating
// to the last published digit.
func sameGame(v, a *RecentMatch) bool {
	if v.ID != "" && a.ID != "" {
		return v.ID == a.ID
	}
	if !strings.EqualFold(v.MapName, a.MapName) || v.Outcome != a.Outcome || v.DataSource != a.DataSource {
		return false
	}
	if len(v.Score) != 2 || len(a.Score) != 2 || v.Score[0] != a.Score[0] || v.Score[1] != a.Score[1] {
		return false
	}
	return math.Abs(v.LeetifyRating-a.LeetifyRating) <= kdRatingTolerance
}

// takeKD copies an app row's kills and deaths onto a v3 row — unless the row
// already carries a non-zero K or D, which came from somewhere this file
// cannot see and is not overwritten.
func takeKD(v, a *RecentMatch) {
	if v.Kills == 0 && v.Deaths == 0 {
		v.Kills, v.Deaths = a.Kills, a.Deaths
	}
}

// findOne looks for want among ms at the index-list positions
// idx[from:from+kdPairLookahead] and returns the position in idx of the one
// row that is the same game, with how many such rows there were — zero (not
// within reach) and two or more (which one?) both mean the caller cannot
// resolve the disagreement.
func findOne(ms []RecentMatch, idx []int, from int, want *RecentMatch) (pos, n int) {
	pos = -1
	end := from + kdPairLookahead
	if end > len(idx) {
		end = len(idx)
	}
	for k := from; k < end; k++ {
		if sameGame(&ms[idx[k]], want) {
			if n == 0 {
				pos = k
			}
			n++
		}
	}
	return pos, n
}

// mergeAppKD fills Kills and Deaths on v3 rows from the app's history (both
// newest-first; app already folded onto v3's vocabulary) and returns how
// many rows were paired. Two passes:
//
// By id first. Every v3 row whose id the app list carries takes that row's
// K/D — an exact join, in any order, blind to everything else. (An id the
// app list carries twice pairs nothing: it cannot say which game.)
//
// Then the walk, over what is left on each side — in practice the rows
// without an id, since with ids on both sides the first pass settles
// everything the lists share. A cursor on each list:
//
//   - The two cursors stand on the same game: pair them and advance both —
//     unless the NEXT row on either side is the same game too (a tie), in
//     which case the walk stops, because either pairing is a guess.
//   - They do not: one list carries a game the other lacks. If exactly one
//     later row of v3 (within kdPairLookahead) is the app cursor's game and
//     no later app row is the v3 cursor's, v3 skips ahead to it; the mirror
//     skips the app list (a wingman game v3 does not list, say). Anything
//     else — neither within reach, both within reach, or more than one
//     candidate — stops the walk.
//
// A row that already carries a non-zero K or D keeps it (takeKD). Rows
// neither pass reaches keep 0/0, which the page renders as "—".
func mergeAppKD(v3, app []RecentMatch) int {
	paired := 0

	appByID := make(map[string]int, len(app))
	for j := range app {
		if id := app[j].ID; id != "" {
			if _, dup := appByID[id]; dup {
				appByID[id] = -1
			} else {
				appByID[id] = j
			}
		}
	}
	v3Left := make([]int, 0, len(v3))
	appUsed := make([]bool, len(app))
	for i := range v3 {
		if j, ok := appByID[v3[i].ID]; ok && j >= 0 && v3[i].ID != "" {
			takeKD(&v3[i], &app[j])
			appUsed[j] = true
			paired++
			continue
		}
		v3Left = append(v3Left, i)
	}
	appLeft := make([]int, 0, len(app))
	for j := range app {
		if !appUsed[j] {
			appLeft = append(appLeft, j)
		}
	}

	i, j := 0, 0
	for i < len(v3Left) && j < len(appLeft) {
		v, a := &v3[v3Left[i]], &app[appLeft[j]]
		if sameGame(v, a) {
			if (i+1 < len(v3Left) && sameGame(&v3[v3Left[i+1]], a)) || (j+1 < len(appLeft) && sameGame(v, &app[appLeft[j+1]])) {
				return paired
			}
			takeKD(v, a)
			paired++
			i++
			j++
			continue
		}
		vi, vn := findOne(v3, v3Left, i+1, a)
		aj, an := findOne(app, appLeft, j+1, v)
		switch {
		case vn == 1 && an == 0:
			i = vi
		case an == 1 && vn == 0:
			j = aj
		default:
			return paired
		}
	}
	return paired
}

// fillMemberKD completes a member's v3 rows with kills and deaths from the
// app's /match-history, asked the way every app route is asked (getAppJSON:
// through the relay when one is configured, with its pauses). Best-effort by
// design: the profile stands without it, so no failure here is the caller's
// — a wall logs itself once per pause (tripAppBlock) and anything else logs
// once per pause window (noteMemberKDFailed). Nothing is asked while the app
// routes are paused or the fallback is switched off (LEETIFY_APP_FALLBACK=0:
// one switch for all app-host traffic).
func (c *Client) fillMemberKD(ctx context.Context, steam64 uint64, ms []RecentMatch) {
	if !c.appFallback || len(ms) == 0 || c.appBlocked() {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, memberKDTimeout)
	defer cancel()
	id := strconv.FormatUint(steam64, 10)
	var history appMatchHistory
	if err := c.getAppJSON(ctx, "/api/profile/"+id+"/match-history", &history); err != nil {
		if !errors.Is(err, errAppBlocked) {
			c.noteMemberKDFailed(id, err)
		}
		return
	}
	mergeAppKD(ms, history.recentMatches())
}

// noteMemberKDFailed counts a failed K/D completion and logs the first of
// each pause window, with how many went unlogged before it — one line an
// operator can grep for when the relay is an older paste (its 404 arrives
// here as ErrNotFound), not one per profile view.
func (c *Client) noteMemberKDFailed(steam64 string, err error) {
	skipped := c.memberKDFailures.Add(1) - 1
	now := time.Now()
	last := c.memberKDLoggedAt.Load()
	if now.UnixNano()-last < int64(memberKDLogEvery) {
		return
	}
	if !c.memberKDLoggedAt.CompareAndSwap(last, now.UnixNano()) {
		return
	}
	c.memberKDFailures.Store(0)
	slog.Warn("leetify member K/D: app match-history could not be read; rows keep no kills/deaths (an old relay paste? docs/LEETIFY-RELAY.md)",
		"steam64", steam64, "err", err, "unlogged_before_this", skipped)
}
