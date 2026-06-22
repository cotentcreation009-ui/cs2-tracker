package steam

import "testing"

func TestFriendCode(t *testing.T) {
	// Reference vector: SteamID64 76561198077030352 -> "ADWZF-L9AL" (from the
	// player's in-game CS2 profile).
	got := FriendCode(76561198077030352)
	if got != "ADWZF-L9AL" {
		t.Fatalf("FriendCode(76561198077030352) = %q, want ADWZF-L9AL", got)
	}
}
