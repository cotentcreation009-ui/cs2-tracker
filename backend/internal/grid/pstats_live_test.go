package grid

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestLivePlayerStatsExtended(t *testing.T) {
	key := os.Getenv("GRID_API_KEY")
	if key == "" {
		t.Skip("no GRID_API_KEY")
	}
	cl := NewClient("", key, nil, nil)
	// b1t's GRID player id resolved earlier sessions via roster; use a roster fetch of NAVI? Use known id via env
	pid := os.Getenv("GRID_TEST_PID")
	if pid == "" {
		t.Skip("no GRID_TEST_PID")
	}
	st, err := cl.PlayerCareerStats(context.Background(), pid, "LAST_3_MONTHS")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(st)
	t.Log(string(b))
	if st != nil && st.Rounds == 0 {
		t.Log("warning: no round segment data")
	}
}
