package api

import (
	"math"
	"testing"
)

// mk builds stats for n series with the given win pattern (newest first) and
// a flat per-series margin.
func mk(results []bool, margin float64, kd float64) predTeamStats {
	st := predTeamStats{KD: kd}
	for i, won := range results {
		w := predWeight(i)
		st.WeightSum += w
		if won {
			st.Wins++
			st.Weighted += w
		} else {
			st.Losses++
		}
		st.MarginSum += margin
		st.N++
	}
	return st
}

func TestPredictionEvenTeamsNearCoinflip(t *testing.T) {
	a := mk([]bool{true, false, true, false, true, false}, 0, 1.0)
	b := mk([]bool{false, true, false, true, false, true}, 0, 1.0)
	p := buildPrediction(a, b, 0, 0)
	if !p.Available {
		t.Fatalf("expected available")
	}
	// mirrored alternating records differ only by recency weighting — near even
	if math.Abs(p.PA-0.5) > 0.12 {
		t.Fatalf("expected near-coinflip, got %.3f", p.PA)
	}
}

func TestPredictionFormDominates(t *testing.T) {
	hot := mk([]bool{true, true, true, true, true, true, true, true}, 1.2, 1.05)
	cold := mk([]bool{false, false, false, false, false, false, false, false}, -1.2, 0.95)
	p := buildPrediction(hot, cold, 0, 0)
	if p.PA < 0.85 {
		t.Fatalf("8-0 vs 0-8 with margins should be decisive, got %.3f", p.PA)
	}
	// and symmetric the other way
	q := buildPrediction(cold, hot, 0, 0)
	if math.Abs(p.PA+q.PA-1) > 1e-9 {
		t.Fatalf("prediction not symmetric: %.3f vs %.3f", p.PA, q.PA)
	}
}

func TestPredictionThinDataRefuses(t *testing.T) {
	a := mk([]bool{true, true}, 1, 0)
	b := mk([]bool{false, false, false, false}, 0, 0)
	p := buildPrediction(a, b, 0, 0)
	if p.Available {
		t.Fatalf("2 finished series must not produce a probability")
	}
	if p.Reason == "" {
		t.Fatalf("unavailable prediction must say why")
	}
}

func TestPredictionH2HDampedUnderThreeMeetings(t *testing.T) {
	a := mk([]bool{true, false, true, false}, 0, 0)
	b := mk([]bool{true, false, true, false}, 0, 0)
	one := buildPrediction(a, b, 1, 0)
	three := buildPrediction(a, b, 3, 0)
	if !(three.PA > one.PA) {
		t.Fatalf("3-0 head-to-head should count more than 1-0: %.3f vs %.3f", three.PA, one.PA)
	}
	// a lone h2h win must not read as decisive on otherwise even teams
	if one.PA > 0.60 {
		t.Fatalf("single meeting over-weighted: %.3f", one.PA)
	}
}

func TestPredictionKDFactorOnlyWhenBothKnown(t *testing.T) {
	a := mk([]bool{true, false, true, false}, 0, 1.1)
	bNoKD := mk([]bool{true, false, true, false}, 0, 0)
	p := buildPrediction(a, bNoKD, 0, 0)
	for _, f := range p.Factors {
		if f.Key == "lineup" {
			t.Fatalf("lineup factor must be omitted when one side's K/D is unknown")
		}
	}
	bKD := mk([]bool{true, false, true, false}, 0, 0.9)
	q := buildPrediction(a, bKD, 0, 0)
	found := false
	for _, f := range q.Factors {
		if f.Key == "lineup" && f.Contribution > 0 {
			found = true
		}
	}
	if !found {
		t.Fatalf("lineup factor missing or not favoring the higher-K/D side")
	}
}
