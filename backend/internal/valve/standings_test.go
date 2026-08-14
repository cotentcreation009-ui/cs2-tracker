package valve

import (
	"strings"
	"testing"
)

// A verbatim slice of live/2026/standings_global_2026_08_03.md, including the
// header and separator rows the parser must ignore.
const sample = `### Standings as of 2026_08_03<br />
<br />

| Standing | Points | Team Name            | Roster                                                |                                                                    |
| :- | -: | :- | :- | :- |
| 1        |   2011 | Spirit               | donk, magixx, sh1ro, tN1R, zont1x                     | [details](details/2026_08_03/0001--spirit.md)                      |
| 2        |   1950 | Falcons              | karrigan, kyousuke, m0NESY, NiKo, TeSeS               | [details](details/2026_08_03/0002--falcons.md)                     |
| 3        |   1873 | MOUZ                 | PR, Spinx, torzsi, xelex, xertioN                     | [details](details/2026_08_03/0003--mouz.md)                        |
| 11       |   1,688 | G2                  | HeavyGod, huNter-, MATYS, NertZ, SunPayus             | [details](details/2026_08_03/0011--g2.md)                          |
`

func TestParseStandings(t *testing.T) {
	teams := parseStandings(sample, "2026-08-03")
	if len(teams) != 4 {
		t.Fatalf("want 4 rows, got %d", len(teams))
	}
	if teams[0].Name != "Spirit" || teams[0].Standing != 1 || teams[0].Points != 2011 {
		t.Errorf("row 1 = %+v", teams[0])
	}
	if teams[0].AsOf != "2026-08-03" {
		t.Errorf("asOf = %q", teams[0].AsOf)
	}
	if len(teams[0].Roster) != 5 || teams[0].Roster[0] != "donk" || teams[0].Roster[4] != "zont1x" {
		t.Errorf("roster = %v", teams[0].Roster)
	}
	// The header row says "Standing | Points | Team Name" and must not survive.
	for _, tm := range teams {
		if strings.EqualFold(tm.Name, "Team Name") {
			t.Fatal("header row parsed as a team")
		}
	}
	// Points are printed with a thousands separator further down the table.
	if teams[3].Points != 1688 || teams[3].Standing != 11 {
		t.Errorf("comma-separated points row = %+v", teams[3])
	}
	// A roster entry ending in "-" is a real nickname (huNter-), not an empty
	// cell to be trimmed away.
	if len(teams[3].Roster) != 5 || teams[3].Roster[1] != "huNter-" {
		t.Errorf("roster with trailing dash = %v", teams[3].Roster)
	}
}

func TestParseStandingsIgnoresJunk(t *testing.T) {
	if got := parseStandings("no table here\njust prose\n", ""); len(got) != 0 {
		t.Fatalf("want none, got %d", len(got))
	}
	// A table whose first column is not a number is not a standings table.
	other := "| Map | Wins |\n| :- | -: |\n| Mirage | 12 |\n"
	if got := parseStandings(other, ""); len(got) != 0 {
		t.Fatalf("unrelated table parsed as standings: %+v", got)
	}
}

func TestParseStandingsOrdersByStanding(t *testing.T) {
	shuffled := "| 3 | 10 | C | x |\n| 1 | 30 | A | y |\n| 2 | 20 | B | z |\n"
	teams := parseStandings(shuffled, "")
	if len(teams) != 3 || teams[0].Name != "A" || teams[2].Name != "C" {
		t.Fatalf("not ordered by standing: %+v", teams)
	}
}

func TestFileNameHelpers(t *testing.T) {
	const n = "standings_global_2026_08_03.md"
	if got := yearFromName(n); got != "2026" {
		t.Errorf("yearFromName = %q", got)
	}
	if got := asOfFromName(n); got != "2026-08-03" {
		t.Errorf("asOfFromName = %q", got)
	}
	// A name we do not recognise must not produce a nonsense path segment.
	if got := yearFromName("weird.md"); len(got) != 4 {
		t.Errorf("fallback year = %q", got)
	}
}

func TestNormalizeName(t *testing.T) {
	// The whole point: two providers spelling one org differently must collide.
	pairs := [][2]string{
		{"Natus Vincere", "natus-vincere"},
		{"MOUZ", "mouz"},
		{"The MongolZ", "the mongolz"},
		{"FaZe", "FAZE"},
		{"Team Spirit", "TeamSpirit"},
	}
	for _, p := range pairs {
		if NormalizeName(p[0]) != NormalizeName(p[1]) {
			t.Errorf("%q and %q should normalize alike (%q vs %q)",
				p[0], p[1], NormalizeName(p[0]), NormalizeName(p[1]))
		}
	}
	// ...and genuinely different orgs must not.
	if NormalizeName("Spirit") == NormalizeName("Aurora") {
		t.Error("distinct orgs collided")
	}
}

func TestNameKeys(t *testing.T) {
	// The whole point: Valve's spelling and GRID's spelling must share a key.
	pairs := [][2]string{
		{"Spirit", "Team Spirit"},
		{"Vitality", "Team Vitality"},
		{"Falcons", "Team Falcons"},
		{"9z", "9z Team"},
		{"Liquid", "Team Liquid"},
	}
	for _, p := range pairs {
		if !keysOverlap(NameKeys(p[0]), NameKeys(p[1])) {
			t.Errorf("%q and %q share no key: %v vs %v",
				p[0], p[1], NameKeys(p[0]), NameKeys(p[1]))
		}
	}
	// The exact spelling still comes first, so an exact hit beats a loose one.
	if got := NameKeys("Team Spirit"); got[0] != "teamspirit" {
		t.Errorf("exact key should lead: %v", got)
	}
	// The org's own spelling always leads; the "Team X" form is only ever an
	// extra key so the two sources can meet whichever was indexed first.
	if got := NameKeys("MOUZ"); got[0] != "mouz" {
		t.Errorf("MOUZ = %v", got)
	}
	// Distinct orgs must still not collide.
	if keysOverlap(NameKeys("Spirit"), NameKeys("Aurora")) {
		t.Error("distinct orgs collided")
	}
	// Nothing sensible to key on.
	if got := NameKeys("  "); got != nil {
		t.Errorf("blank name = %v", got)
	}
	// "Team" alone leaves nothing identifying behind — don't strip to "".
	if got := NameKeys("Team"); got[0] != "team" || len(got) > 2 {
		t.Errorf("bare Team = %v", got)
	}
	// A key must never be the bare word, or every org would collide on it.
	for _, n := range []string{"Spirit", "Team Spirit", "9z Team", "MOUZ"} {
		for _, k := range NameKeys(n) {
			if k == "" {
				t.Errorf("%q produced an empty key: %v", n, NameKeys(n))
			}
		}
	}
}

func keysOverlap(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if x == y {
				return true
			}
		}
	}
	return false
}
