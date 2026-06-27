package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/ai"
)

const aiSystemPrompt = `You are a fair, cautious CS2 anti-cheat analyst. Given one player's match + account stats, write a SHORT read (3-5 sentences) on whether they look like a cheater, smurf, boosted, or legit. Weigh the evidence both ways, cite the specific stats that drive your read, and end with a one-line suggestion (e.g. "Legit — elite but human", "Worth reviewing for aim", "Likely smurf"). Never state cheating as fact — these are public stats, not proof. Be concise and concrete.`

// crude per-IP limiter so AI calls (which cost money) can't be spammed.
var (
	aiMu   sync.Mutex
	aiHits = map[string][]int64{}
)

func aiAllow(ip string) bool {
	now := time.Now().Unix()
	cutoff := now - 3600
	aiMu.Lock()
	defer aiMu.Unlock()
	var hits []int64
	for _, t := range aiHits[ip] {
		if t > cutoff {
			hits = append(hits, t)
		}
	}
	if len(hits) >= 20 { // 20 per hour per IP
		aiHits[ip] = hits
		return false
	}
	aiHits[ip] = append(hits, now)
	return true
}

// handleAiAnalyze turns a client-supplied player summary into a short written
// read via the Anthropic API. Gated + rate-limited; reports cleanly when no key
// is configured.
func (s *Server) handleAiAnalyze(w http.ResponseWriter, r *http.Request) {
	client := ai.New(s.cfg.AnthropicAPIKey, s.cfg.AnthropicModel)
	if !client.Configured() {
		writeError(w, http.StatusServiceUnavailable, "AI analysis isn't configured")
		return
	}
	if !aiAllow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "AI analysis rate limit reached — try again later")
		return
	}
	var req struct {
		Summary string `json:"summary"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&req); err != nil || strings.TrimSpace(req.Summary) == "" {
		writeError(w, http.StatusBadRequest, "missing summary")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	text, err := client.Analyze(ctx, aiSystemPrompt, req.Summary)
	if err != nil {
		s.serverError(w, "ai analyze", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}
