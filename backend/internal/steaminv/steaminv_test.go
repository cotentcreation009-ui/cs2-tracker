package steaminv

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/andybalholm/brotli"
)

// reqCount counts inventory reads that actually reached the fixture server.
var reqCount atomic.Int64

const invFixture = `{
  "assets": [
    {"classid": "c1", "instanceid": "i1"},
    {"classid": "c1", "instanceid": "i1"},
    {"classid": "c1", "instanceid": "i1"},
    {"classid": "c2", "instanceid": "i0"},
    {"classid": "c3", "instanceid": "i0"}
  ],
  "descriptions": [
    {"classid": "c1", "instanceid": "i1", "icon_url": "case-icon", "name": "Dreams & Nightmares Case",
     "market_hash_name": "Dreams & Nightmares Case", "type": "Base Grade Container", "tradable": 1, "marketable": 1,
     "tags": [{"category": "Type", "localized_tag_name": "Container"}, {"category": "Rarity", "localized_tag_name": "Base Grade", "color": "b0c3d9"}]},
    {"classid": "c2", "instanceid": "i0", "icon_url": "ak-icon", "name": "StatTrak™ AK-47 | Redline (Field-Tested)",
     "market_hash_name": "StatTrak™ AK-47 | Redline (Field-Tested)", "type": "Classified Rifle", "tradable": 1, "marketable": 1,
     "tags": [{"category": "Type", "localized_tag_name": "Rifle"}, {"category": "Rarity", "localized_tag_name": "Classified", "color": "d32ce6"}, {"category": "Exterior", "localized_tag_name": "Field-Tested"}]},
    {"classid": "c3", "instanceid": "i0", "icon_url": "sticker-icon", "name": "Sticker | Hello AWP",
     "market_hash_name": "Sticker | Hello AWP", "type": "High Grade Sticker", "tradable": 0, "marketable": 0,
     "tags": [{"category": "Type", "localized_tag_name": "Sticker"}, {"category": "Rarity", "localized_tag_name": "High Grade", "color": "4b69ff"}]}
  ],
  "total_inventory_count": 5,
  "success": 1
}`

const pricesFixture = `[
  {"market_hash_name": "Dreams & Nightmares Case", "suggested_price": 1.50, "min_price": 1.20},
  {"market_hash_name": "StatTrak™ AK-47 | Redline (Field-Tested)", "suggested_price": 45.00, "min_price": 41.00},
  {"market_hash_name": "Unrelated Item", "suggested_price": 9.99}
]`

func fixtureServers(t *testing.T, invBody string, invStatus int) *http.Client {
	t.Helper()
	return fixtureHandler(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(invStatus)
		_, _ = w.Write([]byte(invBody))
	})
}

// fixtureHandler stands up a Steam+Skinport double, letting the caller drive
// the inventory responses (for paging, error sequences and the like).
func fixtureHandler(t *testing.T, inv http.HandlerFunc) *http.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/inventory/") {
			reqCount.Add(1)
			inv(w, r)
			return
		}
		// Skinport rejects any client that doesn't offer Brotli and only ever
		// answers in it — emulate that exactly, so a client that stops asking
		// for br fails here the way it fails in production.
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "br") {
			w.WriteHeader(http.StatusNotAcceptable)
			_, _ = w.Write([]byte(`{"errors":[{"id":"not_acceptable","message":"Client must support Brotli compression (Accept-Encoding: br)."}]}`))
			return
		}
		w.Header().Set("Content-Encoding", "br")
		bw := brotli.NewWriter(w)
		_, _ = bw.Write([]byte(pricesFixture))
		_ = bw.Close()
	}))
	t.Cleanup(srv.Close)
	prevInv, prevSp := inventoryURL, skinportURL
	inventoryURL = srv.URL + "/inventory/%d/730/2"
	skinportURL = srv.URL + "/skinport"
	t.Cleanup(func() { inventoryURL, skinportURL = prevInv, prevSp })
	// reset the price cache between tests
	priceMu.Lock()
	priceMap, priceAt = nil, time.Time{}
	priceMu.Unlock()
	// The throttle guards Steam's per-IP budget; a fixture server has none, so
	// tests read back-to-back with a clean gate.
	prevSpacing := minSpacing
	minSpacing = 0
	steamGate.clear()
	steamGate.mu.Lock()
	steamGate.next = time.Time{}
	steamGate.mu.Unlock()
	t.Cleanup(func() { minSpacing = prevSpacing })
	return srv.Client()
}

func TestBuildAggregates(t *testing.T) {
	hc := fixtureServers(t, invFixture, http.StatusOK)
	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if v.Private {
		t.Fatal("not private")
	}
	if v.ItemCount != 5 || v.DistinctCount != 3 {
		t.Fatalf("counts: items=%d distinct=%d", v.ItemCount, v.DistinctCount)
	}
	// 3 cases × 1.50 + 1 AK × 45.00 = 49.50; sticker unpriced
	if v.TotalValue < 49.49 || v.TotalValue > 49.51 {
		t.Fatalf("total = %.2f, want 49.50", v.TotalValue)
	}
	if v.PricedItems != 4 || v.MarketableCount != 4 {
		t.Fatalf("priced=%d marketable=%d", v.PricedItems, v.MarketableCount)
	}
	// top item by stack value: the AK (45.00) over the case stack (4.50)
	if len(v.TopItems) == 0 || !strings.Contains(v.TopItems[0].Name, "AK-47") {
		t.Fatalf("top item wrong: %+v", v.TopItems)
	}
	if !v.TopItems[0].StatTrak || v.TopItems[0].Exterior != "Field-Tested" || v.TopItems[0].RarityColor != "#d32ce6" {
		t.Fatalf("AK flags wrong: %+v", v.TopItems[0])
	}
	if len(v.Categories) != 3 || v.Categories[0].Name != "Rifle" {
		t.Fatalf("categories: %+v", v.Categories)
	}
	if len(v.Rarities) != 3 {
		t.Fatalf("rarities: %+v", v.Rarities)
	}
}

func TestBuildPrivateInventory(t *testing.T) {
	hc := fixtureServers(t, `{"success": false}`, http.StatusForbidden)
	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if !v.Private {
		t.Fatal("expected private flag")
	}
}

// Steam describes one market item more than once when the copies differ in
// ways it tracks and we don't (stickers, a name tag, a trade hold). Those are
// the same tradeable good at the same price, so they must land in one entry —
// otherwise the grid shows the same skin twice and the distinct count lies.
func TestBuildMergesDuplicateMarketNames(t *testing.T) {
	const body = `{"assets":[
	   {"classid":"c1","instanceid":"i1"},{"classid":"c1","instanceid":"i1"},
	   {"classid":"c1","instanceid":"i2"}],
	 "descriptions":[
	   {"classid":"c1","instanceid":"i1","name":"Tec-9 | Urban DDPAT (Field-Tested)",
	    "market_hash_name":"Tec-9 | Urban DDPAT (Field-Tested)","type":"Pistol","marketable":1,
	    "tags":[{"category":"Type","localized_tag_name":"Pistol"}]},
	   {"classid":"c1","instanceid":"i2","name":"Tec-9 | Urban DDPAT (Field-Tested)",
	    "market_hash_name":"Tec-9 | Urban DDPAT (Field-Tested)","type":"Pistol","marketable":1,
	    "tags":[{"category":"Type","localized_tag_name":"Pistol"}]}],
	 "total_inventory_count":3,"success":1}`

	hc := fixtureServers(t, body, http.StatusOK)
	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.TopItems) != 1 {
		t.Fatalf("got %d entries, want the two descriptions merged into 1: %+v", len(v.TopItems), v.TopItems)
	}
	if v.TopItems[0].Count != 3 {
		t.Errorf("count = %d, want all 3 assets on the merged entry", v.TopItems[0].Count)
	}
	if v.DistinctCount != 1 {
		t.Errorf("distinct = %d, want 1 — it counts market items, not descriptions", v.DistinctCount)
	}
	if v.ItemCount != 3 {
		t.Errorf("item_count = %d, want 3 assets owned", v.ItemCount)
	}
}

// Steam clamps a page at 2000 items and hands back a cursor for the rest. A
// collector's inventory is exactly the case this panel exists for, so stopping
// at page one would understate the people most likely to look.
func TestBuildFollowsPagination(t *testing.T) {
	// page 1: two cases, more to come. page 2: the AK, repeating the case
	// description (Steam does) to prove it isn't counted twice.
	const page1 = `{"assets":[{"classid":"c1","instanceid":"i1"},{"classid":"c1","instanceid":"i1"}],
	  "descriptions":[{"classid":"c1","instanceid":"i1","name":"Dreams & Nightmares Case",
	    "market_hash_name":"Dreams & Nightmares Case","type":"Base Grade Container","marketable":1,
	    "tags":[{"category":"Type","localized_tag_name":"Container"}]}],
	  "total_inventory_count":3,"success":1,"more_items":1,"last_assetid":"A99"}`
	const page2 = `{"assets":[{"classid":"c2","instanceid":"i0"}],
	  "descriptions":[{"classid":"c1","instanceid":"i1","name":"Dreams & Nightmares Case",
	    "market_hash_name":"Dreams & Nightmares Case","type":"Base Grade Container","marketable":1,
	    "tags":[{"category":"Type","localized_tag_name":"Container"}]},
	   {"classid":"c2","instanceid":"i0","name":"StatTrak™ AK-47 | Redline (Field-Tested)",
	    "market_hash_name":"StatTrak™ AK-47 | Redline (Field-Tested)","type":"Classified Rifle","marketable":1,
	    "tags":[{"category":"Type","localized_tag_name":"Rifle"}]}],
	  "total_inventory_count":3,"success":1}`

	var cursors []string
	hc := fixtureHandler(t, func(w http.ResponseWriter, r *http.Request) {
		cursors = append(cursors, r.URL.Query().Get("start_assetid"))
		if r.URL.Query().Get("start_assetid") == "" {
			_, _ = w.Write([]byte(page1))
			return
		}
		_, _ = w.Write([]byte(page2))
	})

	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if len(cursors) != 2 || cursors[0] != "" || cursors[1] != "A99" {
		t.Fatalf("cursors = %q, want [\"\", \"A99\"]", cursors)
	}
	if v.ItemCount != 3 {
		t.Errorf("item_count = %d, want 3 across both pages", v.ItemCount)
	}
	if v.DistinctCount != 2 {
		t.Errorf("distinct = %d, want 2 — the repeated description was counted twice", v.DistinctCount)
	}
	// 2 cases × 1.50 + 1 AK × 45.00
	if v.TotalValue < 47.99 || v.TotalValue > 48.01 {
		t.Errorf("total = %.2f, want 48.00", v.TotalValue)
	}
	if v.Truncated {
		t.Error("a fully-read inventory must not be flagged truncated")
	}
}

// A 429 must report itself as a rate limit (so callers serve a snapshot rather
// than an error) and stop further reads for a while — continuing to knock is
// what turns a short Steam throttle into a long block.
func TestRateLimitTripsCircuit(t *testing.T) {
	hc := fixtureServers(t, `{"error":"rate limited"}`, http.StatusTooManyRequests)
	t.Cleanup(steamGate.clear)

	if _, err := Build(context.Background(), hc, 76561198000000000); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
	if RetryAfter() <= 0 {
		t.Fatal("a 429 should open the circuit")
	}

	// While the circuit is open the next read must not reach Steam at all.
	before := reqCount.Load()
	if _, err := Build(context.Background(), hc, 76561198000000001); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited while cooling off", err)
	}
	if got := reqCount.Load() - before; got != 0 {
		t.Errorf("%d request(s) reached Steam while the circuit was open, want 0", got)
	}
}
