// Package sharecode decodes (and encodes) CS2 / CS:GO match-sharing codes of the
// form CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx. A share code is a base-57 encoding of
// an 18-byte payload: an 8-byte match id, an 8-byte reservation/outcome id and a
// 2-byte GOTV port. Those three values are what the Steam Game Coordinator needs
// to hand back a downloadable GOTV demo URL — so this decoder is the first step
// of the share-code ingest pipeline.
//
// The algorithm matches Valve's reference implementation (and the widely-used
// csgo-sharecode library): the 18-byte buffer is the big-endian representation
// of the base-57 number, and each of the three fields is read little-endian.
package sharecode

import (
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// dictionary is Valve's 57-character alphabet. It deliberately omits the
// visually ambiguous characters I, g and l.
const dictionary = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789"

const base = 57

var (
	pattern   = regexp.MustCompile(`^CSGO(-?[\w]{5}){5}$`)
	dictIndex = func() map[rune]int {
		m := make(map[rune]int, base)
		for i, r := range dictionary {
			m[r] = i
		}
		return m
	}()
)

// Decoded is the payload carried by a match-sharing code.
type Decoded struct {
	// MatchID identifies the match within Valve's match history.
	MatchID uint64
	// ReservationID (a.k.a. outcome id) identifies the specific server
	// reservation; combined with MatchID it locates the demo.
	ReservationID uint64
	// TVPort is the GOTV port used when requesting the demo from the GC.
	TVPort uint16
}

// IsValid reports whether s is structurally a valid share code.
func IsValid(s string) bool { return pattern.MatchString(s) }

// Decode parses a share code into its three component ids. It returns an error
// for malformed codes or codes containing characters outside the dictionary.
func Decode(code string) (Decoded, error) {
	if !pattern.MatchString(code) {
		return Decoded{}, fmt.Errorf("sharecode: %q is not a valid match share code", code)
	}

	clean := strings.NewReplacer("CSGO", "", "-", "").Replace(code)

	// Reverse the characters, then accumulate base-57.
	big57 := big.NewInt(base)
	acc := new(big.Int)
	tmp := new(big.Int)
	runes := []rune(clean)
	for i := len(runes) - 1; i >= 0; i-- {
		idx, ok := dictIndex[runes[i]]
		if !ok {
			return Decoded{}, fmt.Errorf("sharecode: character %q is not in the dictionary", string(runes[i]))
		}
		acc.Mul(acc, big57)
		acc.Add(acc, tmp.SetInt64(int64(idx)))
	}

	// The regex bounds the code to 25 base-57 chars but not its magnitude, and
	// 57^25 needs up to 146 bits — more than the 18-byte (144-bit) payload. Guard
	// the overflow so we return an error rather than letting FillBytes panic.
	if acc.BitLen() > 144 {
		return Decoded{}, fmt.Errorf("sharecode: %q decodes to an out-of-range value", code)
	}

	// 18-byte big-endian buffer; each field is read little-endian out of it.
	buf := acc.FillBytes(make([]byte, 18))
	return Decoded{
		MatchID:       leUint64(buf[0:8]),
		ReservationID: leUint64(buf[8:16]),
		TVPort:        uint16(leUint64(buf[16:18])),
	}, nil
}

// Encode is the inverse of Decode. It is used in tests and is handy for tooling.
func Encode(d Decoded) string {
	buf := make([]byte, 18)
	putLEUint64(buf[0:8], d.MatchID)
	putLEUint64(buf[8:16], d.ReservationID)
	putLEUint64(buf[16:18], uint64(d.TVPort))

	acc := new(big.Int).SetBytes(buf) // big-endian -> big integer
	big57 := big.NewInt(base)
	mod := new(big.Int)

	// Produce 25 base-57 digits, least-significant first (matches code order).
	out := make([]byte, 25)
	for i := 0; i < 25; i++ {
		acc.DivMod(acc, big57, mod)
		out[i] = dictionary[mod.Int64()]
	}

	s := string(out)
	return fmt.Sprintf("CSGO-%s-%s-%s-%s-%s", s[0:5], s[5:10], s[10:15], s[15:20], s[20:25])
}

func leUint64(b []byte) uint64 {
	var v uint64
	for i := len(b) - 1; i >= 0; i-- {
		v = v<<8 | uint64(b[i])
	}
	return v
}

func putLEUint64(b []byte, v uint64) {
	for i := 0; i < len(b); i++ {
		b[i] = byte(v)
		v >>= 8
	}
}
