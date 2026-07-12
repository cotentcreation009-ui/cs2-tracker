package api

import "testing"

// leetifyGameIDRe must accept both the v3 UUID form (public profiles) and the
// legacy "<hex>-<hex>" form (profiles served by Leetify's legacy endpoint) —
// rejecting either shape breaks one-click demo analysis for those matches with
// "invalid match id". It must still reject anything that isn't hex + hyphens so
// the value stays safe in a URL path.
func TestLeetifyGameIDRe(t *testing.T) {
	accept := []string{
		"f46fc17e-c937-4aa1-bd65-b829e796aeed", // v3 UUID
		"7c9bc801f1a8bb51-6e7cc3",              // legacy <hex>-<hex>
		"7c9bc801f1a8bb51-0ac96f",
	}
	reject := []string{
		"",
		"not-a-uuid",
		"../../etc/passwd",
		"abc 123",
		"7c9bc801f1a8bb51", // no hyphen segment
		"zzzz-zzzz",        // non-hex
		"7c9bc801f1a8bb51-6e7cc3/extra",
	}
	for _, s := range accept {
		if !leetifyGameIDRe.MatchString(s) {
			t.Errorf("expected ACCEPT, got reject: %q", s)
		}
	}
	for _, s := range reject {
		if leetifyGameIDRe.MatchString(s) {
			t.Errorf("expected REJECT, got accept: %q", s)
		}
	}
}
