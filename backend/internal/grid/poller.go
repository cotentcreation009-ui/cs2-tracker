package grid

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// --- Store ------------------------------------------------------------------

// Store holds the current pro-match board in memory. It is safe for concurrent
// use: the poller writes, HTTP handlers read.
type Store struct {
	mu        sync.RWMutex
	entries   map[string]*trackedSeries
	updatedAt time.Time
	enabled   bool
}

type trackedSeries struct {
	state           MatchState
	lastSeenCentral time.Time // last time the schedule loop saw this series
	lastStateFetch  time.Time // last time the state loop fetched it
}

func newStore(enabled bool) *Store {
	return &Store{
		entries:   make(map[string]*trackedSeries),
		updatedAt: time.Now().UTC(),
		enabled:   enabled,
	}
}

// Enabled reports whether the pro-match feature is on (an API key is configured
// or mock mode is active). When false, handlers return {"enabled":false,...}.
func (s *Store) Enabled() bool { return s.enabled }

// Board returns the served list — LIVE first (by start asc), then UPCOMING (by
// start asc); finished series are excluded — plus the last-updated timestamp.
func (s *Store) Board() ([]MatchState, time.Time) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]MatchState, 0, len(s.entries))
	for _, e := range s.entries {
		if e.state.Status == "finished" {
			continue
		}
		list = append(list, e.state)
	}
	sort.SliceStable(list, func(i, j int) bool {
		ri, rj := statusRank(list[i].Status), statusRank(list[j].Status)
		if ri != rj {
			return ri < rj
		}
		return parseTime(list[i].StartScheduled).Before(parseTime(list[j].StartScheduled))
	})
	return list, s.updatedAt
}

func statusRank(st string) int {
	if st == "live" {
		return 0
	}
	return 1
}

// Get returns a single series by id (including finished ones, so a just-ended
// match detail page still resolves). ok is false for an unknown id.
func (s *Store) Get(id string) (MatchState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if e, ok := s.entries[id]; ok {
		return e.state, true
	}
	return MatchState{}, false
}

// upsertSchedule merges a batch of Central Data nodes into the store: existing
// series get their static fields refreshed (dynamic live data preserved); new
// series are inserted as upcoming.
func (s *Store) upsertSchedule(nodes []centralNode, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, n := range nodes {
		if n.ID == "" {
			continue
		}
		sched := normalizeSchedule(n)
		if isTestSeries(sched) {
			continue // GRID-TEST / placeholder series never reach the board
		}
		if ex, ok := s.entries[n.ID]; ok {
			ex.lastSeenCentral = now
			mergeSchedule(&ex.state, sched)
		} else {
			s.entries[n.ID] = &trackedSeries{state: sched, lastSeenCentral: now}
		}
	}
	s.updatedAt = now
}

// applyState folds a Series State response into the tracked series.
func (s *Store) applyState(id string, ss *seriesStateNode, now time.Time) {
	if ss == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ex, ok := s.entries[id]
	if !ok {
		ex = &trackedSeries{state: MatchState{SeriesID: id}, lastSeenCentral: now}
		s.entries[id] = ex
	}
	applySeriesState(&ex.state, ss, now)
	ex.lastStateFetch = now
	s.updatedAt = now
}

// dueForStateFetch returns the ids whose live state should be polled now: live
// series, plus upcoming series whose scheduled start is within [-4h, +5m].
// Ordered live-first so the aggregate rate cap favours in-progress matches.
func (s *Store) dueForStateFetch(now time.Time) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	type due struct {
		id    string
		live  bool
		start time.Time
	}
	var ds []due
	for id, e := range s.entries {
		switch e.state.Status {
		case "finished":
			continue
		case "live":
			ds = append(ds, due{id, true, parseTime(e.state.StartScheduled)})
		default: // upcoming
			start := parseTime(e.state.StartScheduled)
			if !start.IsZero() && start.Before(now.Add(5*time.Minute)) && start.After(now.Add(-4*time.Hour)) {
				ds = append(ds, due{id, false, start})
			}
		}
	}
	sort.Slice(ds, func(i, j int) bool {
		if ds[i].live != ds[j].live {
			return ds[i].live
		}
		return ds[i].start.Before(ds[j].start)
	})
	ids := make([]string, len(ds))
	for i := range ds {
		ids[i] = ds[i].id
	}
	return ids
}

// prune bounds memory: finished series are kept only until they age out of the
// central window (so the schedule loop can't resurrect them as upcoming), and
// upcoming series that fall off the schedule are dropped. Live series are kept
// regardless (a match that started >4h ago drops out of Central but is still on).
func (s *Store) prune(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, e := range s.entries {
		switch e.state.Status {
		case "live":
			// keep
		case "finished":
			if now.Sub(e.lastSeenCentral) > 30*time.Minute {
				delete(s.entries, id)
			}
		default: // upcoming
			if now.Sub(e.lastSeenCentral) > 10*time.Minute {
				delete(s.entries, id)
			}
		}
	}
}

func (s *Store) knownIDs() map[string]struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m := make(map[string]struct{}, len(s.entries))
	for id := range s.entries {
		m[id] = struct{}{}
	}
	return m
}

// replaceAll swaps in a fresh set of states (mock mode).
func (s *Store) replaceAll(states []MatchState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	s.entries = make(map[string]*trackedSeries, len(states))
	for i := range states {
		st := states[i]
		s.entries[st.SeriesID] = &trackedSeries{state: st, lastSeenCentral: now, lastStateFetch: now}
	}
	s.updatedAt = now
}

// tickMock advances the clock on live mock maps so the sample board feels live.
func (s *Store) tickMock(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.entries {
		if e.state.Status != "live" {
			continue
		}
		for i := range e.state.Maps {
			m := &e.state.Maps[i]
			if m.Started && !m.Finished {
				m.ClockSeconds += 5
				if m.ClockSeconds > 115 {
					m.ClockSeconds = 0
				}
			}
		}
		e.state.LiveUpdatedAt = now.Format(time.RFC3339)
		e.state.FetchedAt = now.Format(time.RFC3339)
	}
	s.updatedAt = now
}

// --- Poller -----------------------------------------------------------------

// Options configures a Poller.
type Options struct {
	APIKey     string
	BaseURL    string
	Mock       bool
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// Poller owns the Store and keeps it fresh from GRID (or from sample data in
// mock mode). Two loops run: schedule (Central Data, every 90s) and live state
// (Series State, every 10s, rate-limited per-series and overall).
type Poller struct {
	client *Client
	store  *Store
	log    *slog.Logger
	mock   bool

	overall *rate.Limiter // aggregate Series State cap (~180/min)

	limMu    sync.Mutex
	limiters map[string]*rate.Limiter // per-series cap (6/min)
}

// NewPoller builds a Poller. It is enabled when an API key is set or mock mode is
// on; otherwise Start is a no-op and the Store reports disabled.
func NewPoller(o Options) *Poller {
	log := o.Logger
	if log == nil {
		log = slog.Default()
	}
	enabled := o.Mock || strings.TrimSpace(o.APIKey) != ""
	return &Poller{
		client:   NewClient(o.BaseURL, o.APIKey, o.HTTPClient, log),
		store:    newStore(enabled),
		log:      log,
		mock:     o.Mock,
		overall:  rate.NewLimiter(rate.Every(time.Minute/180), 10),
		limiters: make(map[string]*rate.Limiter),
	}
}

// Store exposes the in-memory board for the HTTP handlers.
func (p *Poller) Store() *Store { return p.store }

// Client exposes the GRID client for on-demand fetches (history endpoint).
func (p *Poller) Client() *Client { return p.client }

// Start launches the background loops. It returns immediately; the loops stop
// when ctx is cancelled. Safe to call when disabled (does nothing).
func (p *Poller) Start(ctx context.Context) {
	if !p.store.Enabled() {
		return
	}
	if p.mock {
		p.store.replaceAll(sampleMatches(time.Now().UTC()))
		p.log.Info("grid: pro-match board running in MOCK mode (no key/network)")
		go p.runMock(ctx)
		return
	}
	go p.run(ctx)
}

func (p *Poller) run(ctx context.Context) {
	p.resolveTitle(ctx)
	p.pollSchedule(ctx) // seed the board immediately
	go p.loopSchedule(ctx)
	p.loopState(ctx) // blocks until ctx is done
}

func (p *Poller) resolveTitle(ctx context.Context) {
	tctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	id, err := p.client.ResolveTitleID(tctx)
	if err != nil || id == "" {
		p.log.Warn("grid: CS2 titleId resolve failed — falling back to 28", "err", err)
		p.client.SetTitleID("28")
		return
	}
	p.client.SetTitleID(id)
	p.log.Info("grid: resolved CS2 titleId", "id", id)
}

func (p *Poller) loopSchedule(ctx context.Context) {
	t := time.NewTicker(90 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.pollSchedule(ctx)
		}
	}
}

func (p *Poller) pollSchedule(ctx context.Context) {
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	now := time.Now().UTC()
	gte := now.Add(-4 * time.Hour).Format(time.RFC3339)
	lte := now.Add(72 * time.Hour).Format(time.RFC3339)
	nodes, err := p.client.FetchAllSeries(cctx, gte, lte)
	if err != nil {
		p.log.Warn("grid: schedule fetch failed", "err", err)
		return
	}
	p.store.upsertSchedule(nodes, now)
	p.store.prune(now)
	p.pruneLimiters()
	p.log.Debug("grid: schedule refreshed", "series", len(nodes))
}

func (p *Poller) loopState(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.pollState(ctx)
		}
	}
}

func (p *Poller) pollState(ctx context.Context) {
	now := time.Now().UTC()
	for _, id := range p.store.dueForStateFetch(now) {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if !p.overall.Allow() {
			// Hit the aggregate cap for this tick; the rest wait for the next one.
			break
		}
		if !p.limiterFor(id).Allow() {
			continue // per-series 6/min cap
		}
		cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		ss, err := p.client.FetchSeriesState(cctx, id)
		cancel()
		if err != nil {
			if errors.Is(err, ErrThrottled) {
				p.log.Debug("grid: series-state throttled — backing off", "id", id)
				break // stop this tick entirely on a throttle signal
			}
			p.log.Debug("grid: series-state fetch failed", "id", id, "err", err)
			continue
		}
		p.store.applyState(id, ss, time.Now().UTC())
	}
}

// limiterFor returns the per-series rate limiter (6 requests/min, i.e. one per
// 10s), creating it on first use.
func (p *Poller) limiterFor(id string) *rate.Limiter {
	p.limMu.Lock()
	defer p.limMu.Unlock()
	l, ok := p.limiters[id]
	if !ok {
		l = rate.NewLimiter(rate.Every(10*time.Second), 1)
		p.limiters[id] = l
	}
	return l
}

func (p *Poller) pruneLimiters() {
	known := p.store.knownIDs()
	p.limMu.Lock()
	defer p.limMu.Unlock()
	for id := range p.limiters {
		if _, ok := known[id]; !ok {
			delete(p.limiters, id)
		}
	}
}

func (p *Poller) runMock(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			p.store.tickMock(time.Now().UTC())
		}
	}
}
