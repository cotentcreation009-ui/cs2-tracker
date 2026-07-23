package liquipedia

import (
	"context"
	"os"
	"testing"
)

func TestLivePlayerPhoto(t *testing.T) {
	if os.Getenv("LP_LIVE") == "" {
		t.Skip("set LP_LIVE=1 to hit liquipedia.net")
	}
	c := NewClient(nil)
	p, err := c.PlayerPhoto(context.Background(), "b1t")
	if err != nil {
		t.Fatal(err)
	}
	if p == nil || len(p.Data) < 1000 {
		t.Fatalf("expected a photo, got %+v", p)
	}
	t.Logf("mime=%s bytes=%d", p.Mime, len(p.Data))
	none, err := c.PlayerPhoto(context.Background(), "zzz-no-such-player-xq")
	if err != nil {
		t.Fatal(err)
	}
	if none != nil {
		t.Fatalf("expected nil for unknown nick")
	}
}
