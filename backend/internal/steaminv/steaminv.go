// Package steaminv builds a CS2 skin-inventory showcase for a SteamID64:
// items from Steam's public community inventory endpoint, valued with
// Skinport's bulk price list (one call prices ~25k distinct items, cached
// in-process for an hour). Everything is public data; private inventories
// come back flagged rather than erroring.
package steaminv

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

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
	Private        bool         `json:"private,omitempty"`
	TotalValue     float64      `json:"total_value"`
	PricedItems    int          `json:"priced_items"`
	ItemCount       int          `json:"item_count"` // total assets incl. duplicates
	DistinctCount   int          `json:"distinct_count"`
	MarketableCount int          `json:"marketable_count"`
	TopItems       []Item       `json:"top_items"`
	Categories     []Category   `json:"categories"`
	Rarities       []RarityBand `json:"rarities"`
	FetchedAt      string       `json:"fetched_at"`
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
// returns View{Private:true} with no error.
func Build(ctx context.Context, hc *http.Client, steam64 uint64) (*View, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf(inventoryURL, steam64), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) StatRun/1.0")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("steaminv: fetch: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusForbidden, http.StatusUnauthorized:
		return &View{Private: true, FetchedAt: time.Now().UTC().Format(time.RFC3339)}, nil
	case http.StatusTooManyRequests:
		return nil, fmt.Errorf("steaminv: steam rate-limited the request")
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
