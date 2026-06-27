package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"cloud.google.com/go/compute/metadata"
	"golang.org/x/oauth2/google"
)

// Vertex talks to Vertex AI (Gemini) using Application Default Credentials, so
// on a GCE VM it authenticates with the instance's service account — no API key
// and no separate bill (usage goes to the GCP project). The SA needs the
// "Vertex AI User" role and the aiplatform.googleapis.com API enabled.
type Vertex struct {
	project  string
	location string
	model    string
	http     *http.Client
}

func NewVertex(project, location, model string) *Vertex {
	if location == "" {
		location = "us-central1"
	}
	if model == "" {
		model = "gemini-2.0-flash-001"
	}
	// On GCE the project can be read from the metadata server, so the operator
	// doesn't have to set it explicitly.
	if project == "" && metadata.OnGCE() {
		if p, err := metadata.ProjectIDWithContext(context.Background()); err == nil {
			project = p
		}
	}
	return &Vertex{project: project, location: location, model: model, http: &http.Client{Timeout: 40 * time.Second}}
}

func (v *Vertex) Configured() bool { return v != nil && v.project != "" }

func (v *Vertex) Analyze(ctx context.Context, system, user string) (string, error) {
	if !v.Configured() {
		return "", ErrNotConfigured
	}
	ts, err := google.DefaultTokenSource(ctx, "https://www.googleapis.com/auth/cloud-platform")
	if err != nil {
		return "", fmt.Errorf("ai: vertex credentials: %w", err)
	}
	tok, err := ts.Token()
	if err != nil {
		return "", fmt.Errorf("ai: vertex token: %w", err)
	}

	payload, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []map[string]string{{"text": system}}},
		"contents":          []map[string]any{{"role": "user", "parts": []map[string]string{{"text": user}}}},
		"generationConfig":  map[string]any{"maxOutputTokens": 700, "temperature": 0.4},
	})
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google/models/%s:generateContent",
		v.location, v.project, v.location, v.model,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+tok.AccessToken)

	resp, err := v.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ai: vertex responded %d: %s", resp.StatusCode, snippet(body))
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	var text string
	for _, c := range out.Candidates {
		for _, p := range c.Content.Parts {
			text += p.Text
		}
	}
	return text, nil
}

func snippet(b []byte) string {
	const max = 240
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}
