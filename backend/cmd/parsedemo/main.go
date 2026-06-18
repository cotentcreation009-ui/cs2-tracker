// Command parsedemo parses a local .dem file and prints the resulting stats.
// It is the quickest way to verify the parser against a real demo without any
// database or Redis:
//
//	go run ./cmd/parsedemo path/to/match.dem            # pretty scoreboard
//	go run ./cmd/parsedemo -json path/to/match.dem      # full JSON
//	go run ./cmd/parsedemo -db path/to/match.dem        # also write to Postgres
//
// The -db flag uses DATABASE_URL (same as the services).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/parser"
)

func main() {
	jsonOut := flag.Bool("json", false, "print the full parsed result as JSON")
	toDB := flag.Bool("db", false, "also persist the parsed match to Postgres (uses DATABASE_URL)")
	flag.Parse()

	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: parsedemo [-json] [-db] <demo.dem>")
		os.Exit(2)
	}
	path := flag.Arg(0)

	fmt.Fprintf(os.Stderr, "parsing %s ...\n", path)
	pm, err := parser.ParseFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if h, err := parser.HashFile(path); err == nil {
		pm.Match.DemoHash = h // so -db dedupes a re-parsed demo
	}

	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(pm)
	} else {
		printScoreboard(pm)
	}

	if *toDB {
		if err := persist(pm); err != nil {
			fmt.Fprintln(os.Stderr, "db error:", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "stored in database.")
	}
}

func printScoreboard(pm *models.ParsedMatch) {
	fmt.Printf("\nMap: %s   Score: %d-%d   Rounds: %d   Tickrate: %.0f   Duration: %ds\n\n",
		pm.Match.Map, pm.Match.TeamAScore, pm.Match.TeamBScore, pm.Match.RoundsTotal, pm.Match.TickRate, pm.Match.DurationS)

	players := append([]models.MatchPlayer(nil), pm.Players...)
	sort.Slice(players, func(i, j int) bool { return players[i].Rating > players[j].Rating })

	tw := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, "PLAYER\tSIDE\tK\tD\tA\tADR\tKAST%\tHS%\tRATING\tOK\tCL")
	for _, p := range players {
		fmt.Fprintf(tw, "%s\t%s\t%d\t%d\t%d\t%.0f\t%.0f\t%.0f\t%.2f\t%d\t%d\n",
			truncate(p.PersonaName, 18), p.StartSide, p.Kills, p.Deaths, p.Assists,
			p.ADR, p.KASTPct, p.HSPct, p.Rating, p.OpeningKills, p.ClutchesWon)
	}
	_ = tw.Flush()
	fmt.Printf("\n%d kills recorded across %d rounds.\n", len(pm.Kills), len(pm.Rounds))
}

func persist(pm *models.ParsedMatch) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	database, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		return err
	}
	id, err := database.InsertParsedMatch(ctx, pm)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "match id = %d\n", id)
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
