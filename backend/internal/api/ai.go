package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/cs2tracker/server/internal/ai"
)

const aiSystemPrompt = `You are a sharp, fair CS2 analyst. You are given one player's match stats, aim tells, tactical tendencies (positioning/rotations/site preference from their movement), and account signals. Write a SHORT read (4-6 sentences) covering TWO things:
1. Playstyle & tendencies — their role and how they play (e.g. entry vs lurker, takes space vs seeks contact, rotates a lot vs anchors, predictable site/route), with one concrete, actionable observation (e.g. "exploitable — almost always B on T-side").
2. Integrity — whether anything looks anomalous (cheating, smurfing, boosted), weighing evidence both ways and citing the specific stats that drive it. Remember a high frag count is NOT itself suspicious; only aim-quality anomalies (snap kills, accuracy, reaction) are.
Lead with the playstyle read and end with a one-line verdict (e.g. "Aggressive entry — looks legit", "Worth reviewing for aim", "Likely smurf"). Never state cheating as fact — these are public stats, not proof. Be concrete and do NOT invent data that wasn't provided.`

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
// read. Prefers Vertex AI (Gemini, keyless on GCE) and falls back to Anthropic.
// Gated + rate-limited; reports cleanly when no provider is configured.
func (s *Server) handleAiAnalyze(w http.ResponseWriter, r *http.Request) {
	var client ai.Provider = ai.NewVertex(s.cfg.VertexProject, s.cfg.VertexLocation, s.cfg.VertexModel)
	if !client.Configured() {
		client = ai.NewAnthropic(s.cfg.AnthropicAPIKey, s.cfg.AnthropicModel)
	}
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
		// Log the full error (incl. any upstream body) server-side, but return a
		// body-free message to the client: for a provider HTTP error, the provider
		// + status (the diagnostic bit) so the operator can act; otherwise generic.
		s.log.Error("ai analyze", "err", err)
		msg := "AI provider error — see server logs"
		var pe *ai.ProviderError
		if errors.As(err, &pe) {
			msg = "AI provider error — " + pe.ClientMessage()
		}
		writeError(w, http.StatusBadGateway, msg)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}
