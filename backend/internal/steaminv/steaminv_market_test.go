package steaminv

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// steamapis' bulk Steam-market feed, trimmed to the two priced fixture items.
// The case has 500 sales in 30 days, so its 30-day figure is a realized price;
// the AK's two sales are under the floor, so its smoothed "safe" value stands
// in for a suggested price. (sold.avg_daily_volume is null live — kept here so
// the decoder is proven against it.)
const marketFixture = `{"appID":730,"data":[
  {"market_hash_name":"Dreams & Nightmares Case","prices":{"latest":1.09,"safe":1.10,
   "safe_ts":{"last_24h":1.04,"last_7d":1.06,"last_30d":1.05,"last_90d":1.02},
   "sold":{"last_24h":20,"last_7d":120,"last_30d":500,"last_90d":1500,"avg_daily_volume":16},"unstable":false}},
  {"market_hash_name":"StatTrak™ AK-47 | Redline (Field-Tested)","prices":{"latest":39.5,"safe":40.00,
   "safe_ts":{"last_24h":0,"last_7d":0,"last_30d":41.00,"last_90d":39.0},
   "sold":{"last_24h":0,"last_7d":0,"last_30d":2,"last_90d":9,"avg_daily_volume":null},"unstable":true,"unstable_reason":"LOW_SALES_3PLUS_MONTHS"}}
]}`

// Since the move to a hosting ASN that Skinport's Cloudflare bans outright,
// every inventory priced at $0.00 with only a WARN line to say why. When
// Skinport refuses, the Steam market (steamapis, the key the inventory
// fallback already uses) must carry the prices — and the view must say which
// market it quoted, because the two run a Steam-cut apart.
func TestPricesFallBackToSteamMarketWhenSkinportRefuses(t *testing.T) {
	hc := fixtureServers(t, invFixture, http.StatusOK) // Steam double + cache reset
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/market/items/730") {
			if r.URL.Query().Get("api_key") != "k" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(marketFixture))
			return
		}
		// Cloudflare's ASN ban, verbatim from the VM.
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("error code: 1005"))
	}))
	t.Cleanup(blocked.Close)
	prevSp, prevSales, prevMarket := skinportURL, skinportSalesURL, steamapisMarketURL
	skinportURL = blocked.URL + "/skinport"
	skinportSalesURL = blocked.URL + "/skinport/sales"
	steamapisMarketURL = blocked.URL + "/market/items/730?api_key=%s"
	SetFallbackKey("k")
	t.Cleanup(func() {
		skinportURL, skinportSalesURL, steamapisMarketURL = prevSp, prevSales, prevMarket
		SetFallbackKey("")
	})

	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if v.PriceSource != "steam-market" {
		t.Fatalf("price_source = %q, want steam-market", v.PriceSource)
	}
	// 3 × 1.05 (realized, 500 sales) + 40.00 (smoothed value, 2 sales) = 43.15
	if v.TotalValue < 43.14 || v.TotalValue > 43.16 {
		t.Fatalf("total = %.2f, want 43.15", v.TotalValue)
	}
	if v.PricedItems != 4 || v.RealizedItems != 3 {
		t.Errorf("priced=%d realized=%d, want 4 and 3", v.PricedItems, v.RealizedItems)
	}
	byName := map[string]Item{}
	for _, it := range v.TopItems {
		byName[it.MarketName] = it
	}
	if got := byName["Dreams & Nightmares Case"]; got.Price != 1.05 || got.SaleVolume != 500 || got.PriceVariants != 0 {
		t.Errorf("case = %+v, want 1.05 on 500 sales, one finish", got)
	}
	if got := byName["StatTrak™ AK-47 | Redline (Field-Tested)"]; got.Price != 40.00 || got.SaleVolume != 0 {
		t.Errorf("AK = %+v, want the smoothed 40.00 — 2 sales is not a market", got)
	}
}

// Without a steamapis key there is no second source: a Skinport refusal leaves
// the map empty (and the view unpriced) rather than erroring.
func TestPricesWithoutKeyStayEmptyWhenSkinportRefuses(t *testing.T) {
	hc := fixtureServers(t, invFixture, http.StatusOK)
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("error code: 1005"))
	}))
	t.Cleanup(blocked.Close)
	prevSp, prevSales := skinportURL, skinportSalesURL
	skinportURL = blocked.URL + "/skinport"
	skinportSalesURL = blocked.URL + "/skinport/sales"
	t.Cleanup(func() { skinportURL, skinportSalesURL = prevSp, prevSales })
	SetFallbackKey("")

	v, err := Build(context.Background(), hc, 76561198000000000)
	if err != nil {
		t.Fatal(err)
	}
	if v.PricedItems != 0 || v.TotalValue != 0 || v.PriceSource != "" {
		t.Errorf("view = priced %d total %.2f source %q, want nothing priced and no source claimed",
			v.PricedItems, v.TotalValue, v.PriceSource)
	}
}
