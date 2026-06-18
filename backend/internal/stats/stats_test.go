package stats

import (
	"math"
	"testing"

	"github.com/cs2tracker/server/internal/models"
)

func approx(a, b float64) bool { return math.Abs(a-b) < 0.02 }

func TestFillMatchPlayerDerived(t *testing.T) {
	mp := &models.MatchPlayer{
		Kills: 20, Deaths: 15, Assists: 4,
		HeadshotKills: 10, Damage: 1920, RoundsPlayed: 24,
		KASTRounds: 18,
		K1:         10, K2: 3, K3: 1,
	}
	FillMatchPlayerDerived(mp)

	if !approx(mp.ADR, 80) { // 1920/24
		t.Errorf("ADR = %v, want ~80", mp.ADR)
	}
	if !approx(mp.HSPct, 50) { // 10/20
		t.Errorf("HSPct = %v, want ~50", mp.HSPct)
	}
	if !approx(mp.KD, 1.33) { // 20/15
		t.Errorf("KD = %v, want ~1.33", mp.KD)
	}
	if !approx(mp.KASTPct, 75) { // 18/24
		t.Errorf("KASTPct = %v, want ~75", mp.KASTPct)
	}
	if !approx(mp.Rating, 1.14) {
		t.Errorf("Rating = %v, want ~1.14", mp.Rating)
	}
}

func TestRating1ZeroRounds(t *testing.T) {
	if r := Rating1(0, 0, 0, 0, 0, 0, 0, 0); r != 0 {
		t.Errorf("rating with 0 rounds = %v, want 0", r)
	}
}

func TestClassifyBuy(t *testing.T) {
	cases := []struct {
		equip  int
		pistol bool
		want   string
	}{
		{800, true, "pistol"},
		{25000, true, "pistol"}, // pistol overrides value
		{22000, false, "full"},
		{17000, false, "full"},
		{16999, false, "force"},
		{5000, false, "force"},
		{4999, false, "eco"},
		{0, false, "eco"},
	}
	for _, c := range cases {
		if got := ClassifyBuy(c.equip, c.pistol); got != c.want {
			t.Errorf("ClassifyBuy(%d, %v) = %q, want %q", c.equip, c.pistol, got, c.want)
		}
	}
}

func TestFillCareerDerivedNoDivByZero(t *testing.T) {
	c := &models.PlayerCareer{} // all zero
	FillCareerDerived(c)
	if c.Rating != 0 || c.ADR != 0 || c.WinRate != 0 || c.KD != 0 {
		t.Errorf("empty career should produce zeros, got %+v", c)
	}
}
