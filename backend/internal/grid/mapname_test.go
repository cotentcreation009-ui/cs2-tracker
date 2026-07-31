package grid

import "testing"

// GRID sometimes reports a game's map as a "Default-Map"/"TBA" placeholder
// (map never recorded). Those must normalize to "" so they never appear in
// map records or the prediction's map-pool factor — a real user saw
// "Default-Map 1-0" listed as a map on a team comparison.
func TestNormMapNamePlaceholders(t *testing.T) {
	cases := map[string]string{
		"de_mirage":       "mirage",
		"Mirage":          "mirage",
		"default-ancient": "ancient", // event quirk, real map — keep
		"Default-Map":     "",
		"default":         "",
		"TBA":             "",
		"tbd":             "",
		"Unknown":         "",
		"":                "",
	}
	for in, want := range cases {
		if got := NormMapName(in); got != want {
			t.Errorf("NormMapName(%q) = %q, want %q", in, got, want)
		}
	}
}

// The map-pool filter: current active duty in, rotated-out maps out.
// 2026-07 rotation: Cache replaced Overpass.
func TestActiveDuty(t *testing.T) {
	for _, m := range []string{"ancient", "anubis", "cache", "dust2", "inferno", "mirage", "nuke", "train"} {
		if !ActiveDuty(m) {
			t.Errorf("ActiveDuty(%q) = false, want true", m)
		}
	}
	for _, m := range []string{"overpass", "vertigo", "cbble", ""} {
		if ActiveDuty(m) {
			t.Errorf("ActiveDuty(%q) = true, want false", m)
		}
	}
}

func TestPrettyMapPlaceholders(t *testing.T) {
	cases := map[string]string{
		"de_dust2":        "Dust2",
		"default-inferno": "Inferno",
		"Default-Map":     "", // blank → UI falls back to "TBD"
		"tba":             "",
		"":                "",
	}
	for in, want := range cases {
		if got := prettyMap(in); got != want {
			t.Errorf("prettyMap(%q) = %q, want %q", in, got, want)
		}
	}
}
