package valve

import (
	"context"
	"os"
	"testing"
	"time"
)

// Hits the real repository. Skipped unless VALVE_LIVE=1 so CI stays offline.
func TestLiveTopTeams(t *testing.T) {
	if os.Getenv("VALVE_LIVE") != "1" {
		t.Skip("set VALVE_LIVE=1 to hit GitHub")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	teams, err := NewClient(nil).TopTeams(ctx, 20)
	if err != nil {
		t.Fatalf("TopTeams: %v", err)
	}
	if len(teams) != 20 {
		t.Fatalf("want 20, got %d", len(teams))
	}
	for i, tm := range teams {
		if tm.Standing != i+1 || tm.Name == "" || tm.Points <= 0 {
			t.Fatalf("row %d malformed: %+v", i, tm)
		}
	}
	t.Logf("as of %s", teams[0].AsOf)
	for _, tm := range teams[:5] {
		t.Logf("#%d %-16s %5d pts  %v", tm.Standing, tm.Name, tm.Points, tm.Roster)
	}
}
