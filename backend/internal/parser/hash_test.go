package parser

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHashFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x.dem")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := HashFile(p)
	if err != nil {
		t.Fatal(err)
	}
	const want = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" // sha256("hello")
	if got != want {
		t.Errorf("HashFile = %s, want %s", got, want)
	}
	if _, err := HashFile(filepath.Join(dir, "missing.dem")); err == nil {
		t.Error("expected an error hashing a missing file")
	}
}
