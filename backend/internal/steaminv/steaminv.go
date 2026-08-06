// Package steaminv builds a CS2 skin-inventory showcase for a SteamID64:
// items from Steam's public community inventory endpoint, valued with
// Skinport's bulk price list (one call prices ~25k distinct items, cached
// in-process for an hour). Everything is public data; private inventories
// come back flagged rather than erroring.
package steaminv

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/andybalholm/brotli"
)

// ErrRateLimited means Steam is refusing inventory reads from this host — the
// caller should serve a stored snapshot rather than treat it as a failure.
var ErrRateLimited = errors.New("steaminv: steam is rate-limiting inventory reads")

// package vars so tests can point at fixture servers
var (
	inventoryURL = "https://steamcommunity.com/inventory/%d/730/2?l=english&count=2000"
	skinportURL  = "https://api.skinport.com/v1/items?app_id=730&currency=USD"
	// What items actually sold for, rather than what Skinport suggests they
	// are worth — 35k names with min/max/avg/median/volume per window.
	skinportSalesURL = "https://api.skinport.com/v1/sales/history?app_id=730&currency=USD"
)

const iconBase = "https://community.fastly.steamstatic.com/economy/image/"

// Item is one distinct inventory entry (identical items are grouped).
type Item struct {
	Name        string  `json:"name"`             // "AK-47 | Redline (Field-Tested)"
	MarketName  string  `json:"market_hash_name"` // price join key
	IconURL     string  `json:"icon"`             // full CDN URL
	Type        string  `json:"type"`             // "Rifle", "Knife", "Sticker"…
	Rarity      string  `json:"rarity"`           // "Covert"…
	RarityColor string  `json:"rarity_color"`     // "#eb4b4b"
	Exterior    string  `json:"exterior,omitempty"`
	StatTrak    bool    `json:"stattrak,omitempty"`
	Souvenir    bool    `json:"souvenir,omitempty"`
	Count int     `json:"count"`
	Price float64 `json:"price,omitempty"` // per unit, USD
	// SaleVolume is how many of these actually sold on Skinport in the last 30
	// days. Non-zero means Price is the median of those sales; zero means it
	// is Skinport's suggested price, which nobody has necessarily paid.
	SaleVolume int `json:"sale_volume,omitempty"`
	// PriceVariants > 1 means several finishes share this market name (Doppler
	// phases and their rare variants) and Price is the median across them —
	// which finish this one is cannot be read from a public inventory.
	PriceVariants int `json:"price_variants,omitempty"`
	// Marketable and Tradable are why an item can be unpriced: a market price
	// only exists for something the market will carry. Steam gives us both, so
	// an item with no price can say which kind of "no" it is rather than
	// showing a bare dash.
	Marketable bool `json:"marketable,omitempty"`
	Tradable   bool `json:"tradable,omitempty"`
}

// Category is an item-type bucket for the breakdown row.
type Category struct {
	Name  string  `json:"name"`
	Count int     `json:"count"`
	Value float64 `json:"value"`
}

// RarityBand is one slice of the rarity distribution.
type RarityBand struct {
	Name  string `json:"name"`
	Color string `json:"color"`
	Count int    `json:"count"`
}

// View is the aggregate the frontend renders.
type View struct {
	Private bool `json:"private,omitempty"`
	// Stale marks a stored snapshot we served because Steam wouldn't answer —
	// the numbers are real, just as of FetchedAt.
	Stale bool `json:"stale,omitempty"`
	// Unavailable means we have never managed to read this inventory and
	// Steam is currently refusing; RetryAfterSec is when it's worth asking again.
	Unavailable   bool `json:"unavailable,omitempty"`
	RetryAfterSec int  `json:"retry_after_sec,omitempty"`
	// Truncated marks an inventory too large to read in full — the totals
	// below cover the items we did read, not the whole collection.
	Truncated bool `json:"truncated,omitempty"`
	// TotalItems is what Steam says the inventory holds, which is larger than
	// ItemCount when Truncated.
	TotalItems int `json:"total_items,omitempty"`

	TotalValue  float64 `json:"total_value"`
	PricedItems int     `json:"priced_items"`
	// RealizedItems is how many of PricedItems are valued at a median of real
	// sales rather than a suggested price — i.e. how much of the total is
	// backed by money that changed hands.
	RealizedItems int `json:"realized_items,omitempty"`
	ItemCount       int          `json:"item_count"` // total assets incl. duplicates
	DistinctCount   int          `json:"distinct_count"`
	MarketableCount int          `json:"marketable_count"`
	TopItems        []Item       `json:"top_items"`
	Categories      []Category   `json:"categories"`
	Rarities        []RarityBand `json:"rarities"`
	FetchedAt       string       `json:"fetched_at"`
}

// --- Skinport price cache (process-wide, 1h) --------------------------------

// Price is what one unit is worth and how much that figure is worth trusting.
// Skinport publishes two things: a suggested price, and the record of what
// items actually sold for. A median of real sales beats an estimate, so we
// prefer it wherever enough sales exist to make a median mean anything, and
// fall back to the suggested price otherwise.
type Price struct {
	USD float64
	// Volume is the 30-day sale count behind a realized median; 0 means this
	// is Skinport's suggested price rather than something anyone paid.
	Volume int
	// Variants is how many separately-priced finishes share this one market
	// name (Doppler phases, Ruby/Emerald/Sapphire/Black Pearl). More than one
	// means the figure is a median across them rather than this item's price,
	// because which finish someone owns is not knowable from a public
	// inventory — the phase lives in inspect data Steam does not publish.
	Variants int
}

// median of a non-empty slice; sorts in place.
func median(v []float64) float64 {
	sort.Float64s(v)
	n := len(v)
	if n%2 == 1 {
		return v[n/2]
	}
	return (v[n/2-1] + v[n/2]) / 2
}

// minVolume is how many sales a median needs before we prefer it. A median of
// one or two sales is a coin flip, not a market.
const minVolume = 3

var (
	priceMu  sync.Mutex
	priceMap map[string]Price
	priceAt  time.Time
)

// decompress unwraps a response we asked to be compressed. Setting
// Accept-Encoding by hand opts out of net/http's transparent gzip handling,
// so whatever the server chose is ours to undo.
func decompress(resp *http.Response) (io.ReadCloser, error) {
	switch strings.ToLower(resp.Header.Get("Content-Encoding")) {
	case "br":
		return io.NopCloser(brotli.NewReader(resp.Body)), nil
	case "gzip":
		return gzip.NewReader(resp.Body)
	default:
		return io.NopCloser(resp.Body), nil
	}
}

// logPriceFailure records why a price refresh came back empty. Prices failing
// silently means every inventory shows $0 with no signal that anything broke.
func logPriceFailure(status int, detail string) {
	slog.Warn("skinport price fetch failed", "status", status,
		"detail", strings.TrimSpace(detail))
}

// fetchSkinport GETs one Skinport feed and decodes it into out.
func fetchSkinport(ctx context.Context, hc *http.Client, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	// Skinport hard-gates these endpoints on Brotli: anything that doesn't
	// explicitly offer br gets a 406, including Go's automatic
	// "Accept-Encoding: gzip". Setting the header ourselves also turns off
	// the transport's transparent decompression, so we unwrap the body below.
	req.Header.Set("Accept-Encoding", "br, gzip")
	req.Header.Set("User-Agent", "StatRun/1.0 (https://csrun.win)")
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Silence here is how the 406 above went unnoticed in production —
		// every inventory priced at zero and nothing said why.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		logPriceFailure(resp.StatusCode, string(snippet))
		return fmt.Errorf("skinport: status %d", resp.StatusCode)
	}
	body, err := decompress(resp)
	if err != nil {
		logPriceFailure(resp.StatusCode, "decompress: "+err.Error())
		return err
	}
	defer body.Close()
	if err := json.NewDecoder(io.LimitReader(body, 64<<20)).Decode(out); err != nil {
		logPriceFailure(resp.StatusCode, "decode: "+err.Error())
		return err
	}
	return nil
}

// prices builds the name→price map from Skinport's two feeds. The sales feed
// is what people actually paid, so it wins wherever there is enough volume for
// a median to mean something; the suggested-price feed covers everything else.
// Both are one keyless call each and cached together for an hour.
func prices(ctx context.Context, hc *http.Client) map[string]Price {
	priceMu.Lock()
	defer priceMu.Unlock()
	if priceMap != nil && time.Since(priceAt) < time.Hour {
		return priceMap
	}

	var listed []struct {
		Name      string   `json:"market_hash_name"`
		Suggested *float64 `json:"suggested_price"`
		Min       *float64 `json:"min_price"`
	}
	if err := fetchSkinport(ctx, hc, skinportURL, &listed); err != nil {
		return priceMap // stale-if-error: keep whatever we had
	}
	// Skinport publishes one row per finish, so a Doppler knife arrives as five
	// or six rows sharing a market name. Assigning them into the map one by one
	// would leave whichever landed last — routinely the Ruby or Emerald, which
	// is worth several times a normal phase. Collect every row and take the
	// median instead: the finish someone actually owns is not knowable from a
	// public inventory, and a median is not dragged by the rare ones.
	listedPrices := make(map[string][]float64, len(listed))
	for _, r := range listed {
		switch {
		case r.Suggested != nil && *r.Suggested > 0:
			listedPrices[r.Name] = append(listedPrices[r.Name], *r.Suggested)
		case r.Min != nil && *r.Min > 0:
			listedPrices[r.Name] = append(listedPrices[r.Name], *r.Min)
		}
	}
	m := make(map[string]Price, len(listedPrices))
	for name, ps := range listedPrices {
		m[name] = Price{USD: median(ps), Variants: len(ps)}
	}

	// Realized sales override the estimate where the market is liquid enough
	// to have an opinion. Best-effort: if this feed fails we still have the
	// suggested prices above.
	var sold []struct {
		Name string `json:"market_hash_name"`
		Last struct {
			Median float64 `json:"median"`
			Volume int     `json:"volume"`
		} `json:"last_30_days"`
	}
	if err := fetchSkinport(ctx, hc, skinportSalesURL, &sold); err == nil {
		soldPrices := make(map[string][]float64, len(sold))
		soldVolume := make(map[string]int, len(sold))
		for _, r := range sold {
			if r.Last.Volume >= minVolume && r.Last.Median > 0 {
				soldPrices[r.Name] = append(soldPrices[r.Name], r.Last.Median)
				soldVolume[r.Name] += r.Last.Volume
			}
		}
		for name, ps := range soldPrices {
			variants := len(ps)
			if v := m[name].Variants; v > variants {
				variants = v
			}
			m[name] = Price{USD: median(ps), Volume: soldVolume[name], Variants: variants}
		}
	}

	if len(m) > 0 {
		priceMap, priceAt = m, time.Now()
	}
	return priceMap
}

// --- request gate -----------------------------------------------------------
//
// Every inventory read the site makes leaves from ONE datacenter IP, and Steam
// throttles that endpoint per IP. Left ungoverned, a handful of simultaneous
// profile views earns a 429 that then affects every visitor.
//
// The numbers come from measuring the endpoint rather than from folklore. It is
// a rolling window of roughly six requests per minute per calling IP, and it
// clears after about a minute of complete silence — but only complete silence:
// requesting during the window keeps resetting it, which is why a naive retry
// loop looks like an hours-long ban. So we pace under the ceiling, and a 429
// buys quiet for a bit longer than the window rather than for hours.
var (
	minSpacing   = 12 * time.Second // ~5/min, under the measured ~6/min ceiling
	maxQueueWait = 8 * time.Second  // longer than this and we'd rather serve stale
	firstBackoff = 90 * time.Second // one window plus margin
	maxBackoff   = 5 * time.Minute  // ceiling on the circuit-breaker cool-off
)

type gate struct {
	mu           sync.Mutex
	next         time.Time // earliest moment the next read may leave
	blockedUntil time.Time // circuit open until (zero = closed)
	strikes      int
}

var steamGate gate

// reserve blocks for the request's turn, or reports ErrRateLimited if the line
// is too long or the circuit is open.
func (g *gate) reserve(ctx context.Context) error {
	g.mu.Lock()
	now := time.Now()
	if now.Before(g.blockedUntil) {
		d := g.blockedUntil.Sub(now)
		g.mu.Unlock()
		return fmt.Errorf("%w (cooling off for %s)", ErrRateLimited, d.Round(time.Second))
	}
	var wait time.Duration
	if now.Before(g.next) {
		wait = g.next.Sub(now)
	}
	if wait > maxQueueWait {
		g.mu.Unlock()
		return fmt.Errorf("%w (too many reads queued)", ErrRateLimited)
	}
	g.next = now.Add(wait + minSpacing)
	g.mu.Unlock()

	if wait > 0 {
		t := time.NewTimer(wait)
		defer t.Stop()
		select {
		case <-t.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// trip opens the circuit after a 429, doubling the cool-off each consecutive
// strike (90s, 3m, 5m…). The first wait is deliberately close to the real
// recovery window — waiting hours for a one-minute problem makes the panel look
// permanently broken.
func (g *gate) trip() time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.strikes++
	d := firstBackoff << uint(min(g.strikes-1, 3))
	if d > maxBackoff {
		d = maxBackoff
	}
	g.blockedUntil = time.Now().Add(d)
	return d
}

// clear resets the strike count after a clean read.
func (g *gate) clear() {
	g.mu.Lock()
	g.strikes, g.blockedUntil = 0, time.Time{}
	g.mu.Unlock()
}

// RetryAfter reports how long the circuit stays open, or 0 if reads are allowed.
func RetryAfter() time.Duration {
	steamGate.mu.Lock()
	defer steamGate.mu.Unlock()
	if d := time.Until(steamGate.blockedUntil); d > 0 {
		return d
	}
	return 0
}

// --- Steam inventory --------------------------------------------------------

type steamInv struct {
	Assets []struct {
		ClassID    string `json:"classid"`
		InstanceID string `json:"instanceid"`
	} `json:"assets"`
	Descriptions []struct {
		ClassID    string `json:"classid"`
		InstanceID string `json:"instanceid"`
		IconURL    string `json:"icon_url"`
		Name       string `json:"name"`
		MarketName string `json:"market_hash_name"`
		Type       string `json:"type"`
		Tradable   int    `json:"tradable"`
		Marketable int    `json:"marketable"`
		Tags       []struct {
			Category string `json:"category"`
			Name     string `json:"localized_tag_name"`
			Color    string `json:"color"`
		} `json:"tags"`
	} `json:"descriptions"`
	TotalCount  int    `json:"total_inventory_count"`
	Success     int    `json:"success"`
	MoreItems   int    `json:"more_items"`
	LastAssetID string `json:"last_assetid"`
}

// errPrivate is the private-inventory signal, unwound in Build.
var errPrivate = errors.New("steaminv: inventory is private")

// maxPages bounds a single build. Steam clamps a page at 2000 items and every
// page spends a slot in the same per-minute budget, so one enormous inventory
// must not eat the whole site's allowance.
const maxPages = 4

// maxListed bounds the item grid we ship (distinct entries, not assets — a
// stack of 40 identical cases is one entry). Measured at ~510 bytes of JSON
// each, so this is a ~500KB ceiling before compression, and it sits far above
// what real inventories carry. Aggregates are computed over everything
// regardless, so a capped grid never distorts the headline value.
const maxListed = 1000

// fetchPage reads one page of the inventory, starting after cursor when given.
// Status code alone decides the outcome — Steam's 403 (private) and 429
// (throttled) bodies are both the literal bytes "null", so the body can never
// be used to tell them apart.
func fetchPage(ctx context.Context, hc *http.Client, steam64 uint64, cursor string) (*steamInv, error) {
	if err := steamGate.reserve(ctx); err != nil {
		return nil, err
	}
	u := fmt.Sprintf(inventoryURL, steam64)
	if cursor != "" {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + "start_assetid=" + url.QueryEscape(cursor)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Referer", fmt.Sprintf("https://steamcommunity.com/profiles/%d/inventory/", steam64))
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("steaminv: fetch: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		steamGate.clear()
	case http.StatusForbidden, http.StatusUnauthorized:
		// A real answer about a real profile, so we are not blocked — but a
		// 403 still spends a slot in Steam's window, so the strike count
		// stays where it is rather than being reset.
		return nil, errPrivate
	case http.StatusTooManyRequests:
		return nil, fmt.Errorf("%w (cooling off for %s)", ErrRateLimited, steamGate.trip().Round(time.Second))
	case http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout:
		return nil, fmt.Errorf("%w (steam returned %d)", ErrRateLimited, resp.StatusCode)
	default:
		return nil, fmt.Errorf("steaminv: status %d", resp.StatusCode)
	}
	var inv steamInv
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&inv); err != nil {
		return nil, fmt.Errorf("steaminv: decode: %w", err)
	}
	return &inv, nil
}

// Build fetches and aggregates a player's CS2 inventory, following Steam's
// paging cursor so a large collection isn't silently cut off at the first
// page. A private inventory returns View{Private:true} with no error;
// ErrRateLimited means Steam turned us away and the caller should fall back to
// a stored snapshot.
func Build(ctx context.Context, hc *http.Client, steam64 uint64) (*View, error) {
	private := func() (*View, error) {
		return &View{Private: true, FetchedAt: time.Now().UTC().Format(time.RFC3339)}, nil
	}

	var inv steamInv
	seenDesc := map[string]bool{} // descriptions repeat across pages
	truncated := false
	cursor := ""
	for page := 0; ; page++ {
		p, err := fetchPage(ctx, hc, steam64, cursor)
		if err != nil {
			if errors.Is(err, errPrivate) {
				return private()
			}
			if page == 0 {
				return nil, err
			}
			// Later pages failing still leaves a real, if partial, picture.
			truncated = true
			break
		}
		inv.Assets = append(inv.Assets, p.Assets...)
		for _, d := range p.Descriptions {
			k := d.ClassID + "_" + d.InstanceID
			if seenDesc[k] {
				continue
			}
			seenDesc[k] = true
			inv.Descriptions = append(inv.Descriptions, d)
		}
		if page == 0 {
			inv.Success, inv.TotalCount = p.Success, p.TotalCount
		}
		if p.MoreItems != 1 || p.LastAssetID == "" {
			break
		}
		if page+1 >= maxPages {
			truncated = true
			break
		}
		cursor = p.LastAssetID
	}

	if inv.Success != 1 && len(inv.Assets) == 0 {
		// Defensive: the live private path is a 403, but Steam has historically
		// also answered 200 {"success": false} here.
		return private()
	}

	// asset counts per class+instance → grouped items
	counts := map[string]int{}
	for _, a := range inv.Assets {
		counts[a.ClassID+"_"+a.InstanceID]++
	}
	pm := prices(ctx, hc)

	// byName merges the descriptions that share one market_hash_name; order
	// keeps the first-seen sequence so the result is deterministic before the
	// value sort below.
	byName := make(map[string]*Item, len(inv.Descriptions))
	order := make([]string, 0, len(inv.Descriptions))
	v := &View{
		ItemCount:  len(inv.Assets),
		TotalItems: inv.TotalCount,
		Truncated:  truncated,
		FetchedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	catMap := map[string]*Category{}
	rarMap := map[string]*RarityBand{}
	for _, d := range inv.Descriptions {
		n := counts[d.ClassID+"_"+d.InstanceID]
		if n == 0 {
			continue
		}
		it := Item{
			Name:       d.Name,
			MarketName: d.MarketName,
			IconURL:    iconBase + d.IconURL,
			Count:      n,
			Marketable: d.Marketable == 1,
			Tradable:   d.Tradable == 1,
			StatTrak:   strings.Contains(d.Name, "StatTrak"),
			Souvenir:   strings.HasPrefix(d.Name, "Souvenir"),
		}
		for _, t := range d.Tags {
			switch t.Category {
			case "Type":
				it.Type = t.Name
			case "Rarity":
				it.Rarity = t.Name
				if t.Color != "" {
					it.RarityColor = "#" + strings.TrimPrefix(t.Color, "#")
				}
			case "Exterior":
				it.Exterior = t.Name
			}
		}
		if p, ok := pm[d.MarketName]; ok {
			it.Price = p.USD
			it.SaleVolume = p.Volume
			if p.Variants > 1 {
				it.PriceVariants = p.Variants
			}
			v.TotalValue += p.USD * float64(n)
			v.PricedItems += n
			if p.Volume > 0 {
				v.RealizedItems += n
			}
		}
		if it.Marketable {
			v.MarketableCount += n
		}
		// Steam splits one market item across several descriptions when the
		// copies differ in ways it tracks and we don't (applied stickers, a
		// name tag, a trade hold). They are the same tradeable good at the same
		// price, so they become one card carrying the full count — otherwise
		// the grid shows "Tec-9 | Urban DDPAT x2" twice and React sees two
		// children under one key.
		key := it.MarketName
		if key == "" {
			key = it.Name
		}
		if ex, seen := byName[key]; seen {
			ex.Count += n
		} else {
			cp := it
			byName[key] = &cp
			order = append(order, key)
		}

		cat := it.Type
		if cat == "" {
			cat = "Other"
		}
		c := catMap[cat]
		if c == nil {
			c = &Category{Name: cat}
			catMap[cat] = c
		}
		c.Count += n
		c.Value += it.Price * float64(n)

		if it.Rarity != "" {
			rb := rarMap[it.Rarity]
			if rb == nil {
				rb = &RarityBand{Name: it.Rarity, Color: it.RarityColor}
				rarMap[it.Rarity] = rb
			}
			rb.Count += n
		}
	}

	items := make([]Item, 0, len(order))
	for _, k := range order {
		items = append(items, *byName[k])
	}
	v.DistinctCount = len(items)

	// Value first, then name, so equal-priced items (and the whole unpriced
	// tail) come back in a stable order instead of Go's map order — otherwise
	// every refetch reshuffles the grid.
	sort.Slice(items, func(i, j int) bool {
		li, lj := items[i].Price*float64(items[i].Count), items[j].Price*float64(items[j].Count)
		if li != lj {
			return li > lj
		}
		return items[i].Name < items[j].Name
	})
	// The whole inventory ships, not just the top slice: the panel filters by
	// category and by whether an item is priced, and neither is possible over a
	// truncated list. The aggregates above are computed across every item, so
	// the headline value stays correct even if this cap ever bites.
	if len(items) > maxListed {
		items = items[:maxListed]
	}
	v.TopItems = items

	for _, c := range catMap {
		v.Categories = append(v.Categories, *c)
	}
	sort.Slice(v.Categories, func(i, j int) bool { return v.Categories[i].Value > v.Categories[j].Value })
	for _, r := range rarMap {
		v.Rarities = append(v.Rarities, *r)
	}
	sort.Slice(v.Rarities, func(i, j int) bool { return v.Rarities[i].Count > v.Rarities[j].Count })
	return v, nil
}
