// Package steaminv builds a CS2 skin-inventory showcase for a SteamID64:
// items from Steam's public community inventory endpoint, valued with
// Skinport's bulk price list (one call prices ~25k distinct items, cached
// in-process for an hour). Everything is public data; private inventories
// come back flagged rather than erroring.
package steaminv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrRateLimited means Steam is refusing inventory reads from this host — the
// caller should serve a stored snapshot rather than treat it as a failure.
var ErrRateLimited = errors.New("steaminv: steam is rate-limiting inventory reads")

// package vars so tests can point at fixture servers
var (
	inventoryURL = "https://steamcommunity.com/inventory/%d/730/2?l=english&count=2000"
	skinportURL  = "https://api.skinport.com/v1/items?app_id=730&currency=USD"
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
	Count       int     `json:"count"`
	Price       float64 `json:"price,omitempty"` // per unit, USD (Skinport suggested)
	Marketable  bool    `json:"marketable,omitempty"`
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

	TotalValue      float64      `json:"total_value"`
	PricedItems     int          `json:"priced_items"`
	ItemCount       int          `json:"item_count"` // total assets incl. duplicates
	DistinctCount   int          `json:"distinct_count"`
	MarketableCount int          `json:"marketable_count"`
	TopItems        []Item       `json:"top_items"`
	Categories      []Category   `json:"categories"`
	Rarities        []RarityBand `json:"rarities"`
	FetchedAt       string       `json:"fetched_at"`
}

// --- Skinport price cache (process-wide, 1h) --------------------------------

var (
	priceMu  sync.Mutex
	priceMap map[string]float64
	priceAt  time.Time
)

func prices(ctx context.Context, hc *http.Client) map[string]float64 {
	priceMu.Lock()
	defer priceMu.Unlock()
	if priceMap != nil && time.Since(priceAt) < time.Hour {
		return priceMap
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, skinportURL, nil)
	if err != nil {
		return priceMap
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "StatRun/1.0 (https://csrun.win)")
	resp, err := hc.Do(req)
	if err != nil {
		return priceMap // stale-if-error: keep whatever we had
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return priceMap
	}
	var rows []struct {
		Name      string   `json:"market_hash_name"`
		Suggested *float64 `json:"suggested_price"`
		Min       *float64 `json:"min_price"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&rows); err != nil {
		return priceMap
	}
	m := make(map[string]float64, len(rows))
	for _, r := range rows {
		switch {
		case r.Suggested != nil && *r.Suggested > 0:
			m[r.Name] = *r.Suggested
		case r.Min != nil && *r.Min > 0:
			m[r.Name] = *r.Min
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
// profile views earns a block that then affects every visitor for far longer
// than the reads were worth. So: requests are spaced out, a caller that would
// have to queue too long is turned away, and a 429 trips a circuit breaker that
// backs off harder each time — because continuing to knock is what keeps a
// Steam block alive.
var (
	minSpacing   = 6 * time.Second  // floor between two Steam inventory reads
	maxQueueWait = 4 * time.Second  // longer than this and we'd rather serve stale
	maxBackoff   = 30 * time.Minute // ceiling on the circuit-breaker cool-off
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
// strike (5m, 10m, 20m, 30m…).
func (g *gate) trip() time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.strikes++
	d := time.Duration(1<<uint(min(g.strikes-1, 3))) * 5 * time.Minute
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
	TotalCount int `json:"total_inventory_count"`
	Success    int `json:"success"`
}

// Build fetches and aggregates a player's CS2 inventory. A private inventory
// returns View{Private:true} with no error; ErrRateLimited means Steam turned
// us away and the caller should fall back to a stored snapshot.
func Build(ctx context.Context, hc *http.Client, steam64 uint64) (*View, error) {
	if err := steamGate.reserve(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(inventoryURL, steam64), nil)
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
		// A real answer about a real profile — Steam is talking to us fine.
		steamGate.clear()
		return &View{Private: true, FetchedAt: time.Now().UTC().Format(time.RFC3339)}, nil
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
	if inv.Success != 1 && len(inv.Assets) == 0 {
		// Steam answers 200 {"success": false} for some private inventories
		return &View{Private: true, FetchedAt: time.Now().UTC().Format(time.RFC3339)}, nil
	}

	// asset counts per class+instance → grouped items
	counts := map[string]int{}
	for _, a := range inv.Assets {
		counts[a.ClassID+"_"+a.InstanceID]++
	}
	pm := prices(ctx, hc)

	items := make([]Item, 0, len(inv.Descriptions))
	v := &View{ItemCount: len(inv.Assets), FetchedAt: time.Now().UTC().Format(time.RFC3339)}
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
			it.Price = p
			v.TotalValue += p * float64(n)
			v.PricedItems += n
		}
		if it.Marketable {
			v.MarketableCount += n
		}
		v.DistinctCount++
		items = append(items, it)

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

	sort.Slice(items, func(i, j int) bool { return items[i].Price*float64(items[i].Count) > items[j].Price*float64(items[j].Count) })
	if len(items) > 60 {
		items = items[:60]
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
