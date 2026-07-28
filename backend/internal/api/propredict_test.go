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
	p := buildPrediction(a, b, 0, 0, nil)
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
	p := buildPrediction(hot, cold, 0, 0, nil)
	if p.PA < 0.85 {
		t.Fatalf("8-0 vs 0-8 with margins should be decisive, got %.3f", p.PA)
	}
	// and symmetric the other way
	q := buildPrediction(cold, hot, 0, 0, nil)
	if math.Abs(p.PA+q.PA-1) > 1e-9 {
		t.Fatalf("prediction not symmetric: %.3f vs %.3f", p.PA, q.PA)
	}
}

func TestPredictionThinDataRefuses(t *testing.T) {
	a := mk([]bool{true, true}, 1, 0)
	b := mk([]bool{false, false, false, false}, 0, 0)
	p := buildPrediction(a, b, 0, 0, nil)
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
	one := buildPrediction(a, b, 1, 0, nil)
	three := buildPrediction(a, b, 3, 0, nil)
	if !(three.PA > one.PA) {
		t.Fatalf("3-0 head-to-head should count more than 1-0: %.3f vs %.3f", three.PA, one.PA)
	}
	// a lone h2h win must not read as decisive on otherwise even teams
	if one.PA > 0.60 {
		t.Fatalf("single meeting over-weighted: %.3f", one.PA)
	}
}

func TestMapPoolFactorSharedMapsOnly(t *testing.T) {
	a := map[string]recWL{"inferno": {W: 4, L: 1}, "mirage": {W: 2, L: 2}, "nuke": {W: 1, L: 0}}
	b := map[string]recWL{"inferno": {W: 1, L: 3}, "mirage": {W: 2, L: 2}, "ancient": {W: 3, L: 0}}
	f := mapPoolFactor(a, b, nil)
	if f == nil {
		t.Fatalf("two shared >=2-play maps must produce the factor")
	}
	if f.Contribution <= 0 {
		t.Fatalf("team A dominates inferno and ties mirage — factor must favor A, got %.3f", f.Contribution)
	}
	// nuke (A played once) and ancient (B only) must not count
	if f.A <= f.B == (f.Contribution > 0) {
		t.Fatalf("pooled win rates inconsistent with contribution: A=%.2f B=%.2f", f.A, f.B)
	}
}

func TestMapPoolFactorRefusesThinOverlap(t *testing.T) {
	// only ONE shared >=2-play map and no known picks → nil
	a := map[string]recWL{"inferno": {W: 4, L: 1}, "nuke": {W: 1, L: 0}}
	b := map[string]recWL{"inferno": {W: 1, L: 3}, "ancient": {W: 3, L: 0}}
	if f := mapPoolFactor(a, b, nil); f != nil {
		t.Fatalf("one shared map without picks must not produce a factor")
	}
	// …but the SAME overlap is enough when it IS the picked map
	f := mapPoolFactor(a, b, []string{"inferno"})
	if f == nil || f.Contribution <= 0 {
		t.Fatalf("picked-map comparison should exist and favor A")
	}
}

func TestMapPoolFactorPickedRestricts(t *testing.T) {
	// A is great on inferno, terrible on the picked map — picks must flip it
	a := map[string]recWL{"inferno": {W: 5, L: 0}, "mirage": {W: 0, L: 4}}
	b := map[string]recWL{"inferno": {W: 2, L: 2}, "mirage": {W: 4, L: 1}}
	all := mapPoolFactor(a, b, nil)
	picked := mapPoolFactor(a, b, []string{"mirage"})
	if all == nil || picked == nil {
		t.Fatalf("both comparisons should exist")
	}
	if !(picked.Contribution < 0) {
		t.Fatalf("on the picked mirage, B must be favored, got %.3f", picked.Contribution)
	}
	if !(picked.Contribution < all.Contribution) {
		t.Fatalf("restricting to B's map must move the factor toward B")
	}
}

func TestPredictionKDFactorOnlyWhenBothKnown(t *testing.T) {
	a := mk([]bool{true, false, true, false}, 0, 1.1)
	bNoKD := mk([]bool{true, false, true, false}, 0, 0)
	p := buildPrediction(a, bNoKD, 0, 0, nil)
	for _, f := range p.Factors {
		if f.Key == "lineup" {
			t.Fatalf("lineup factor must be omitted when one side's K/D is unknown")
		}
	}
	bKD := mk([]bool{true, false, true, false}, 0, 0.9)
	q := buildPrediction(a, bKD, 0, 0, nil)
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
