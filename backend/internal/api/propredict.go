package api

import "math"

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
}

// predFactor is one explainable input: both teams' values plus the signed
// contribution it adds toward team A in the logistic (positive = favors A).
type predFactor struct {
	Key          string  `json:"key"`
	Label        string  `json:"label"`
	A            float64 `json:"a"`
	B            float64 `json:"b"`
	Contribution float64 `json:"contribution"`
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

const predModel = "heuristic-v1"

// recency weight for the i-th most recent series (i=0 newest). Halves roughly
// every 6 series — last month's form matters far more than 3 months ago.
func predWeight(i int) float64 { return math.Pow(0.89, float64(i)) }

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// buildPrediction turns the two teams' window aggregates + head-to-head wins
// into the probability + factor breakdown. a/b follow ms.Teams order.
func buildPrediction(a, b predTeamStats, h2hWinsA, h2hWinsB int) prediction {
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

	p.Available = true
	p.PA = 1 / (1 + math.Exp(-x))
	p.Factors = factors
	return p
}
