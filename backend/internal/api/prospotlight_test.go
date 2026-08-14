package api

import (
	"testing"

	"github.com/cs2tracker/server/internal/grid"
)

func rows(names ...string) []grid.NamedTeam {
	out := make([]grid.NamedTeam, 0, len(names))
	for i, n := range names {
		out = append(out, grid.NamedTeam{GridID: string(rune('a' + i)), Name: n})
	}
	return out
}

func TestPickTeamExactAcrossSpellings(t *testing.T) {
	// The case this whole path exists for: Valve says "Spirit", GRID says
	// "Team Spirit", and GRID's substring filter also drags in the academy.
	got, ok := pickTeam("Spirit", rows("Spirit Academy", "Team Spirit", "Spirit Esports"))
	if !ok || got.Name != "Team Spirit" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	// And the reverse spelling.
	if got, ok := pickTeam("Team Vitality", rows("Vitality")); !ok || got.Name != "Vitality" {
		t.Errorf("reverse spelling: %+v ok=%v", got, ok)
	}
	// Suffix form.
	if got, ok := pickTeam("9z", rows("9z Team")); !ok || got.Name != "9z Team" {
		t.Errorf("suffix form: %+v ok=%v", got, ok)
	}
}

func TestPickTeamRejectsSecondarySides(t *testing.T) {
	for _, name := range []string{
		"Spirit Academy", "MOUZ NXT", "Falcons Junior", "Vitality fe",
		"Aurora Young Talents", "NAVI Youth",
	} {
		if got, ok := pickTeam("Spirit", rows(name)); ok {
			t.Errorf("%q should not match: %+v", name, got)
		}
	}
}

func TestPickTeamWholeWordPrefixOnly(t *testing.T) {
	// A run of letters is not a name: "FaZe" must not match "Fazendinha".
	if got, ok := pickTeam("FaZe", rows("Fazendinha")); ok {
		t.Errorf("letter-run match accepted: %+v", got)
	}
	// But a real extension of the org name is fine.
	if got, ok := pickTeam("FaZe", rows("FaZe Clan")); !ok || got.Name != "FaZe Clan" {
		t.Errorf("FaZe Clan: %+v ok=%v", got, ok)
	}
	// Shortest wins among several extensions.
	got, ok := pickTeam("Falcons", rows("Falcons Esports Club", "Falcons Esports"))
	if !ok || got.Name != "Falcons Esports" {
		t.Errorf("shortest extension: %+v ok=%v", got, ok)
	}
	// An exact hit beats any extension regardless of order.
	got, ok = pickTeam("Falcons", rows("Falcons Esports", "Team Falcons"))
	if !ok || got.Name != "Team Falcons" {
		t.Errorf("exact should win: %+v ok=%v", got, ok)
	}
}

func TestPickTeamRefusesWhenUnsure(t *testing.T) {
	// Nothing plausible: leave the card unclickable rather than guessing.
	if got, ok := pickTeam("G2", rows("MOUZ", "Natus Vincere")); ok {
		t.Errorf("unrelated org accepted: %+v", got)
	}
	if _, ok := pickTeam("Spirit", nil); ok {
		t.Error("empty candidate list accepted")
	}
	// A row with no id is not a link, however well the name matches.
	if _, ok := pickTeam("Spirit", []grid.NamedTeam{{Name: "Team Spirit"}}); ok {
		t.Error("id-less row accepted")
	}
}

func TestLookupTeamFindsEitherSpelling(t *testing.T) {
	index := map[string]knownTeam{"teamspirit": {id: "49586"}}
	// Valve's shorter spelling must find GRID's longer one.
	if got, _ := lookupTeam(index, nil, "Spirit"); got.id != "49586" {
		t.Errorf("short name missed the index: %+v", got)
	}
	// Live is checked under every key too.
	live := map[string]bool{"spirit": true}
	if _, isLive := lookupTeam(index, live, "Team Spirit"); !isLive {
		t.Error("live flag missed under the alternate key")
	}
	// An org we genuinely have no id for stays empty.
	if got, _ := lookupTeam(index, nil, "Aurora"); got.id != "" {
		t.Errorf("unknown org resolved to %+v", got)
	}
}

func TestSpacedName(t *testing.T) {
	for in, want := range map[string]string{
		"Team  Spirit":  "team spirit",
		"FaZe Clan":     "faze clan",
		"Natus-Vincere": "natus vincere",
		"9z Team":       "9z team",
		"  MOUZ  ":      "mouz",
	} {
		if got := spacedName(in); got != want {
			t.Errorf("spacedName(%q) = %q, want %q", in, got, want)
		}
	}
}
