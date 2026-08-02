package liquipedia

import "testing"

const sampleWikitext = `{{DISPLAYTITLE:s0mple}}
{{Infobox player
|id=s0mple
|image=S0mple at IEM Cologne 2026.jpg
|name=Oleksandr Kostyliev
|romanized_name=
|country=Ukraine
|birth_date={{birth date and age|1997|10|2}}
|status=Active
|years_active=2013 &ndash; present
|team=[[Team Alpha]]
|role=AWPer
|earnings=1738000
}}
'''s0mple''' is a Ukrainian professional player.
==Gear==
{{Infobox gear|mouse=...}}
`

func TestParsePlayerInfobox(t *testing.T) {
	info := parsePlayerInfobox(sampleWikitext)
	if !info.Found {
		t.Fatal("expected Found")
	}
	if info.Name != "Oleksandr Kostyliev" {
		t.Errorf("name = %q", info.Name)
	}
	if info.Country != "Ukraine" || info.CountryCode != "UA" {
		t.Errorf("country = %q code = %q", info.Country, info.CountryCode)
	}
	if info.Role != "AWPer" {
		t.Errorf("role = %q", info.Role)
	}
	if info.BirthDate != "1997-10-02" {
		t.Errorf("birthDate = %q", info.BirthDate)
	}
	if info.Team != "Team Alpha" {
		t.Errorf("team = %q", info.Team)
	}
}

func TestParsePlayerInfoboxMissing(t *testing.T) {
	if info := parsePlayerInfobox("just an article with no infobox"); info.Found {
		t.Error("expected not found")
	}
}

func TestPrettyRole(t *testing.T) {
	cases := map[string]string{"awp": "AWPer", "igl": "IGL", "In-game leader": "IGL", "rifler": "Rifler", "": ""}
	for in, want := range cases {
		if got := prettyRole(in); got != want {
			t.Errorf("prettyRole(%q) = %q, want %q", in, got, want)
		}
	}
}
