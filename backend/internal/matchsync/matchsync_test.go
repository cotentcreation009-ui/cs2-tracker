package matchsync

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/gcbot"
	"github.com/cs2tracker/server/internal/leetify"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// --- fakes ------------------------------------------------------------------

type fakeStore struct {
	mu     sync.Mutex
	stored map[string]bool // share codes already held
	saved  []*leetify.Match
	rows   []db.PlayerMatchRow
	seeErr error
}

func (f *fakeStore) SeenShareCodes(_ context.Context, codes []string) (map[string]bool, error) {
	if f.seeErr != nil {
		return nil, f.seeErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, c := range codes {
		if f.stored[c] {
			out[c] = true
		}
	}
	return out, nil
}

func (f *fakeStore) SaveMatch(_ context.Context, m *leetify.Match) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.saved = append(f.saved, m)
	// Fidelity: once saved, the code is stored — that is what stops the next
	// sync re-fetching it, with singleflight only an optimisation on top.
	if m.DataSourceMatchID != "" {
		f.stored[m.DataSourceMatchID] = true
	}
	return nil
}

func (f *fakeStore) PlayerMatches(context.Context, uint64, int) ([]db.PlayerMatchRow, error) {
	return f.rows, nil
}

func (f *fakeStore) PlayerMatchCount(context.Context, uint64) (int, time.Time, error) {
	return len(f.rows), time.Time{}, nil
}

type fakeFetch struct {
	mu     sync.Mutex
	calls  []string
	absent map[string]bool
	fail   map[string]bool
	delay  time.Duration // makes concurrent callers genuinely overlap
}

func (f *fakeFetch) MatchByShareCode(_ context.Context, code string) (*leetify.Match, error) {
	f.mu.Lock()
	f.calls = append(f.calls, code)
	f.mu.Unlock()
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.absent[code] {
		return nil, leetify.ErrNotFound
	}
	if f.fail[code] {
		return nil, errors.New("boom")
	}
	return &leetify.Match{ID: "m-" + code, DataSourceMatchID: code}, nil
}

type fakeSource struct {
	codes []string
	err   error
}

func (f fakeSource) ShareCodes(context.Context, uint64) ([]string, error) {
	return f.codes, f.err
}

// Real-shaped codes; the syncer rejects anything that is not one.
func codes(n int) []string {
	base := []string{
		"CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB",
		"CSGO-OLBnc-niHAz-ER5uT-oUpH6-wyTaK",
		"CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
		"CSGO-FFFFF-GGGGG-HHHHH-JJJJJ-KKKKK",
		"CSGO-LLLLL-MMMMM-NNNNN-PPPPP-QQQQQ",
		"CSGO-RRRRR-SSSSS-TTTTT-UUUUU-VVVVV",
		"CSGO-WWWWW-XXXXX-YYYYY-ZZZZZ-22222",
		"CSGO-33333-44444-55555-66666-77777",
		"CSGO-88888-99999-aaaaa-bbbbb-ccccc",
		"CSGO-ddddd-eeeee-fffff-ggggg-hhhhh",
	}
	return base[:n]
}

// --- tests ------------------------------------------------------------------

func TestSyncSkipsStoredAndCountsOutcomes(t *testing.T) {
	c := codes(5)
	store := &fakeStore{stored: map[string]bool{c[0]: true, c[1]: true}}
	fetch := &fakeFetch{
		absent: map[string]bool{c[2]: true},
		fail:   map[string]bool{c[3]: true},
	}
	s := New(store, fetch, quiet(), fakeSource{codes: c})

	res, err := s.Sync(context.Background(), 76561197995150836)
	if err != nil {
		t.Fatal(err)
	}
	if res.Offered != 5 || res.New != 3 {
		t.Errorf("offered/new = %d/%d, want 5/3", res.Offered, res.New)
	}
	// A code already stored must never be fetched again — matches are immutable
	// and the rate budget is the scarce resource.
	for _, called := range fetch.calls {
		if called == c[0] || called == c[1] {
			t.Errorf("re-fetched an already-stored code: %s", called)
		}
	}
	if res.Fetched != 1 || res.Absent != 1 || res.Failed != 1 {
		t.Errorf("fetched/absent/failed = %d/%d/%d, want 1/1/1",
			res.Fetched, res.Absent, res.Failed)
	}
	// Absent is not failure: nothing was saved for it, and nothing errored.
	if len(store.saved) != 1 {
		t.Errorf("saved %d matches, want 1", len(store.saved))
	}
}

func TestSyncCapsWorkPerPlayer(t *testing.T) {
	c := codes(10)
	store := &fakeStore{stored: map[string]bool{}}
	fetch := &fakeFetch{}
	s := New(store, fetch, quiet(), fakeSource{codes: c})

	res, _ := s.Sync(context.Background(), 1)
	if res.New != 10 {
		t.Errorf("new = %d, want 10", res.New)
	}
	// The per-minute budget belongs to the whole site: one player must not be
	// able to hold the queue for everyone else.
	if len(fetch.calls) != maxPerSync {
		t.Errorf("fetched %d, want the cap of %d", len(fetch.calls), maxPerSync)
	}
}

func TestSyncDedupesAcrossSourcesAndRejectsJunk(t *testing.T) {
	c := codes(3)
	store := &fakeStore{stored: map[string]bool{}}
	fetch := &fakeFetch{}
	s := New(store, fetch, quiet(),
		fakeSource{codes: []string{c[0], c[1]}},
		// Overlapping source, plus values that are not share codes at all.
		fakeSource{codes: []string{c[1], c[2], "", "nonsense", "67458e1e-eb68-40e0"}},
	)
	res, _ := s.Sync(context.Background(), 1)
	if res.Offered != 3 {
		t.Errorf("offered = %d, want 3 distinct valid codes", res.Offered)
	}
	if len(fetch.calls) != 3 {
		t.Errorf("fetched %d, want 3", len(fetch.calls))
	}
}

func TestSyncSurvivesASilentSource(t *testing.T) {
	c := codes(2)
	store := &fakeStore{stored: map[string]bool{}}
	fetch := &fakeFetch{}
	// The game coordinator never answers for private accounts. That is an
	// answer about the player, not a reason to abandon the other sources.
	s := New(store, fetch, quiet(),
		fakeSource{err: gcbot.ErrNoReply},
		fakeSource{codes: c},
	)
	res, err := s.Sync(context.Background(), 1)
	if err != nil {
		t.Fatalf("a silent source failed the sync: %v", err)
	}
	if res.Fetched != 2 {
		t.Errorf("fetched = %d, want 2 from the surviving source", res.Fetched)
	}
}

func TestSyncCoalescesConcurrentCallers(t *testing.T) {
	c := codes(3)
	store := &fakeStore{stored: map[string]bool{}}
	// A real sync is rate-limited to minutes; the fakes are instant, so without
	// a delay the goroutines finish before the next starts and there is nothing
	// for singleflight to coalesce.
	fetch := &fakeFetch{delay: 15 * time.Millisecond}
	s := New(store, fetch, quiet(), fakeSource{codes: c})

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.Sync(context.Background(), 42) }()
	}
	wg.Wait()
	// Ten people opening one profile must cost one pass over the budget.
	if len(fetch.calls) != 3 {
		t.Errorf("fetched %d times for 10 concurrent callers, want 3", len(fetch.calls))
	}
}

func TestSummariseIgnoresAbsentFields(t *testing.T) {
	rows := []db.PlayerMatchRow{
		{Preaim: 6, ReactionTime: 0.6, KDRatio: 1.5, RoundsCount: 22, LeetifyRating: 0.10,
			TotalKills: 20, TotalDeaths: 10, FinishedAt: time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)},
		// Leetify recorded no crosshair data for this one. Averaging it in as
		// zero would make the player look twice as sharp as they are.
		{Preaim: 0, ReactionTime: 0, KDRatio: 0.5, RoundsCount: 20, LeetifyRating: -0.04,
			TotalKills: 10, TotalDeaths: 20, FinishedAt: time.Date(2026, 4, 5, 0, 0, 0, 0, time.UTC)},
	}
	a := Summarise(rows)
	if a.Matches != 2 {
		t.Errorf("matches = %d", a.Matches)
	}
	if a.Preaim != 6 {
		t.Errorf("preaim = %v, want 6 (averaged over the one row that has it)", a.Preaim)
	}
	if a.ReactionTime != 0.6 {
		t.Errorf("reaction = %v, want 0.6", a.ReactionTime)
	}
	if a.KDRatio != 1.0 {
		t.Errorf("kd = %v, want 1.0", a.KDRatio)
	}
	// A negative rating is a real below-average game, not a missing value.
	if want := (0.10 - 0.04) / 2; math.Abs(a.LeetifyRating-want) > 1e-9 {
		t.Errorf("rating = %v, want %v (negatives must count)", a.LeetifyRating, want)
	}
	if a.Kills != 30 || a.Deaths != 30 {
		t.Errorf("kills/deaths = %d/%d, want 30/30", a.Kills, a.Deaths)
	}
	if a.Newest.Month() != time.July || a.Oldest.Month() != time.April {
		t.Errorf("date range = %v..%v", a.Oldest, a.Newest)
	}
	if got := Summarise(nil); got.Matches != 0 {
		t.Errorf("empty summarise = %+v", got)
	}
}

func TestGCSourceRebuildsCodes(t *testing.T) {
	src := GCSource{Bot: fakeBot{matches: []gcbot.RecentMatch{
		{MatchID: "3829850547188400403", ReservationID: "3829854876515434633", TVPort: 58343},
		{MatchID: "123"}, // an older sidecar: no ids, so no code
	}}}
	got, err := src.ShareCodes(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != "CSGO-X5EDM-CJCpX-dTvfS-kMP7u-EhMMB" {
		t.Errorf("codes = %v", got)
	}
	// No bot configured is "no codes", not a crash.
	if c, err := (GCSource{}).ShareCodes(context.Background(), 1); err != nil || len(c) != 0 {
		t.Errorf("nil bot: %v %v", c, err)
	}
}

type fakeBot struct {
	matches []gcbot.RecentMatch
	err     error
}

func (f fakeBot) Recent(_ context.Context, id string) ([]gcbot.RecentMatch, error) {
	if _, err := strconv.ParseUint(id, 10, 64); err != nil {
		return nil, errors.New("bot got a non-numeric steam id: " + id)
	}
	return f.matches, f.err
}

// The unit conversion is the most dangerous line in this package. Leetify's
// profile and match surfaces disagree, and the scorer was written against the
// profile's units: it reads reaction as "lower is worse" on a 560ms->430ms
// scale, so seconds passed through unconverted would peg EVERY player at
// maximum on the most heavily weighted signal.
func TestProfileScaleUnits(t *testing.T) {
	// Malone Lam's real numbers, measured from his match reports.
	a := Aggregate{
		Matches:       17,
		ReactionTime:  0.6719, // seconds
		Preaim:        5.4,    // degrees
		AccuracyHead:  0.2162, // fraction
		SprayAccuracy: 0.3846, // fraction
		LeetifyRating: 0.023,  // per-match scale
		KDRatio:       1.358,
	}
	p := a.ProfileScale()

	if math.Abs(p.ReactionTimeMs-671.9) > 0.01 {
		t.Errorf("reaction = %v ms, want 671.9 — seconds must become milliseconds", p.ReactionTimeMs)
	}
	// The regression that matters: an ordinary 0.67s reaction must NOT look
	// like a superhuman sub-millisecond one.
	if p.ReactionTimeMs < 100 {
		t.Errorf("reaction %v ms would score as inhumanly fast", p.ReactionTimeMs)
	}
	if p.Preaim != 5.4 {
		t.Errorf("preaim = %v, want 5.4 unchanged (degrees on both surfaces)", p.Preaim)
	}
	if math.Abs(p.AccuracyHead-21.62) > 0.01 {
		t.Errorf("head accuracy = %v, want 21.62 percent", p.AccuracyHead)
	}
	if math.Abs(p.SprayAccuracy-38.46) > 0.01 {
		t.Errorf("spray = %v, want 38.46 percent", p.SprayAccuracy)
	}
	// Per-match ~0.023 is the same class of player as a profile rating of ~2.3.
	if math.Abs(p.LeetifyRating-2.3) > 0.01 {
		t.Errorf("rating = %v, want 2.3 on the ranks scale", p.LeetifyRating)
	}
	if p.KDRatio != 1.358 {
		t.Errorf("kd = %v, want unchanged", p.KDRatio)
	}
	if p.Matches != 17 {
		t.Errorf("matches = %d", p.Matches)
	}
}

func TestProfileScaleKeepsAbsentAbsent(t *testing.T) {
	// Absent is not a measurement. A converted zero reaction would read as the
	// fastest possible human, which is the opposite of "we don't know".
	p := Aggregate{Matches: 3}.ProfileScale()
	if p.ReactionTimeMs != 0 || p.AccuracyHead != 0 || p.SprayAccuracy != 0 || p.Preaim != 0 {
		t.Errorf("absent fields became values: %+v", p)
	}
	// A negative rating is a real below-average run, so it must survive scaling
	// rather than being zeroed like the others.
	if got := (Aggregate{LeetifyRating: -0.04}).ProfileScale().LeetifyRating; math.Abs(got-(-4)) > 1e-9 {
		t.Errorf("negative rating = %v, want -4", got)
	}
}
