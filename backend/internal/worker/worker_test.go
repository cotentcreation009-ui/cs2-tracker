package worker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
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
	mu        sync.Mutex
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
	f.mu.Lock()
	defer f.mu.Unlock()
	f.statuses = append(f.statuses, statusCall{status, matchID, errMsg})
	return nil
}

func (f *fakeStore) countStatus(status string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, s := range f.statuses {
		if s.status == status {
			n++
		}
	}
	return n
}

type fakeQueue struct{ ch chan *queue.Job }

func (f *fakeQueue) Dequeue(ctx context.Context, _ time.Duration) (*queue.Job, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case j := <-f.ch:
		return j, nil
	}
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

	w.Process(&queue.Job{ID: "j1", Type: queue.JobParseDemo})

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

	w.Process(&queue.Job{ID: "j2", Type: queue.JobParseDemo})

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

	w.Process(&queue.Job{ID: "j3", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 || fs.statuses[1].status != models.JobFailed {
		t.Errorf("expected running+failed, got %+v", fs.statuses)
	}
}

func TestProcessInsertFailure(t *testing.T) {
	fs := &fakeStore{insertErr: errors.New("db down")}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{}, nil
	})

	w.Process(&queue.Job{ID: "j5", Type: queue.JobParseDemo})

	if len(fs.statuses) != 2 || fs.statuses[1].status != models.JobFailed {
		t.Errorf("expected running+failed on persist error, got %+v", fs.statuses)
	}
}

func TestProcessUnknownType(t *testing.T) {
	fs := &fakeStore{}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{}, nil
	})

	w.Process(&queue.Job{ID: "j4", Type: "bogus"})

	if len(fs.statuses) != 1 || fs.statuses[0].status != models.JobFailed {
		t.Errorf("expected a single failed status, got %+v", fs.statuses)
	}
}

func TestRunProcessesAllJobs(t *testing.T) {
	const n = 12
	fs := &fakeStore{matchID: 1}
	w := testWorker(fs, okResolve, func(string) (*models.ParsedMatch, error) {
		return &models.ParsedMatch{}, nil
	})

	fq := &fakeQueue{ch: make(chan *queue.Job, n)}
	for i := 0; i < n; i++ {
		fq.ch <- &queue.Job{ID: fmt.Sprintf("j%d", i), Type: queue.JobParseDemo}
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx, fq, 4); close(done) }()

	deadline := time.After(5 * time.Second)
	for fs.countStatus(models.JobDone) < n {
		select {
		case <-deadline:
			cancel()
			t.Fatalf("only %d/%d jobs done before timeout", fs.countStatus(models.JobDone), n)
		case <-time.After(5 * time.Millisecond):
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
	if got := fs.countStatus(models.JobDone); got != n {
		t.Errorf("done count = %d, want %d", got, n)
	}
}
