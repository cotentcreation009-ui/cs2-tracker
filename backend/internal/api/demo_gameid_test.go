package api

import "testing"

// One-click analysis can only resolve v3 UUID game ids (Leetify's /api/games/
// returns a demo reference for those). The legacy "<hex>-<hex>" id — carried by
// accounts Leetify only serves from its legacy endpoint — has no resolvable demo,
// so it must be recognised separately to give a clear message rather than a
// generic error. Both patterns must reject anything that isn't hex + hyphens.
func TestLeetifyGameIDPatterns(t *testing.T) {
	uuid := []string{
		"f46fc17e-c937-4aa1-bd65-b829e796aeed",
		"38bfb6b4-888e-4d82-ad24-dfedb96cd40e",
	}
	legacy := []string{
		"7c9bc801f1a8bb51-6e7cc3",
		"e8aca8dadd63a9a3-9c3572",
	}
	garbage := []string{
		"",
		"not-a-uuid",
		"../../etc/passwd",
		"abc 123",
		"7c9bc801f1a8bb51",          // no hyphen segment
		"zzzz-zzzz",                 // non-hex
		"7c9bc801f1a8bb51-6e7cc3/x", // path injection
	}

	for _, s := range uuid {
		if !leetifyUUIDRe.MatchString(s) {
			t.Errorf("uuid: expected match: %q", s)
		}
		if leetifyLegacyIDRe.MatchString(s) {
			t.Errorf("uuid must not match the legacy pattern: %q", s)
		}
	}
	for _, s := range legacy {
		if !leetifyLegacyIDRe.MatchString(s) {
			t.Errorf("legacy: expected match: %q", s)
		}
		if leetifyUUIDRe.MatchString(s) {
			t.Errorf("legacy must not match the uuid pattern: %q", s)
		}
	}
	for _, s := range garbage {
		if leetifyUUIDRe.MatchString(s) || leetifyLegacyIDRe.MatchString(s) {
			t.Errorf("garbage should match neither pattern: %q", s)
		}
	}
}
