package faceit

import (
	"encoding/json"
	"testing"
)

// The JSON KEYS are a contract with the frontend, which reads them by name off
// the public cheatmeter payload. They have already broken once: this struct
// started untagged, so Go emitted "ADR"/"KR"/"Matches"; adding tags renamed
// every key to lower case and the frontend — still reading the capitalised
// names — silently rendered four blank columns with no error anywhere, because
// a TypeScript interface written to match the wrong usage type-checks fine.
//
// If a key here changes, frontend/lib/types.ts FaceitRecentStats and the public
// cheatmeter route must change with it.
func TestRecentStatsWireFormat(t *testing.T) {
	b, err := json.Marshal(RecentStats{Matches: 5, ADR: 80.5})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		"matches", "kills", "deaths", "assists",
		"kd", "kr", "adr", "hsPct", "winRatePct", "rating",
	} {
		if _, ok := got[key]; !ok {
			t.Errorf("missing key %q — the frontend reads this by name; got %v", key, got)
		}
	}
	if len(got) != 10 {
		t.Errorf("got %d keys, want 10 — a new field needs adding to the frontend type too: %v", len(got), got)
	}
}
