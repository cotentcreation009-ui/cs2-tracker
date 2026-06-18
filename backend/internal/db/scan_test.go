package db

import (
	"testing"

	"github.com/cs2tracker/server/internal/models"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestPgxScanCompatibility verifies — without a live database — that pgx's
// scan-plan resolution can put a BIGINT into our uint64 SteamID fields and a
// TEXT column into the models.Side named string type. These are the two
// non-obvious conversions the row scanners in store.go rely on; if a future pgx
// bump broke them, rows.Scan would fail only at runtime, so we pin it here.
func TestPgxScanCompatibility(t *testing.T) {
	m := pgtype.NewMap()

	// BIGINT (binary int8, big-endian) -> uint64
	var id uint64
	if err := m.Scan(pgtype.Int8OID, pgtype.BinaryFormatCode, []byte{0, 0, 0, 0, 0, 0, 0, 42}, &id); err != nil {
		t.Fatalf("scan BIGINT into uint64: %v", err)
	}
	if id != 42 {
		t.Errorf("uint64 scan = %d, want 42", id)
	}

	// TEXT -> models.Side (named string type)
	var side models.Side
	if err := m.Scan(pgtype.TextOID, pgtype.TextFormatCode, []byte("CT"), &side); err != nil {
		t.Fatalf("scan TEXT into models.Side: %v", err)
	}
	if side != models.SideCT {
		t.Errorf("Side scan = %q, want CT", side)
	}

	// Nullable BIGINT -> *int64 (used by GetJob's match_id). NULL must scan to
	// nil; a value must allocate. The scan target is therefore **int64.
	var mid *int64
	if err := m.Scan(pgtype.Int8OID, pgtype.BinaryFormatCode, nil, &mid); err != nil {
		t.Fatalf("scan NULL BIGINT into *int64: %v", err)
	}
	if mid != nil {
		t.Errorf("NULL should scan to nil, got %d", *mid)
	}
	if err := m.Scan(pgtype.Int8OID, pgtype.BinaryFormatCode, []byte{0, 0, 0, 0, 0, 0, 0, 7}, &mid); err != nil {
		t.Fatalf("scan BIGINT value into *int64: %v", err)
	}
	if mid == nil || *mid != 7 {
		t.Errorf("value scan = %v, want 7", mid)
	}
}
