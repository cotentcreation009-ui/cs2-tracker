package parser

import (
	"os"
	"sort"
	"testing"
)

// Live check against a real demo, opt-in via DEMO_PATH — the aggregator's
// numbers must be sane on real play, not just on fixtures.
func TestSummariseLive(t *testing.T) {
	path := os.Getenv("DEMO_PATH")
	if path == "" {
		t.Skip("set DEMO_PATH to run")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	m, err := ParseReplay(f)
	if err != nil {
		t.Fatal(err)
	}
	sums := SummarisePlayers(m)
	sort.Slice(sums, func(i, j int) bool { return sums[i].AimRating > sums[j].AimRating })
	t.Logf("%-22s %4s %4s %6s %6s %6s %7s %5s %6s %5s %s", "player", "K", "D", "acc", "hs%", "open%", "preaim", "snap", "ADR", "AIM", "rank")
	for _, s := range sums {
		rank := "—"
		if s.RankNew > 0 {
			rank = "" + itoa(s.RankNew) + sign(s.RankChange)
		}
		t.Logf("%-22.22s %4d %4d %5.1f%% %5.1f%% %5.1f%% %6.2fd %5d %6.1f %5.1f %s",
			s.Name, s.Kills, s.Deaths, 100*s.Accuracy(), 100*s.HeadshotPct(),
			100*s.OpeningWinPct(), s.Preaim, s.SnapKills, s.ADR(), s.AimRating, rank)
	}
	if len(sums) < 10 {
		t.Errorf("only %d players summarised", len(sums))
	}
	var ranked, withAim int
	for _, s := range sums {
		if s.RankNew > 0 {
			ranked++
		}
		if s.AimRating > 0 {
			withAim++
		}
	}
	if ranked == 0 {
		t.Error("no player carried a Premier rating")
	}
	if withAim < 10 {
		t.Errorf("%d players scored an aim rating, want all 10", withAim)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}

func sign(n int) string {
	if n > 0 {
		return " (+" + itoa(n) + ")"
	}
	if n < 0 {
		return " (" + itoa(n) + ")"
	}
	return ""
}
