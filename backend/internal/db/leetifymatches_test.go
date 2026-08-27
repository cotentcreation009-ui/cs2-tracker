package db

import (
	"os"
	"strings"
	"testing"

	"github.com/cs2tracker/server/internal/leetify"
)

func TestParseSteamID(t *testing.T) {
	if got, err := parseSteamID("76561197995150836"); err != nil || got != 76561197995150836 {
		t.Errorf("got %d, %v", got, err)
	}
	// Leetify sends steam ids as strings; anything non-numeric is a row we
	// cannot key, and SaveMatch skips it rather than failing the whole match.
	for _, bad := range []string{"", "abc", "7656119799515083x", "-1", "1.5", " 123"} {
		if _, err := parseSteamID(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if _, err := parseSteamID("0"); err == nil {
		t.Error("0 should be rejected")
	}
}

// The migration is applied at startup, so a broken one stops the backend from
// booting. This cannot run Postgres, but it can catch the failures that are
// actually likely: a truncated file, a missing statement terminator, or a
// table renamed in one place and not the other.
func TestLeetifyMigrationShape(t *testing.T) {
	b, err := migrationFS.ReadFile("migrations/0017_leetify_match_rows.sql")
	if err != nil {
		t.Fatalf("migration not embedded: %v", err)
	}
	sql := string(b)
	// Count against the STATEMENTS only: the header comment quotes the eviction
	// SQL, and a naive count of the whole file trips over its own documentation.
	var stmtOnly strings.Builder
	for _, line := range strings.Split(sql, "\n") {
		if t := strings.TrimSpace(line); strings.HasPrefix(t, "--") {
			continue
		}
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		stmtOnly.WriteString(line)
		stmtOnly.WriteString("\n")
	}
	code := stmtOnly.String()

	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS leetify_matches",
		"CREATE TABLE IF NOT EXISTS leetify_match_players",
		"CREATE UNIQUE INDEX IF NOT EXISTS leetify_matches_source",
		"CREATE INDEX IF NOT EXISTS leetify_match_players_player",
		"REFERENCES leetify_matches(match_id) ON DELETE CASCADE",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("migration missing: %s", want)
		}
	}
	// Every statement terminated: a truncated file is the classic way a
	// migration half-applies.
	stmts := strings.Count(code, ";")
	if stmts != 4 {
		t.Errorf("statement count = %d, want 4 (2 tables + 2 indexes)", stmts)
	}
	if strings.Count(code, "(") != strings.Count(code, ")") {
		t.Error("unbalanced parentheses")
	}
	// Re-runnable: the runner tracks applied migrations, but a hand-run must
	// not blow up either.
	if strings.Count(code, "IF NOT EXISTS") != 4 {
		t.Error("every CREATE should be IF NOT EXISTS")
	}
	// Every column the store writes must exist in the schema.
	for _, col := range []string{
		"preaim", "reaction_time", "accuracy_head", "accuracy", "spray_accuracy",
		"leetify_rating", "kd_ratio", "dpr", "total_kills", "total_deaths",
		"rounds_count", "steam_id", "match_id", "finished_at",
	} {
		if !strings.Contains(sql, col) {
			t.Errorf("schema has no column %q, but the store writes it", col)
		}
	}
}

// The evict path is a contractual obligation, not a convenience: Leetify's
// guidelines require deleting stored data that stops being available. Pin that
// it stays a single unconditional statement over both tables.
func TestEvictIsTotal(t *testing.T) {
	src, err := readSource("leetifymatches.go")
	if err != nil {
		t.Skip("source not readable:", err)
	}
	i := strings.Index(src, "func (d *DB) EvictLeetifyMatches")
	if i < 0 {
		t.Fatal("EvictLeetifyMatches is gone — the eviction obligation has no implementation")
	}
	body := src[i:]
	if j := strings.Index(body, "\nfunc "); j > 0 {
		body = body[:j]
	}
	if !strings.Contains(body, "TRUNCATE leetify_match_players, leetify_matches") {
		t.Error("evict must truncate BOTH tables")
	}
	if strings.Contains(body, "WHERE") {
		t.Error("evict must not be conditional")
	}
}

// SaveMatch skips unkeyable rows rather than failing the match. Verified on the
// parsing half here; the write half needs a live database.
func TestMatchRowsAreSkippable(t *testing.T) {
	m := &leetify.Match{
		ID: "x", DataSource: "matchmaking",
		Stats: []leetify.MatchPlayer{
			{Steam64ID: "76561197995150836", Preaim: 5.4},
			{Steam64ID: "", Preaim: 1},
			{Steam64ID: "not-a-number", Preaim: 2},
		},
	}
	var kept int
	for i := range m.Stats {
		if _, err := parseSteamID(m.Stats[i].Steam64ID); err == nil {
			kept++
		}
	}
	if kept != 1 {
		t.Errorf("keepable rows = %d, want 1", kept)
	}
}

// readSource reads a file from this package's directory, for tests that assert
// on the shape of the code rather than its behaviour.
func readSource(name string) (string, error) {
	b, err := os.ReadFile(name)
	return string(b), err
}
