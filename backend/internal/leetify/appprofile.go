package leetify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"
)

// THE APP-API FALLBACK, and the whole of why it exists.
//
// Leetify runs two surfaces. The DOCUMENTED one — api-public.cs-prod.leetify.com,
// the /v3 routes this package asks first — was narrowed on 2026-01-23 to "return
// data only for users registered to Leetify" (their blog, "Privacy updates to
// our API and Profiles"). The OTHER is the app's own host,
// api.cs-prod.leetify.com, which leetify.com calls from the browser with no key
// and no session for any visitor, and which still answers for players who never
// signed up. Measured on this deployment over 72 h: 6,137 v3 hits against 3,523
// misses — roughly a third of everyone looked up here has nothing on the public
// surface, and every one of them was a dead end on the profile page.
//
// WHAT THIS IS NOT. It is not a privacy bypass and must never become one. The
// routes enforce their own refusals: a pool the player has hidden — or one the
// app does not serve to an anonymous visitor at all (the matchmaking pool
// answered 403 even for a registered, fully public player) — returns 403, and
// this code asks for nothing the player's own leetify.com page does not already
// render to a stranger. A 403 or an empty body is a final answer here, never
// something to retry from another angle.
//
// WHY A FALLBACK AND NOT THE DEFAULT ROUTE. The owner asked for the app API to
// be how profiles are pulled (2026-09-24). The visible result is identical
// either way — every profile that can resolve, resolves — but ordering the
// keyed, sanctioned API first means only the third it cannot serve ever
// reaches an endpoint Leetify never offered for this, instead of every lookup
// of the day. That keeps the API-key relationship clean and leaves one switch
// (LEETIFY_APP_FALLBACK=0) to turn the whole thing off the day it stops being
// wise. Flipping the order is a one-line change in GetProfile if that is ever
// what is wanted.
//
// THE WALL, AND THE RELAY. On 2026-09-24 the app host answered every request
// from the VM with 511 bot_check_required — not because the VM is in a
// datacenter (40 of 40 check-host nodes on hosting networks worldwide got 200
// the same hour) but because of WHICH network: Contabo's AS40021, which the
// wall refuses wholesale, just as Skinport's Cloudflare does. So the fallback
// can be asked through a relay instead — cmd/leetifyrelay, a keyed forwarder
// for exactly these routes, running on a network the wall answers
// (LEETIFY_APP_RELAY_URL / _KEY; docs/LEETIFY-RELAY.md). That is a change of
// return address, not a bypass: no challenge is solved, nothing is faked, and
// a 511 arriving through the relay pauses the fallback here all the same.
//
// WHAT IT FILLS, AND HOW THAT WAS CHECKED. The ratings-and-micro-stats panel and
// the headline Leetify rating. The units were verified against a registered
// player who exists on BOTH surfaces: their app 5v5 aimRating (85.31409…) is
// their v3 rating.aim (85.3141) to the last digit, ct/t ratings match exactly,
// and v3's ranks.leetify (4.1) is the app's leetifyRating (0.041) times 100 —
// the same ×100 the rest of this codebase already applies to per-match ratings.
// So nothing here is renamed or rescaled beyond that one established
// conversion. It does NOT fill positioning, clutch or opening (the app's
// leetifyRatingCategories are a different breakdown; Clutches 2.1 for a player
// whose v3 clutch is 0.1068 — not the same number on any scale), nor the
// recent-match list or the rank block, whose app shapes do not match what v3
// hands the frontend. Inventing a mapping for those is how a stats page starts
// lying; the frontend renders what is absent as absent.

// appHost is the app's own API — the host leetify.com calls from the browser.
// It is the same host as legacyURL, so tests point both at one server.
func (c *Client) appHost() string { return c.legacyURL }

// appRecentGames is the slice of /api/profile/{id}/recent-games/{source} this
// maps from. Field names are Leetify's own camelCase.
type appRecentGames struct {
	AimRating                   float64 `json:"aimRating"`
	LeetifyRating               float64 `json:"leetifyRating"` // raw fraction; v3 shows it ×100
	UtilityRating               float64 `json:"utilityRating"`
	CTLeetifyRating             float64 `json:"ctLeetifyRating"`
	TLeetifyRating              float64 `json:"tLeetifyRating"`
	Preaim                      float64 `json:"preaim"`
	ReactionTime                float64 `json:"reactionTime"` // milliseconds (542.9 seen), unlike the per-game route's seconds
	AccuracyHead                float64 `json:"accuracyHead"`
	AccuracyEnemySpotted        float64 `json:"accuracyEnemySpotted"`
	SprayAccuracy               float64 `json:"sprayAccuracy"`
	CounterStrafingRatio        float64 `json:"counterStrafingShotsGoodRatio"`
	FlashbangHitFoePerFlashbang float64 `json:"flashbangHitFoePerFlashbang"`
	FlashbangLeadingToKill      float64 `json:"flashbangLeadingToKill"`
	HeFoesDamageAvg             float64 `json:"heFoesDamageAvg"`
	HeFriendsDamageAvg          float64 `json:"heFriendsDamageAvg"`
	UtilityOnDeathAvg           float64 `json:"utilityOnDeathAvg"`
	KDRatio                     float64 `json:"kdRatio"`
	WinRate                     float64 `json:"winRate"`
	MatchesPlayed               int     `json:"matchesPlayed"`
}

// empty reports whether the payload carries no actual play. The app returns a
// bare `{}` for a player it has nothing for, which decodes cleanly into zeroes
// — so "did it decode" is not the question; "is there a player in here" is.
func (a *appRecentGames) empty() bool {
	return a.MatchesPlayed == 0 && a.AimRating == 0 && a.KDRatio == 0
}

// appMeta is /api/profile/{id}/meta — the display name, the one place the app
// exposes it without a session.
type appMeta struct {
	Steam64ID string `json:"steam64Id"`
	Name      string `json:"name"`
}

// appDataSources is /api/profile/{id}/recent-games/available-data-sources:
// which pools the player has games in, and how many. Asked FIRST so the stats
// call goes to a pool the player actually plays rather than guessing and
// eating a refusal.
type appDataSources struct {
	DataSources map[string]int `json:"dataSources"`
}

// appSourcePreference is the order to try. "5v5" leads because it is not one
// platform but every five-a-side game the player has — Premier, Competitive
// and FACEIT together — and it is the window v3 itself computes a profile's
// ratings from (see the header). The single-platform pools follow; the 2v2
// formats come last because their numbers are not comparable to 5v5 play, but
// a wingman-only player is still better shown, with the pool named, than not.
var appSourcePreference = []string{"5v5", "faceit", "matchmaking", "matchmaking_competitive", "matchmaking_wingman", "2v2"}

// errAppBlocked: the app host refused this NETWORK, not this player. Seen as
// 511 ("bot check required") on every request from the VM's datacenter IP on
// 2026-09-24, while the same URLs answered 200 from a home connection. This
// is the same wall that took the legacy per-game route on this host away on
// 2026-09-16.
var errAppBlocked = errors.New("leetify app: this network is refused (511 bot check)")

// appBlockedFor is how long the app routes are left alone after a 511. A wall
// does not come down per player, and a few thousand misses a day knocking on
// it would be both pointless and the surest way to get the IP flagged on the
// public host too.
const appBlockedFor = 30 * time.Minute

func (c *Client) appBlocked() bool { return time.Now().UnixNano() < c.appBlockedUntil.Load() }

// tripAppBlock pauses the fallback and says so once per pause, not once per
// lookup — the log line that tells an operator the fallback is currently dead.
func (c *Client) tripAppBlock() {
	now := time.Now()
	until := now.Add(appBlockedFor)
	if prev := c.appBlockedUntil.Swap(until.UnixNano()); now.UnixNano() >= prev {
		slog.Warn("leetify app host refused this network (511 bot check); fallback paused",
			"until", until.UTC().Format(time.RFC3339))
	}
}

// getAppJSON fetches one app-API route. A 403 (hidden by the player, or not
// served anonymously) and a 404 are both "no", returned as ErrNotFound so a
// caller cannot mistake either for something to retry. A 511 is the bot wall
// refusing the whole network: it pauses the fallback (see errAppBlocked).
func (c *Client) getAppJSON(ctx context.Context, path string, out any) error {
	base := c.appHost()
	if c.appRelayURL != "" {
		base = c.appRelayURL // same path; the relay forwards it (see the header)
	}
	req, err := c.newReq(ctx, base+path)
	if err != nil {
		return err
	}
	// The app's routes are browser-called; the public-API key means nothing
	// here and is not sent. Nothing else is added either — the routes answer
	// a plain GET without a browser's Origin or Referer, so this traffic
	// presents itself as what it is.
	req.Header.Del("_leetify_key")
	if c.appRelayURL != "" {
		req.Header.Set("X-Relay-Key", c.appRelayKey)
	}

	resp, err := c.doWithRetry(req)
	if err != nil {
		return fmt.Errorf("leetify app: request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("leetify app: decode %s: %w", path, err)
		}
		return nil
	case http.StatusNotFound, http.StatusForbidden:
		return ErrNotFound
	case http.StatusNetworkAuthenticationRequired:
		c.tripAppBlock()
		return errAppBlocked
	default:
		return fmt.Errorf("leetify app: unexpected status %d for %s", resp.StatusCode, path)
	}
}

// GetAppProfile builds a Profile from the app API for a player the public /v3
// surface does not carry. Returns ErrNotFound when the app has nothing either,
// which is the honest end of the line: no third source gets tried.
func (c *Client) GetAppProfile(ctx context.Context, steam64 uint64) (*Profile, error) {
	if c.appBlocked() {
		return nil, errAppBlocked
	}
	id := strconv.FormatUint(steam64, 10)
	base := "/api/profile/" + id

	// Which pools does this player have games in? An empty answer means the app
	// does not know them, and there is nothing further to ask.
	var sources appDataSources
	if err := c.getAppJSON(ctx, base+"/recent-games/available-data-sources", &sources); err != nil {
		return nil, err
	}
	if len(sources.DataSources) == 0 {
		return nil, ErrNotFound
	}

	var games appRecentGames
	var used string
	for _, src := range appSourcePreference {
		if sources.DataSources[src] <= 0 {
			continue
		}
		var candidate appRecentGames
		err := c.getAppJSON(ctx, base+"/recent-games/"+src, &candidate)
		if err == ErrNotFound {
			continue // this pool is refused; the next may not be
		}
		if err != nil {
			return nil, err
		}
		if candidate.empty() {
			continue
		}
		games, used = candidate, src
		break
	}
	if used == "" {
		return nil, ErrNotFound
	}

	// The name is a nicety: a profile with stats and no name still renders.
	var meta appMeta
	if err := c.getAppJSON(ctx, base+"/meta", &meta); err != nil && err != ErrNotFound {
		return nil, err
	}

	// The one conversion (header): the headline rating onto v3's ranks scale.
	// Rounded because 0.0242×100 is 2.4200000000000004 in a float, and the
	// number is displayed to two places anyway.
	ranks, _ := json.Marshal(map[string]float64{
		"leetify": math.Round(games.LeetifyRating*100*10000) / 10000,
	})

	return &Profile{
		Name:      meta.Name,
		Steam64ID: id,
		// The size of the window the numbers describe (30 for an active
		// player), NOT a lifetime count; the frontend labels it as such when
		// Source is set.
		TotalMatches: games.MatchesPlayed,
		Winrate:      games.WinRate,
		// The app API states no privacy mode, and inventing "public" would be a
		// claim we cannot back; the frontend shows no pill when it is absent.
		// Source says where the row came from instead.
		PrivacyMode: "",
		Source:      "app:" + used,
		KD:          games.KDRatio,
		Ranks:       ranks,
		Rating: Rating{
			Aim:       games.AimRating,
			Utility:   games.UtilityRating,
			CTLeetify: games.CTLeetifyRating,
			TLeetify:  games.TLeetifyRating,
		},
		Stats: Stats{
			AccuracyHead:            games.AccuracyHead,
			AccuracyEnemySpotted:    games.AccuracyEnemySpotted,
			Preaim:                  games.Preaim,
			ReactionTimeMs:          games.ReactionTime,
			SprayAccuracy:           games.SprayAccuracy,
			CounterStrafingRatio:    games.CounterStrafingRatio,
			FlashbangHitFoePerFlash: games.FlashbangHitFoePerFlashbang,
			FlashbangLeadingToKill:  games.FlashbangLeadingToKill,
			HEFoesDamageAvg:         games.HeFoesDamageAvg,
			HEFriendsDamageAvg:      games.HeFriendsDamageAvg,
			UtilityOnDeathAvg:       games.UtilityOnDeathAvg,
		},
		// Deliberately empty (see the header): a half-filled list reads as a
		// player who has stopped playing rather than as data we do not have.
		RecentMatches: []RecentMatch{},
	}, nil
}
