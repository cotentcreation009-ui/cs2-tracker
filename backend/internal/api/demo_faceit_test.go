package api

import (
	"net/url"
	"testing"
)

// Pins FACEIT room-link parsing: room URLs in any language path, trailing
// segments, bare match ids — and rejects lookalikes on other hosts.
func TestFaceitRoomID(t *testing.T) {
	const id = "1-2e6c6720-5486-40be-9549-0b3657a8d4f7"
	cases := []struct {
		in   string
		want string
	}{
		{"https://www.faceit.com/en/cs2/room/" + id, id},
		{"https://www.faceit.com/en/cs2/room/" + id + "/scoreboard", id},
		{"https://faceit.com/pt/cs2/room/" + id, id},
		{"https://www.faceit.com/en/csgo/room/" + id, id}, // old title path
		{id, id}, // bare match id
		{"https://evil.com/en/cs2/room/" + id, ""},                 // wrong host
		{"https://notfaceit.com/room/" + id, ""},                   // wrong host
		{"https://www.faceit.com/en/players/someone", ""},          // not a room
		{"https://www.faceit.com/en/cs2/room/not-a-match-id", ""},  // bad id
		{"https://replay1.valve.net/730/x.dem.bz2", ""},            // direct demo URL
	}
	for _, tc := range cases {
		var u *url.URL
		if tc.in != "" {
			if p, err := url.Parse(tc.in); err == nil && p.Scheme != "" {
				u = p
			}
		}
		got := faceitRoomID(tc.in, nil)
		if got == "" && u != nil {
			got = faceitRoomID(tc.in, u)
		}
		if got != tc.want {
			t.Errorf("faceitRoomID(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
