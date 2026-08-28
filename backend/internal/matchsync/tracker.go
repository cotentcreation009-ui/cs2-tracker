package matchsync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/time/rate"
)

// TrackerSource reads a player's match history from tracker.gg and takes the
// share codes out of it.
//
// It exists because the game coordinator only answers for accounts whose Steam
// game details are public, and stays silent — not erroring, silent — for the
// rest. A player whose privacy is set that way, or whose account the GC simply
// will not answer for, otherwise has no route into the pipeline at all. This
// one works regardless of their privacy settings, because the history is
// assembled from the other people who were in those lobbies.
//
// Two honest limitations, both measured:
//
//   - It is thin for players outside tracker's own network. The account this
//     was built for has 18 matches here where another aggregator has 714.
//   - It lags. That same account's newest match here was seven weeks old while
//     the player had played since.
//
// So this is the fallback, not the front door: it fills history the GC cannot
// reach, and the GC supplies recency this cannot.
//
// The endpoint is undocumented and needs no key. That means it can be gated or
// withdrawn without notice, which is why a failure here is just "no codes from
// this source" and never an error that stops a sync.
type TrackerSource struct {
	// BaseURL defaults to tracker.gg's public host; overridden in tests.
	BaseURL string
	HTTP    *http.Client
}

// trackerLimiter keeps us to a polite trickle. This is somebody else's server,
// answering for free, with no agreement in place — the budget should look like
// a person browsing, not a crawler.
var trackerLimiter = rate.NewLimiter(rate.Every(3*time.Second), 1)

func (t TrackerSource) base() string {
	if t.BaseURL != "" {
		return t.BaseURL
	}
	return "https://public-api.tracker.gg"
}

func (t TrackerSource) client() *http.Client {
	if t.HTTP != nil {
		return t.HTTP
	}
	return &http.Client{Timeout: 12 * time.Second}
}

// ShareCodes returns the share codes tracker.gg holds for a player, newest
// first. An empty result is the normal answer for a player it has never seen.
func (t TrackerSource) ShareCodes(ctx context.Context, steamID uint64) ([]string, error) {
	if err := trackerLimiter.Wait(ctx); err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v2/cs2/standard/matches/steam/%s",
		t.base(), strconv.FormatUint(steamID, 10))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	// Say who we are. An undocumented endpoint used without an agreement should
	// at least be attributable, so the operator can find us if they object.
	req.Header.Set("User-Agent", "csrun/1.0 (+https://csrun.win)")
	req.Header.Set("Accept", "application/json")

	resp, err := t.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("tracker: request failed: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, nil // no history for this player: a normal answer
	default:
		return nil, fmt.Errorf("tracker: unexpected status %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			Matches []struct {
				Metadata struct {
					ShareCode string `json:"shareCode"`
					Timestamp string `json:"timestamp"`
				} `json:"metadata"`
			} `json:"matches"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("tracker: decode: %w", err)
	}

	out := make([]string, 0, len(body.Data.Matches))
	for _, m := range body.Data.Matches {
		if c := m.Metadata.ShareCode; c != "" {
			out = append(out, c)
		}
	}
	return out, nil
}
