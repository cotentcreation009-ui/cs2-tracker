package worker

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/cs2tracker/server/internal/demosource"
	"github.com/cs2tracker/server/internal/models"
	"github.com/cs2tracker/server/internal/queue"
)

type statusCall struct {
	status  string
	matchID *int64
	errMsg  string
}

type fakeStore struct {
	statuses  []statusCall
	matchID   int64
	insertErr error
}

func (f *fakeStore) InsertParsedMatch(context.Context, *models.ParsedMatch) (int64, error) {
	if f.insertErr != nil {
		return 0, f.insertErr
	}
	return f.matchID, nil
}

func (f *fakeStore) SetJobStatus(_ context.Context, _ string, status string, matchID *int64, errMsg string) error {
	f.statuses = append(f.statuses, statusCall{status, matchID, errMsg})
	return nil
}

func testWorker(store Store, resolve Resolver, parse ParseFunc) *Worker {
	return &Worker{
		Store:         store,
		Resolve:       resolve,
		Parse:         parse,
		WorkDir:       "/tmp",
		DeleteRawDemo: true,
		JobTimeout:    time.Minute,
		Log:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

// okResolve returns a path without marking it downloaded, so no real file is
// touched for cleanup.
func okResolve(context.Context, queue.Job, string) (demosource.Resolved, error) {
	return demosource.Resolved{Path: "match.dem", Downloaded: false}, nil
}

func TestProcessSuccess(t *testing.T) {
	fs := &fakeStore{matchID: 42}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{Players: []models.MatchPlayer{{SteamID64: 1}}}, nil
	})

	w.Process(context.Background(), &queue.Job{ID: "j1", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 {
		t.Fatalf("expected running+done, got %+v", fs.statuses)
	}
	if fs.statuses[0].status != models.JobRunning {
		t.Errorf("first status = %q, want running", fs.statuses[0].status)
	}
	if fs.statuses[1].status != models.JobDone || fs.statuses[1].matchID == nil || *fs.statuses[1].matchID != 42 {
		t.Errorf("final status = %+v, want done(42)", fs.statuses[1])
	}
}

func TestProcessParseFailure(t *testing.T) {
	fs := &fakeStore{}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return nil, errors.New("corrupt demo")
	})

	w.Process(context.Background(), &queue.Job{ID: "j2", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 || fs.statuses[1].status != models.JobFailed {
		t.Fatalf("expected running+failed, got %+v", fs.statuses)
	}
	if fs.statuses[1].errMsg == "" {
		t.Error("failed status should carry an error message")
	}
}

func TestProcessResolveFailure(t *testing.T) {
	fs := &fakeStore{}
	w := testWorker(fs,
		func(context.Context, queue.Job, string) (demosource.Resolved, error) {
			return demosource.Resolved{}, errors.New("no such file")
		},
		func(string) (*models.ParsedMatch, error) {
			t.Fatal("parser must not run when resolve fails")
			return nil, nil
		})

	w.Process(context.Background(), &queue.Job{ID: "j3", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 || fs.statuses[1].status != models.JobFailed {
		t.Errorf("expected running+failed, got %+v", fs.statuses)
	}
}

func TestProcessInsertFailure(t *testing.T) {
	fs := &fakeStore{insertErr: errors.New("db down")}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{}, nil
	})

	w.Process(context.Background(), &queue.Job{ID: "j5", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 || fs.statuses[1].status != models.JobFailed {
		t.Errorf("expected running+failed on persist error, got %+v", fs.statuses)
	}
}

func TestProcessUnknownType(t *testing.T) {
	fs := &fakeStore{}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{}, nil
	})

	w.Process(context.Background(), &queue.Job{ID: "j4", Type: "bogus"})

	if len(fs.statuses) != 1 || fs.statuses[0].status != models.JobFailed {
		t.Errorf("expected a single failed status, got %+v", fs.statuses)
	}
}
