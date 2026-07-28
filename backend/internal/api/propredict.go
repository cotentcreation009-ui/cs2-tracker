package api

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/cs2tracker/server/internal/grid"
)

// Pre-match win prediction — a TRANSPARENT heuristic, not a trained model.
// Every input is a number the response also SHOWS (recent results, direct
// meetings, map-score margins, lineup K/D), so the "why" is always backed by
// the same evidence the user can read below the bar. Weights are hand-tuned
// for sane behavior (form dominates; a 3-0 head-to-head matters but can't
// overrule terrible current form; roster skill nudges) and the output is
// labelled an estimate. When either team has fewer than 3 finished series in
// the window, no probability is produced — showing a confident number on thin
// data would be the opposite of "backed by evidence".

// predTeamStats is one team's aggregates over the tracked window, collected
// during buildMatchHistory's single pass over cached results.
type predTeamStats struct {
	N         int     // finished series counted
	Wins      int
	Losses    int
	Weighted  float64 // recency-weighted win credit (newest counts most)
	WeightSum float64
	MarginSum float64 // Σ per-series map-score margin (mine − theirs)
	KD        float64 // roster K/D average (0 when unknown)
	// current streak (entries arrive newest-first; frozen at the first flip)
	Streak     int
	StreakWon  bool
	streakDone bool
}

// predFactor is one explainable input: both teams' values plus the signed
// contribution it adds toward team A in the logistic (positive = favors A).
// PP is the factor's percentage-point swing IN CONTEXT — how much the final
// probability would drop if this factor were removed — so "Recent form: +8pp"
// is a concrete, checkable claim rather than an abstract weight.
type predFactor struct {
	Key          string  `json:"key"`
	Label        string  `json:"label"`
	A            float64 `json:"a"`
	B            float64 `json:"b"`
	Contribution float64 `json:"contribution"`
	PP           float64 `json:"pp"`
	Note         string  `json:"note,omitempty"`
}

type prediction struct {
	Available bool         `json:"available"`
	Reason    string       `json:"reason,omitempty"` // when unavailable
	PA        float64      `json:"pA"`               // P(team[0] wins the series), 0..1
	Factors   []predFactor `json:"factors,omitempty"`
	SeriesN   [2]int       `json:"seriesN"` // evidence base per team
	Model     string       `json:"model"`   // versioned so the UI can label it
}

const predModel = "heuristic-v2" // v2: + map-pool factor over shared/picked maps

// recWL is a per-map win/loss record.
type recWL struct{ W, L int }

// mapPoolFactor compares the two teams map by map. Only maps BOTH teams have
// >=2 recorded plays on count (a 1-0 map record is noise), each weighted by
// the smaller sample. When the series' picked maps are known (live/decided
// vetoes), only those maps count — a much stronger claim, noted as such.
// Returns nil when there's no honest basis for the comparison.
func mapPoolFactor(a, b map[string]recWL, picked []string) *predFactor {
	pickedSet := map[string]bool{}
	for _, m := range picked {
		if m != "" {
			pickedSet[m] = true
		}
	}
	var wSum, diffSum, aSum, bSum float64
	shared := 0
	for m, ra := range a {
		rb, ok := b[m]
		if !ok {
			continue
		}
		if len(pickedSet) > 0 && !pickedSet[m] {
			continue
		}
		na, nb := ra.W+ra.L, rb.W+rb.L
		if na < 2 || nb < 2 {
			continue
		}
		w := math.Min(float64(na), float64(nb))
		wra := float64(ra.W) / float64(na)
		wrb := float64(rb.W) / float64(nb)
		wSum += w
		diffSum += w * (wra - wrb)
		aSum += w * wra
		bSum += w * wrb
		shared++
	}
	minShared := 2
	if len(pickedSet) > 0 {
		minShared = 1 // a known pick is meaningful on its own
	}
	if shared < minShared || wSum <= 0 {
		return nil
	}
	note := fmt.Sprintf("win rate across %d map%s both teams played (weighted by sample)", shared, plural(shared))
	if len(pickedSet) > 0 {
		note = fmt.Sprintf("win rate on THIS series' %d map%s (weighted by sample)", shared, plural(shared))
	}
	return &predFactor{
		Key: "mappool", Label: "Map pool", A: aSum / wSum, B: bSum / wSum,
		Contribution: 0.7 * clampF((diffSum/wSum)*2, -1, 1),
		Note:         note,
	}
}

// recency weight for the i-th most recent series (i=0 newest). Halves roughly
// every 6 series — last month's form matters far more than 3 months ago.
func predWeight(i int) float64 { return math.Pow(0.89, float64(i)) }

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// buildPrediction turns the two teams' window aggregates + head-to-head wins
// into the probability + factor breakdown. a/b follow ms.Teams order.
// mapPool is optional (nil when no honest map comparison exists).
func buildPrediction(a, b predTeamStats, h2hWinsA, h2hWinsB int, mapPool *predFactor) prediction {
	p := prediction{Model: predModel, SeriesN: [2]int{a.N, b.N}}
	if a.N < 3 || b.N < 3 {
		p.Reason = "not enough finished series in the tracked window to call it"
		return p
	}

	formA := a.Weighted / math.Max(1e-9, a.WeightSum)
	formB := b.Weighted / math.Max(1e-9, b.WeightSum)
	fForm := predFactor{
		Key: "form", Label: "Recent form", A: formA, B: formB,
		Contribution: 1.9 * (formA - formB),
		Note:         "recency-weighted series win rate — the workhorse signal",
	}

	meetings := h2hWinsA + h2hWinsB
	lean := 0.0
	if meetings > 0 {
		lean = float64(h2hWinsA-h2hWinsB) / float64(meetings) * math.Min(1, float64(meetings)/3)
	}
	fH2H := predFactor{
		Key: "h2h", Label: "Head-to-head", A: float64(h2hWinsA), B: float64(h2hWinsB),
		Contribution: 0.8 * lean,
		Note:         "direct meetings in the window; damped under 3 meetings",
	}

	marginA := a.MarginSum / float64(a.N)
	marginB := b.MarginSum / float64(b.N)
	fMargin := predFactor{
		Key: "margin", Label: "Series dominance", A: marginA, B: marginB,
		Contribution: 0.6 * clampF((marginA-marginB)/2, -1, 1),
		Note:         "avg map-score margin per series — winning 2-0 beats winning 2-1",
	}

	factors := []predFactor{fForm, fH2H, fMargin}
	x := fForm.Contribution + fH2H.Contribution + fMargin.Contribution
	if mapPool != nil {
		factors = append(factors, *mapPool)
		x += mapPool.Contribution
	}

	// roster skill nudge — only when BOTH lineups have K/D data
	if a.KD > 0 && b.KD > 0 {
		fKD := predFactor{
			Key: "lineup", Label: "Lineup K/D", A: a.KD, B: b.KD,
			Contribution: 0.7 * clampF(a.KD-b.KD, -0.5, 0.5) * 2,
			Note:         "average K/D of the published roster over its recent series",
		}
		factors = append(factors, fKD)
		x += fKD.Contribution
	}

	// Certainty cap: a hand-tuned heuristic has no business claiming more than
	// ~90% before a series starts — upsets are the sport.
	x = clampF(x, -2.2, 2.2)
	p.Available = true
	p.PA = 1 / (1 + math.Exp(-x))
	// per-factor swing in context: P(with everything) − P(without this factor)
	for i := range factors {
		factors[i].PP = (p.PA - 1/(1+math.Exp(-(x-factors[i].Contribution)))) * 100
	}
	p.Factors = factors
	return p
}

// reconcileProPredictions resolves pending ledger entries against finished
// series results — lazy and best-effort, piggybacked on /history traffic and
// throttled per process. Bounded at 10 lookups per run (the resolver is the
// same cached series-result path the history panel uses).
func (s *Server) reconcileProPredictions(ctx context.Context, resultOf func(string) *grid.SeriesResult) {
	s.predReconMu.Lock()
	if time.Since(s.predReconAt) < 5*time.Minute {
		s.predReconMu.Unlock()
		return
	}
	s.predReconAt = time.Now()
	s.predReconMu.Unlock()
	rows, err := s.db.ListUnresolvedProPredictions(ctx, 10)
	if err != nil {
		return
	}
	for _, r := range rows {
		res := resultOf(r.SeriesID)
		if res == nil || !res.Finished {
			continue
		}
		winner := ""
		for _, t := range res.Teams {
			if t.Won {
				winner = t.GridID
			}
		}
		if winner == "" {
			continue
		}
		correct := (winner == r.TeamAID) == (r.PA >= 0.5)
		_ = s.db.ResolveProPrediction(ctx, r.SeriesID, winner, correct)
	}
}
