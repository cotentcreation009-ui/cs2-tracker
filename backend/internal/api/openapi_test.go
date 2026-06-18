package api

import (
	"testing"

	"gopkg.in/yaml.v3"
)

func TestOpenAPISpecValid(t *testing.T) {
	var doc map[string]any
	if err := yaml.Unmarshal(openAPISpec, &doc); err != nil {
		t.Fatalf("openapi.yaml is not valid YAML: %v", err)
	}
	if doc["openapi"] == nil {
		t.Error("openapi version field missing")
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("paths section missing or wrong type")
	}
	// Every route the server exposes should be documented.
	for _, p := range []string{
		"/api/health",
		"/api/resolve",
		"/api/leaderboard",
		"/api/players/{steamid}",
		"/api/players/{steamid}/matches",
		"/api/players/{steamid}/weapons",
		"/api/players/{steamid}/maps",
		"/api/matches/{id}",
		"/api/matches/{id}/kills",
		"/api/ingest/demo",
		"/api/jobs/{id}",
		"/api/queue",
		"/metrics",
		"/openapi.yaml",
	} {
		if _, ok := paths[p]; !ok {
			t.Errorf("openapi paths missing %q", p)
		}
	}
}

func TestServeOpenAPI(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/openapi.yaml")
	if w.Code != 200 {
		t.Fatalf("GET /openapi.yaml = %d, want 200", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Error("empty openapi response")
	}
}
