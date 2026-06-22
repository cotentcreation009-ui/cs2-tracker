package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cs2tracker/server/internal/config"
	"github.com/cs2tracker/server/internal/db"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/steam"
)

// fakeStore implements Store for handler tests. Each method delegates to an
// optional func field, defaulting to "not found" / empty so a test only sets
// what it needs.
type fakeStore struct {
	profile  func(uint64) (models.PlayerProfile, error)
	matches  func(uint64, int, int) ([]models.PlayerMatchSummary, error)
	matchDet func(int64) (models.MatchDetail, error)
	weapons  func(uint64, int) ([]models.WeaponStat, error)
	maps     func(uint64) ([]models.MapStat, error)
	top      func(int) ([]models.LeaderboardEntry, error)
	kills    func(int64) ([]models.Kill, error)
	job      func(string) (models.IngestJob, error)
	ping     func() error
	count    func(uint64) (int, error)
}

func (f *fakeStore) CountPlayerMatches(_ context.Context, id uint64) (int, error) {
	if f.count != nil {
		return f.count(id)
	}
	return 0, nil
}

func (f *fakeStore) Ping(context.Context) error {
	if f.ping != nil {
		return f.ping()
	}
	return nil
}

func (f *fakeStore) GetProfile(_ context.Context, id uint64) (models.PlayerProfile, error) {
	if f.profile != nil {
		return f.profile(id)
	}
	return models.PlayerProfile{}, db.ErrNotFound
}
func (f *fakeStore) UpsertPlayer(context.Context, models.Player) error { return nil }
func (f *fakeStore) ListPlayerMatches(_ context.Context, id uint64, l, o int) ([]models.PlayerMatchSummary, error) {
	if f.matches != nil {
		return f.matches(id, l, o)
	}
	return nil, nil
}
func (f *fakeStore) GetMatchDetail(_ context.Context, id int64) (models.MatchDetail, error) {
	if f.matchDet != nil {
		return f.matchDet(id)
	}
	return models.MatchDetail{}, db.ErrNotFound
}
func (f *fakeStore) GetWeaponStats(_ context.Context, id uint64, l int) ([]models.WeaponStat, error) {
	if f.weapons != nil {
		return f.weapons(id, l)
	}
	return nil, nil
}
func (f *fakeStore) GetMapStats(_ context.Context, id uint64) ([]models.MapStat, error) {
	if f.maps != nil {
		return f.maps(id)
	}
	return nil, nil
}
func (f *fakeStore) ListTopPlayers(_ context.Context, l int) ([]models.LeaderboardEntry, error) {
	if f.top != nil {
		return f.top(l)
	}
	return nil, nil
}
func (f *fakeStore) ListMatchKills(_ context.Context, id int64) ([]models.Kill, error) {
	if f.kills != nil {
		return f.kills(id)
	}
	return nil, nil
}
func (f *fakeStore) InsertJob(context.Context, models.IngestJob) error { return nil }
func (f *fakeStore) GetJob(_ context.Context, id string) (models.IngestJob, error) {
	if f.job != nil {
		return f.job(id)
	}
	return models.IngestJob{}, db.ErrNotFound
}

func routerWith(store Store) http.Handler {
	cfg := &config.Config{CORSOrigins: []string{"*"}}
	s := NewServer(cfg, store, steam.New(""), nil, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return s.Router()
}

func doGET(h http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestHandleProfileFound(t *testing.T) {
	store := &fakeStore{profile: func(id uint64) (models.PlayerProfile, error) {
		return models.PlayerProfile{
			Player: models.Player{SteamID64: id, PersonaName: "neo"},
			Career: models.PlayerCareer{Matches: 10, Rating: 1.23},
		}, nil
	}}
	w := doGET(routerWith(store), "/api/players/76561198000000001")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	var prof models.PlayerProfile
	if err := json.Unmarshal(w.Body.Bytes(), &prof); err != nil {
		t.Fatal(err)
	}
	if prof.Player.PersonaName != "neo" || prof.Career.Rating != 1.23 {
		t.Errorf("unexpected: %+v", prof)
	}
	if prof.Player.SteamID64 != 76561198000000001 {
		t.Errorf("steamID not round-tripped: %d", prof.Player.SteamID64)
	}
}

func TestHandleProfileNotFound(t *testing.T) {
	// store returns ErrNotFound; no Steam key, so hydration fails -> 404.
	w := doGET(routerWith(&fakeStore{}), "/api/players/76561198000000001")
	if w.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", w.Code)
	}
}

func TestHandleProfileBadID(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/api/players/notanid")
	if w.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", w.Code)
	}
}

func TestHandleLeaderboard(t *testing.T) {
	store := &fakeStore{top: func(int) ([]models.LeaderboardEntry, error) {
		return []models.LeaderboardEntry{{SteamID64: 76561198000000001, PersonaName: "a", Rating: 1.3}}, nil
	}}
	w := doGET(routerWith(store), "/api/leaderboard")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d", w.Code)
	}
	var resp struct {
		Players []models.LeaderboardEntry `json:"players"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Players) != 1 || resp.Players[0].PersonaName != "a" {
		t.Errorf("unexpected: %+v", resp.Players)
	}
}

func TestHandlePlayerMatchesTotal(t *testing.T) {
	store := &fakeStore{
		matches: func(uint64, int, int) ([]models.PlayerMatchSummary, error) {
			return []models.PlayerMatchSummary{{}, {}}, nil // 2 on this page
		},
		count: func(uint64) (int, error) { return 25, nil }, // 25 overall
	}
	w := doGET(routerWith(store), "/api/players/76561198000000001/matches?limit=2")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d", w.Code)
	}
	var resp struct {
		Matches []models.PlayerMatchSummary `json:"matches"`
		Total   int                         `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Matches) != 2 || resp.Total != 25 {
		t.Errorf("matches=%d total=%d, want 2 and 25", len(resp.Matches), resp.Total)
	}
}

func TestHandleMatchNotFound(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/api/matches/5")
	if w.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", w.Code)
	}
}

func TestHandleWeaponsEmptyArray(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/api/players/76561198000000001/weapons")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d", w.Code)
	}
	var resp struct {
		Weapons []models.WeaponStat `json:"weapons"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Weapons == nil {
		t.Error("weapons should serialise as [] not null")
	}
}

func TestHandleJob(t *testing.T) {
	mid := int64(7)
	store := &fakeStore{job: func(id string) (models.IngestJob, error) {
		return models.IngestJob{ID: id, Status: "done", MatchID: &mid}, nil
	}}
	w := doGET(routerWith(store), "/api/jobs/abc")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d", w.Code)
	}
	var j models.IngestJob
	if err := json.Unmarshal(w.Body.Bytes(), &j); err != nil {
		t.Fatal(err)
	}
	if j.ID != "abc" || j.Status != "done" || j.MatchID == nil || *j.MatchID != 7 {
		t.Errorf("unexpected job: %+v", j)
	}
}

func TestHandleJobNotFound(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/api/jobs/zzz")
	if w.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", w.Code)
	}
}

func TestHealthDBOK(t *testing.T) {
	w := doGET(routerWith(&fakeStore{}), "/api/health")
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", w.Code)
	}
	var s map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	if s["database"] != "ok" || s["status"] != "ok" {
		t.Errorf("unexpected health: %+v", s)
	}
}

func TestHealthDBDown(t *testing.T) {
	store := &fakeStore{ping: func() error { return errors.New("connection refused") }}
	w := doGET(routerWith(store), "/api/health")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("code = %d, want 503 when DB is down", w.Code)
	}
}
