package config

import "testing"

func TestBridgeFlagAcceptsCommonSpellings(t *testing.T) {
	// A feature switched on by hand in a .env must not care whether the author
	// wrote 1 or true. An exact-match check on "1" leaves the feature off with
	// no error anywhere — and a disabled bridge is deliberately indistinguishable
	// from a player with nothing stored, so the mistake is invisible.
	t.Setenv("DATABASE_URL", "postgres://x/y") // Load requires it
	for _, on := range []string{"1", "true", "TRUE", "True", "t"} {
		t.Setenv("LEETIFY_BRIDGE_ENABLED", on)
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if !cfg.BridgeEnabled {
			t.Errorf("%q did not enable the bridge", on)
		}
	}
	for _, off := range []string{"", "0", "false"} {
		t.Setenv("LEETIFY_BRIDGE_ENABLED", off)
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.BridgeEnabled {
			t.Errorf("%q enabled the bridge", off)
		}
	}
}
