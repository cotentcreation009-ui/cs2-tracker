// Package matchsync assembles a player's match telemetry from share codes.
//
// Leetify answers profile lookups only for accounts registered with them, but
// their match reports carry a row for every player in the lobby. So a player
// they will not describe can still be assembled: find the share codes for the
// matches they played, fetch those reports, keep the rows.
//
// The shape of the work is dictated by what it costs. Match lookups are capped
// at a handful per minute for the whole site, so a player with eight unseen
// matches takes about a minute to fill in. That is fine for a background job
// and unacceptable on a request, which is why nothing here is meant to be
// called while someone waits: pages read what is already stored, and a sync
// runs behind them.
//
// Every fetched match writes rows for all ten players, so the corpus grows
// faster than the profiles that prompt it.
package matchsync

import (
	"context"
	"errors"
	"log/slog"
	"sort"
	"strconv"
	"time"

	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/gcbot"
	"github.com/cs2tracker/server/internal/leetify"
	"golang.org/x/sync/singleflight"
)

// maxPerSync caps how many matches one sync will fetch.
//
// The Game Coordinator only serves a player's last handful anyway, and the
// per-minute budget is shared by the whole site: without a cap, one player with
// a long history would hold the queue for everyone else.
const maxPerSync = 8

// Store is the persistence matchsync needs. *db.DB satisfies it.
type Store interface {
	SeenShareCodes(ctx context.Context, codes []string) (map[string]bool, error)
	SaveMatch(ctx context.Context, m *leetify.Match) error
	PlayerMatches(ctx context.Context, steamID uint64, limit int) ([]db.PlayerMatchRow, error)
	PlayerMatchCount(ctx context.Context, steamID uint64) (int, time.Time, error)
	// The absent-code retry set: codes whose Leetify report was missing when
	// first asked — usually "not processed YET", not "never existed".
	RememberAbsentCode(ctx context.Context, steamID uint64, code string) error
	AbsentCodesToRetry(ctx context.Context, steamID uint64) ([]string, error)
}

// Fetcher fetches one match report by share code. *leetify.Client satisfies it.
type Fetcher interface {
	MatchByShareCode(ctx context.Context, shareCode string) (*leetify.Match, error)
}

// CodeSource supplies candidate share codes for a player. The game-coordinator
// bot satisfies this for accounts whose Steam game details are public; other
// sources plug in the same way.
type CodeSource interface {
	ShareCodes(ctx context.Context, steamID uint64) ([]string, error)
}

// Syncer fills in a player's stored match rows.
type Syncer struct {
	store   Store
	fetch   Fetcher
	sources []CodeSource
	log     *slog.Logger

	// sf coalesces concurrent syncs for one player: ten people opening the same
	// profile must cost one pass over the rate budget, not ten.
	sf singleflight.Group
}

func New(store Store, fetch Fetcher, log *slog.Logger, sources ...CodeSource) *Syncer {
	if log == nil {
		log = slog.Default()
	}
	return &Syncer{store: store, fetch: fetch, sources: sources, log: log}
}

// Result reports what a sync did, for logging and for deciding whether it is
// worth running again soon.
type Result struct {
	Offered int // share codes the sources named
	New     int // of those, ones not already stored
	Fetched int // reports actually retrieved
	Absent  int // codes Leetify has no report for (nobody in the lobby was a user)
	Failed  int // fetches that errored
}

// Sync gathers share codes for a player and fetches the ones not already
// stored. Safe to call concurrently for the same player; the work happens once.
//
// Long-running by nature — the caller should run it in the background and read
// results from the store, not wait on it.
func (s *Syncer) Sync(ctx context.Context, steamID uint64) (Result, error) {
	v, err, _ := s.sf.Do(strconv.FormatUint(steamID, 10), func() (any, error) {
		return s.sync(ctx, steamID)
	})
	if err != nil {
		return Result{}, err
	}
	return v.(Result), nil
}

func (s *Syncer) sync(ctx context.Context, steamID uint64) (Result, error) {
	var res Result

	// Gather candidates. A source that fails is a source we do without: the
	// game coordinator stays silent for private accounts, and that is a normal
	// answer about that player, not an error worth abandoning the sync for.
	seen := map[string]bool{}
	var codes []string
	for _, src := range s.sources {
		got, err := src.ShareCodes(ctx, steamID)
		if err != nil {
			if !errors.Is(err, gcbot.ErrNoReply) {
				s.log.Warn("matchsync: share-code source failed",
					"steam", steamID, "err", err)
			}
			continue
		}
		for _, c := range got {
			if c == "" || seen[c] || !leetify.ValidShareCode(c) {
				continue
			}
			seen[c] = true
			codes = append(codes, c)
		}
	}
	// Second chance for codes that 404ed on an earlier pass. The chain walker
	// finds a code minutes after the final round; Leetify takes up to a couple
	// of hours to process the demo. Without this, the race would permanently
	// drop exactly the matches connecting an account exists to deliver.
	if retry, err := s.store.AbsentCodesToRetry(ctx, steamID); err == nil {
		for _, c := range retry {
			if c == "" || seen[c] || !leetify.ValidShareCode(c) {
				continue
			}
			seen[c] = true
			codes = append(codes, c)
		}
	}
	res.Offered = len(codes)
	if len(codes) == 0 {
		return res, nil
	}

	// Skip what is already stored. Matches never change, so a code fetched once
	// is a code never worth fetching again.
	stored, err := s.store.SeenShareCodes(ctx, codes)
	if err != nil {
		return res, err
	}
	fresh := codes[:0:0]
	for _, c := range codes {
		if !stored[c] {
			fresh = append(fresh, c)
		}
	}
	res.New = len(fresh)
	if len(fresh) > maxPerSync {
		// The codes beyond this pass's fetch budget must not be dropped: the
		// chain walker has already advanced past them and will never offer
		// them again. Park them in the retry set — later syncs drain it eight
		// at a time until the backlog is gone.
		for _, c := range fresh[maxPerSync:] {
			if err := s.store.RememberAbsentCode(ctx, steamID, c); err != nil {
				s.log.Warn("matchsync: overflow bookkeeping failed", "code", c, "err", err)
				break
			}
		}
		fresh = fresh[:maxPerSync]
	}

	for _, code := range fresh {
		if ctx.Err() != nil {
			break
		}
		m, err := s.fetch.MatchByShareCode(ctx, code)
		switch {
		case errors.Is(err, leetify.ErrNotFound):
			// Two indistinguishable cases share this answer: the match will
			// never be processed (nobody in the lobby is a Leetify user), and
			// the match is not processed YET. Remember the code and let the
			// retry window separate them; it expires after a day.
			res.Absent++
			if rerr := s.store.RememberAbsentCode(ctx, steamID, code); rerr != nil {
				s.log.Warn("matchsync: retry bookkeeping failed", "code", code, "err", rerr)
			}
			continue
		case err != nil:
			res.Failed++
			s.log.Warn("matchsync: match fetch failed", "code", code, "err", err)
			continue
		}
		// Stamp the code this match was fetched BY. Leetify's payload does not
		// reliably carry it, and this string is the store's dedupe key: leave
		// it empty and every future sync re-fetches this match forever, which
		// is exactly the failure that burned a night of live debugging.
		m.DataSourceMatchID = code
		if err := s.store.SaveMatch(ctx, m); err != nil {
			res.Failed++
			s.log.Warn("matchsync: save failed", "code", code, "err", err)
			continue
		}
		res.Fetched++
		// One line per stored match, with the one fact every debugging session
		// has needed and never had: is the player we synced for actually IN it?
		s.log.Info("matchsync: stored",
			"steam", steamID,
			"code", code,
			"match", m.ID,
			"map", m.MapName,
			"finished", m.FinishedTime().Format("2006-01-02"),
			"subject_present", func() bool { _, ok := m.Player(steamID); return ok }())
	}
	return res, nil
}

// Aggregate is a player's telemetry across the matches we hold.
//
// Averages of Leetify's own fields, never a rescaling of them: their developer
// guidelines forbid recalculating their metrics, and a composite invented here
// would also be a number nobody could check. Matches is what makes the rest
// readable — three matches and thirty deserve different confidence.
type Aggregate struct {
	Matches       int       `json:"matches"`
	Newest        time.Time `json:"newest"`
	Oldest        time.Time `json:"oldest"`
	Preaim        float64   `json:"preaim,omitempty"`
	ReactionTime  float64   `json:"reactionTime,omitempty"`
	AccuracyHead  float64   `json:"accuracyHead,omitempty"`
	SprayAccuracy float64   `json:"sprayAccuracy,omitempty"`
	LeetifyRating float64   `json:"leetifyRating,omitempty"`
	KDRatio       float64   `json:"kdRatio,omitempty"`
	DPR           float64   `json:"dpr,omitempty"`
	Kills         int       `json:"kills,omitempty"`
	Deaths        int       `json:"deaths,omitempty"`
	// Career-parity fields: a connected account's card should show what a
	// Leetify-profile card shows, wherever the match reports carry it.
	SpottedAcc    float64 `json:"spottedAcc,omitempty"`    // fraction
	CounterStrafe float64 `json:"counterStrafe,omitempty"` // fraction
	FlashPerThrow float64 `json:"flashPerThrow,omitempty"` // foes hit per flashbang thrown
	HEDmgAvg      float64 `json:"heDmgAvg,omitempty"`
	TradesWonPct  float64 `json:"tradesWonPct,omitempty"` // as Leetify serves it
	MVPs          int     `json:"mvps,omitempty"`
}

// Aggregated reads a player's stored rows and averages them.
func (s *Syncer) Aggregated(ctx context.Context, steamID uint64, limit int) (Aggregate, []db.PlayerMatchRow, error) {
	rows, err := s.store.PlayerMatches(ctx, steamID, limit)
	if err != nil {
		return Aggregate{}, nil, err
	}
	return Summarise(rows), rows, nil
}

// Summarise averages a set of stored rows.
//
// Each field is averaged only over the rows that carry it. A match where
// Leetify recorded no crosshair data must not drag the average toward zero —
// absent is not the same as zero, and treating it as zero would make a player
// look sharper than they are.
func Summarise(rows []db.PlayerMatchRow) Aggregate {
	var a Aggregate
	a.Matches = len(rows)
	if len(rows) == 0 {
		return a
	}

	type acc struct {
		sum float64
		n   int
	}
	var preaim, react, head, spray, rating, kd, dpr, spotted, cstrafe, hedmg, trades acc
	var flashHit, flashThrown int
	add := func(t *acc, v float64) {
		if v > 0 {
			t.sum += v
			t.n++
		}
	}
	mean := func(t acc) float64 {
		if t.n == 0 {
			return 0
		}
		return t.sum / float64(t.n)
	}

	for _, r := range rows {
		add(&preaim, r.Preaim)
		add(&react, r.ReactionTime)
		add(&head, r.AccuracyHead)
		add(&spray, r.SprayAccuracy)
		add(&kd, r.KDRatio)
		add(&dpr, r.DPR)
		// A Leetify rating is legitimately negative for a below-average game,
		// so it cannot use the >0 rule the others do.
		if r.RoundsCount > 0 {
			rating.sum += r.LeetifyRating
			rating.n++
		}
		add(&spotted, r.SpottedAcc)
		add(&cstrafe, r.CStrafeRatio)
		add(&hedmg, r.HEDmgAvg)
		add(&trades, r.TradeWinPct)
		flashHit += r.FlashHitFoe
		flashThrown += r.FlashThrown
		a.Kills += r.TotalKills
		a.Deaths += r.TotalDeaths
		a.MVPs += r.MVPs
	}

	a.Preaim = mean(preaim)
	a.ReactionTime = mean(react)
	a.AccuracyHead = mean(head)
	a.SprayAccuracy = mean(spray)
	a.LeetifyRating = mean(rating)
	a.KDRatio = mean(kd)
	a.DPR = mean(dpr)
	a.SpottedAcc = mean(spotted)
	a.CounterStrafe = mean(cstrafe)
	a.HEDmgAvg = mean(hedmg)
	a.TradesWonPct = mean(trades)
	// Ratio of sums, not mean of ratios: the profile stat is "foes hit per
	// flashbang", and a game with no flashes must not count as a zero.
	if flashThrown > 0 {
		a.FlashPerThrow = float64(flashHit) / float64(flashThrown)
	}

	dates := make([]time.Time, 0, len(rows))
	for _, r := range rows {
		if !r.FinishedAt.IsZero() && r.FinishedAt.Year() > 1971 {
			dates = append(dates, r.FinishedAt)
		}
	}
	if len(dates) > 0 {
		sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
		a.Oldest = dates[0]
		a.Newest = dates[len(dates)-1]
	}
	return a
}

// GCSource adapts the game-coordinator bot to CodeSource: a player's most
// recent official matches, rebuilt into share codes.
//
// Only answers for accounts whose Steam game details are public — the GC stays
// silent otherwise, which surfaces as ErrNoReply and is treated as "this source
// has nothing for this player" rather than a failure.
type GCSource struct {
	Bot interface {
		Recent(ctx context.Context, steamID64 string) ([]gcbot.RecentMatch, error)
	}
}

func (g GCSource) ShareCodes(ctx context.Context, steamID uint64) ([]string, error) {
	if g.Bot == nil {
		return nil, nil
	}
	matches, err := g.Bot.Recent(ctx, strconv.FormatUint(steamID, 10))
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if code, ok := m.ShareCode(); ok {
			out = append(out, code)
		}
	}
	return out, nil
}

// ProfileScale is an Aggregate expressed in the units Leetify's PROFILE
// endpoint uses — which is what the CheatMeter was written against.
//
// The two Leetify surfaces disagree about units for the same fields, measured
// against both on 2026-08-27:
//
//	                profile          match report
//	reaction        449.36 (ms)      0.6719 (seconds)
//	head accuracy   29.05  (percent) 0.2162 (fraction)
//	spray accuracy  41.49  (percent) 0.3846 (fraction)
//	rating          4.26   (ranks)   0.0873 (per match)
//	preaim          7.18   (degrees) 5.4    (degrees)
//
// This conversion exists so that disagreement is handled once, here, rather
// than in whatever renders it. Getting reaction wrong is not a cosmetic bug:
// the scorer reads it as "lower is more suspicious" against a 560ms→430ms
// scale, so feeding it seconds would peg EVERY player at maximum on the single
// most heavily weighted signal.
type ProfileScale struct {
	Matches        int     `json:"matches"`
	ReactionTimeMs float64 `json:"reactionTimeMs,omitempty"`
	Preaim         float64 `json:"preaim,omitempty"`
	AccuracyHead   float64 `json:"accuracyHead,omitempty"`
	SprayAccuracy  float64 `json:"sprayAccuracy,omitempty"`
	LeetifyRating  float64 `json:"leetifyRating,omitempty"`
	KDRatio        float64 `json:"kdRatio,omitempty"`
	DPR            float64 `json:"dpr,omitempty"`
	SpottedAcc     float64 `json:"spottedAcc,omitempty"`    // percent
	CounterStrafe  float64 `json:"counterStrafe,omitempty"` // percent
	FlashPerThrow  float64 `json:"flashPerThrow,omitempty"`
	HEDmgAvg       float64 `json:"heDmgAvg,omitempty"`
	TradesWonPct   float64 `json:"tradesWonPct,omitempty"`
	MVPs           int     `json:"mvps,omitempty"`
}

// ProfileScale converts. Zero stays zero: absent is not a measurement, and a
// converted zero would read as an impossibly fast reaction.
func (a Aggregate) ProfileScale() ProfileScale {
	scale := func(v, by float64) float64 {
		if v <= 0 {
			return 0
		}
		return v * by
	}
	return ProfileScale{
		Matches:        a.Matches,
		ReactionTimeMs: scale(a.ReactionTime, 1000),
		Preaim:         a.Preaim, // already degrees on both surfaces
		AccuracyHead:   scale(a.AccuracyHead, 100),
		SprayAccuracy:  scale(a.SprayAccuracy, 100),
		// A per-match rating sits around 0.02; the profile's ranks.leetify for
		// the same class of player sits around 2. Negative means a genuinely
		// below-average run, so this one must not use the zero guard.
		LeetifyRating: a.LeetifyRating * 100,
		KDRatio:       a.KDRatio,
		DPR:           a.DPR,
		SpottedAcc:    scale(a.SpottedAcc, 100),
		CounterStrafe: scale(a.CounterStrafe, 100),
		FlashPerThrow: a.FlashPerThrow,
		HEDmgAvg:      a.HEDmgAvg,
		// Served as-is: Leetify already names it a percentage, and the display
		// layer normalises either scale rather than double-converting here.
		TradesWonPct: a.TradesWonPct,
		MVPs:         a.MVPs,
	}
}
