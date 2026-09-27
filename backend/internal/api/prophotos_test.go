package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The report is unauthenticated, so the URL check IS the security: only a
// Liquipedia image, and nothing that could be made to load something else.
func TestValidProPhotoURL(t *testing.T) {
	ok := []string{
		"https://liquipedia.net/commons/images/thumb/a/ab/TN1R_at_IEM_Cologne_2026.jpg/256px-TN1R_at_IEM_Cologne_2026.jpg",
		"https://liquipedia.net/commons/images/a/ab/Zont1x_at_BLAST_Bounty_Winter_2026.jpg",
		"https://liquipedia.net/commons/images/3/3f/Xelex_at_PGL_Astana_2026.PNG",
	}
	for _, u := range ok {
		if !validProPhotoURL(u) {
			t.Errorf("rejected a Liquipedia photo: %s", u)
		}
	}
	bad := []string{
		"",
		"http://liquipedia.net/commons/images/a/ab/X.jpg",                            // not https
		"https://liquipedia.net.evil.example/commons/images/a/ab/X.jpg",              // lookalike host
		"https://evil.example/commons/images/a/ab/X.jpg",                             // wrong host
		"https://liquipedia.net/counterstrike/Donk",                                  // not an image path
		"https://liquipedia.net/commons/images/a/ab/X.svg",                           // not a raster photo
		"https://liquipedia.net/commons/images/a/ab/X.jpg?x=1",                       // query
		"https://liquipedia.net/commons/images/a/ab/X.jpg#frag",                      // fragment
		"https://user:pw@liquipedia.net/commons/images/a/ab/X.jpg",                   // credentials
		"https://liquipedia.net/commons/images/../../etc/passwd.jpg",                 // traversal
		"https://liquipedia.net/commons/images/" + strings.Repeat("a", 400) + ".jpg", // overlong
	}
	for _, u := range bad {
		if validProPhotoURL(u) {
			t.Errorf("accepted a non-photo: %s", u)
		}
	}
	for _, n := range []string{"donk", "tN1R", "-SYPHO", "911", "El Cabrón"} {
		if !validProPhotoNick(n) {
			t.Errorf("rejected nick %q", n)
		}
	}
	for _, n := range []string{"", "  ", "a|b", "x#y", "<b>", "ctl\x01", strings.Repeat("n", 41)} {
		if validProPhotoNick(n) {
			t.Errorf("accepted nick %q", n)
		}
	}
}

// A browser's report lands in the store, the junk in it does not, and the
// spotlight's crowd cache is what the store gives back.
func TestProPhotoReportStoresTheAcceptableOnes(t *testing.T) {
	store := &fakeStore{}
	r := routerWith(store)
	body := `{"photos":[
		{"nick":"tN1R","url":"https://liquipedia.net/commons/images/thumb/a/ab/TN1R_at_IEM_Cologne_2026.jpg/256px-TN1R_at_IEM_Cologne_2026.jpg"},
		{"nick":"zont1x","url":"https://evil.example/x.jpg"},
		{"nick":"","url":"https://liquipedia.net/commons/images/a/ab/X.jpg"},
		{"nick":" donk ","url":"https://liquipedia.net/commons/images/a/ab/Donk_at_IEM_Cologne_2026.jpg"}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/api/pro-matches/photos", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var out map[string]int
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out["accepted"] != 2 {
		t.Fatalf("accepted = %d, want 2 (the evil host and the empty nick refused)", out["accepted"])
	}
	if len(store.photos) != 2 || store.photos[0].Nick != "tN1R" || store.photos[1].Nick != "donk" {
		t.Fatalf("stored %+v", store.photos)
	}

	known, _ := store.ProPhotos(req.Context(), []string{"TN1R", "Donk", "s1mple"})
	if known["tn1r"] == "" || known["donk"] == "" || known["s1mple"] != "" {
		t.Fatalf("crowd cache = %v", known)
	}

	// Nothing acceptable is a 400, not a silent 200.
	req = httptest.NewRequest(http.MethodPost, "/api/pro-matches/photos", strings.NewReader(`{"photos":[{"nick":"x","url":"https://evil.example/x.jpg"}]}`))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("junk-only report => %d, want 400", w.Code)
	}
	// And an empty or oversized batch too.
	req = httptest.NewRequest(http.MethodPost, "/api/pro-matches/photos", strings.NewReader(`{"photos":[]}`))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("empty report => %d, want 400", w.Code)
	}
}

func TestProPhotoReportsAreCappedPerAddress(t *testing.T) {
	now := time.Now()
	for i := 0; i < proPhotoReportsPerIP; i++ {
		if !proPhotoAllow("203.0.113.9", now) {
			t.Fatalf("report %d refused under the cap", i)
		}
	}
	if proPhotoAllow("203.0.113.9", now) {
		t.Error("the cap did not hold")
	}
	if !proPhotoAllow("203.0.113.10", now) {
		t.Error("another address must not share the cap")
	}
	if !proPhotoAllow("203.0.113.9", now.Add(2*time.Hour)) {
		t.Error("the window must slide")
	}
}
