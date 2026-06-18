package sharecode

import "testing"

// Vectors taken from the reference csgo-sharecode test suite.
var vectors = []struct {
	code          string
	matchID       uint64
	reservationID uint64
	tvPort        uint16
}{
	{"CSGO-L9spZ-ihuov-cyhtE-kxbqa-FkBAA", 3400360672356205056, 3400367402569957763, 9725},
	{"CSGO-bPQEz-PrYTq-u5w8E-ZbUy7-ZeQ3A", 3325408798641750542, 3325410334092558852, 240},
	{"CSGO-wBrm6-7fkM6-AzBC5-u6GmR-iHLHA", 3302232779302895618, 3302241568953467250, 3085},
}

func TestDecode(t *testing.T) {
	for _, v := range vectors {
		got, err := Decode(v.code)
		if err != nil {
			t.Fatalf("Decode(%q) error: %v", v.code, err)
		}
		if got.MatchID != v.matchID {
			t.Errorf("%s MatchID = %d, want %d", v.code, got.MatchID, v.matchID)
		}
		if got.ReservationID != v.reservationID {
			t.Errorf("%s ReservationID = %d, want %d", v.code, got.ReservationID, v.reservationID)
		}
		if got.TVPort != v.tvPort {
			t.Errorf("%s TVPort = %d, want %d", v.code, got.TVPort, v.tvPort)
		}
	}
}

func TestEncodeRoundTrip(t *testing.T) {
	for _, v := range vectors {
		enc := Encode(Decoded{MatchID: v.matchID, ReservationID: v.reservationID, TVPort: v.tvPort})
		if enc != v.code {
			t.Errorf("Encode round-trip = %q, want %q", enc, v.code)
		}
	}
}

func TestDecodeInvalid(t *testing.T) {
	bad := []string{
		"",
		"CSGO-12345-12345-12345-12345-1234", // last group too short
		"nope",
		"whateverCSGO-12345-12345-12345-12345-12345", // prefix junk
		// Regex-valid but numerically out of range: must error, never panic.
		"CSGO-99999-99999-99999-99999-99999",
	}
	for _, c := range bad {
		if _, err := Decode(c); err == nil {
			t.Errorf("Decode(%q) expected error, got nil", c)
		}
	}
}
