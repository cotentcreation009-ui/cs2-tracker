package grid

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestLiveFetchSeriesDetail(t *testing.T) {
	key := os.Getenv("GRID_API_KEY")
	if key == "" {
		t.Skip("no GRID_API_KEY")
	}
	cl := NewClient("", key, nil, nil)
	ms, err := cl.FetchSeriesDetail(context.Background(), "2926823")
	if err != nil {
		t.Fatal(err)
	}
	if ms == nil {
		t.Fatal("nil MatchState for known historical series")
	}
	b, _ := json.Marshal(ms)
	s := string(b)
	if len(s) > 1200 {
		s = s[:1200]
	}
	t.Log(s)
	if ms.Status != "finished" {
		t.Fatalf("want finished, got %s", ms.Status)
	}
	un, err := cl.FetchSeriesDetail(context.Background(), "999999999")
	if err != nil {
		t.Logf("unknown id err (ok if graceful): %v", err)
	}
	if un != nil {
		t.Fatalf("expected nil for unknown id, got %+v", un.SeriesID)
	}
}
