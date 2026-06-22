package steam

import (
	"crypto/md5"
	"encoding/binary"
	"math"
	"math/big"
	"math/bits"
	"strings"
)

// Base32 alphabet excluding the ambiguous letters I and O (exactly 32 symbols).
const friendCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// FriendCode converts a SteamID64 to the CS2 in-game friend code (e.g.
// "ADWZF-L9AL"). It is a deterministic encoding of the id — no API call needed.
// Valve encodes the id into a 13-char base32 string formatted AAAA-AAAAA-AAAA
// and displays it with the leading "AAAA-" group stripped.
//
// The accumulator is built with math/big because the reference algorithm relies
// on arbitrary-precision shifts feeding high bits back down each round; a plain
// uint64 would truncate that feedback and corrupt a few output bits.
func FriendCode(steamID64 uint64) string {
	// Hash input: lower 32 bits of the id with a "CSGO" magic in the high bytes.
	h := make([]byte, 8)
	binary.LittleEndian.PutUint64(h, (steamID64&0xFFFFFFFF)|0x4353474F00000000)
	sum := md5.Sum(h)
	hashValue := binary.LittleEndian.Uint32(sum[:4])

	r := new(big.Int)
	for i := 0; i < 8; i++ {
		idNibble := (steamID64 >> uint(i*4)) & 0xF
		hashNibble := (uint64(hashValue) >> uint(i)) & 1

		// a = (r << 4) | idNibble
		a := new(big.Int).Lsh(r, 4)
		a.Or(a, new(big.Int).SetUint64(idNibble))
		// r = ((r >> 28) << 32) | a
		r = new(big.Int).Lsh(new(big.Int).Rsh(r, 28), 32)
		r.Or(r, a)
		// r = ((r >> 31) << 32) | ((a << 1) | hashNibble)
		left := new(big.Int).Lsh(new(big.Int).Rsh(r, 31), 32)
		right := new(big.Int).Lsh(a, 1)
		right.Or(right, new(big.Int).SetUint64(hashNibble))
		r = left.Or(left, right)
	}

	// Take the low 64 bits and byte-swap (the reference packs little-endian then
	// reads big-endian).
	low := new(big.Int).And(r, new(big.Int).SetUint64(math.MaxUint64)).Uint64()
	result := bits.ReverseBytes64(low)

	var sb strings.Builder
	for i := 0; i < 13; i++ {
		if i == 4 || i == 9 {
			sb.WriteByte('-')
		}
		sb.WriteByte(friendCodeAlphabet[result&0x1F])
		result >>= 5
	}
	// Strip the leading "AAAA-" group; the displayed code is the last two groups.
	return sb.String()[5:]
}
