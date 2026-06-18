// Command steamcheck smoke-tests the Steam Web API key against the live API. It
// has no database or Redis dependency, so it runs even when Docker is down —
// the quickest way to confirm a freshly-added STEAM_API_KEY works end to end.
//
//	STEAM_API_KEY=xxxx go run ./cmd/steamcheck                 # checks a default account
//	STEAM_API_KEY=xxxx go run ./cmd/steamcheck gabelogannewell # vanity name
//	STEAM_API_KEY=xxxx go run ./cmd/steamcheck 7656119...      # SteamID64
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/steam"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	if !cfg.HasSteamKey() {
		fail(errors.New("STEAM_API_KEY is not set (export it or put it in .env)"))
	}

	target := "gabelogannewell" // Gabe Newell — a reliable public profile
	if len(os.Args) > 1 {
		target = os.Args[1]
	}

	client := steam.New(cfg.SteamAPIKey)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	fmt.Printf("Resolving %q ...\n", target)
	id, err := client.ResolveSteamID(ctx, target)
	if err != nil {
		fail(fmt.Errorf("ResolveSteamID: %w", err))
	}
	fmt.Printf("  SteamID64: %d\n\n", id)

	fmt.Println("GetPlayerSummaries ...")
	summaries, err := client.GetPlayerSummaries(ctx, id)
	if err != nil {
		fail(fmt.Errorf("GetPlayerSummaries: %w", err))
	}
	if len(summaries) == 0 {
		fail(errors.New("no summary returned"))
	}
	s := summaries[0]
	fmt.Printf("  Name:    %s\n  Country: %s\n  Profile: %s\n  Avatar:  %s\n\n",
		s.PersonaName, s.LocCountryCode, s.ProfileURL, s.AvatarFull)

	fmt.Println("GetUserStatsForGame (CS2 / App 730) ...")
	gs, err := client.GetUserStatsForGame(ctx, steam.AppIDCS2, id)
	switch {
	case errors.Is(err, steam.ErrNotFound):
		fmt.Println("  no CS2 stats (profile private or never played) — that's fine")
	case err != nil:
		fail(fmt.Errorf("GetUserStatsForGame: %w", err))
	default:
		fmt.Printf("  total_kills:       %d\n", gs.Int("total_kills"))
		fmt.Printf("  total_deaths:      %d\n", gs.Int("total_deaths"))
		fmt.Printf("  total_time_played: %d\n", gs.Int("total_time_played"))
		fmt.Printf("  stat keys:         %d\n", len(gs.Stats))
	}

	fmt.Println("\nSteam API key works. ✔")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "steamcheck:", err)
	os.Exit(1)
}
