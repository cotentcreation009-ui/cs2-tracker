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

func TestAppFallbackFlagDefaultsOn(t *testing.T) {
	// The app-API fallback ships ON: a deployment that never heard of the flag
	// must still serve non-member profiles, and only an explicit 0/false — in
	// any of the spellings the bridge flag accepts — turns it off.
	t.Setenv("DATABASE_URL", "postgres://x/y")
	for _, on := range []string{"", "1", "true", "True"} {
		t.Setenv("LEETIFY_APP_FALLBACK", on)
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if !cfg.LeetifyAppFallback {
			t.Errorf("%q switched the app fallback off", on)
		}
	}
	for _, off := range []string{"0", "false", "FALSE", "f"} {
		t.Setenv("LEETIFY_APP_FALLBACK", off)
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.LeetifyAppFallback {
			t.Errorf("%q did not switch the app fallback off", off)
		}
	}
}

func TestPublicRelayDefaultsToTheAppRelay(t *testing.T) {
	// One Worker serves both: with nothing but the app relay in the .env the
	// public routes go through the same URL with the same key, so the fix for
	// api-public's per-address block needs no new variables on the box.
	t.Setenv("DATABASE_URL", "postgres://x/y")
	t.Setenv("LEETIFY_APP_RELAY_URL", "https://relay.example.workers.dev")
	t.Setenv("LEETIFY_APP_RELAY_KEY", "app-key")
	for _, v := range []string{"LEETIFY_PUBLIC_RELAY", "LEETIFY_PUBLIC_RELAY_URL", "LEETIFY_PUBLIC_RELAY_KEY"} {
		t.Setenv(v, "")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LeetifyPublicRelayURL != "https://relay.example.workers.dev" || cfg.LeetifyPublicRelayKey != "app-key" {
		t.Errorf("public relay = %q / %q, want the app relay's", cfg.LeetifyPublicRelayURL, cfg.LeetifyPublicRelayKey)
	}

	// Each half overrides on its own: a second Worker with its own key, or
	// the same Worker under another name.
	t.Setenv("LEETIFY_PUBLIC_RELAY_URL", "https://public.example.workers.dev")
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LeetifyPublicRelayURL != "https://public.example.workers.dev" || cfg.LeetifyPublicRelayKey != "app-key" {
		t.Errorf("public relay = %q / %q, want the own URL with the app key", cfg.LeetifyPublicRelayURL, cfg.LeetifyPublicRelayKey)
	}
	t.Setenv("LEETIFY_PUBLIC_RELAY_KEY", "public-key")
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LeetifyPublicRelayKey != "public-key" {
		t.Errorf("public relay key = %q, want the own key", cfg.LeetifyPublicRelayKey)
	}

	// The switch keeps the direct path only, without unsetting anything.
	for _, off := range []string{"0", "false"} {
		t.Setenv("LEETIFY_PUBLIC_RELAY", off)
		cfg, err = Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.LeetifyPublicRelayURL != "" || cfg.LeetifyPublicRelayKey != "" {
			t.Errorf("%q left the public relay at %q", off, cfg.LeetifyPublicRelayURL)
		}
		if cfg.LeetifyAppRelayURL == "" {
			t.Errorf("%q must not touch the app relay", off)
		}
	}

	// No relay anywhere: the direct path, as before.
	for _, v := range []string{"LEETIFY_PUBLIC_RELAY", "LEETIFY_APP_RELAY_URL", "LEETIFY_APP_RELAY_KEY", "LEETIFY_PUBLIC_RELAY_URL", "LEETIFY_PUBLIC_RELAY_KEY"} {
		t.Setenv(v, "")
	}
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LeetifyPublicRelayURL != "" {
		t.Errorf("public relay = %q with no relay configured", cfg.LeetifyPublicRelayURL)
	}
}
