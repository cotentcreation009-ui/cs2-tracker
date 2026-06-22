// Package session verifies the HMAC-signed "Sign in through Steam" session token
// that the frontend issues (see frontend/lib/session.ts). The backend is not
// browser-reachable, so the Next.js proxy forwards this token on authenticated
// requests; verifying it here — rather than trusting a plaintext SteamID header —
// means identity is cryptographically established with a shared secret.
//
// Token format (matches the frontend exactly):
//
//	base64url(JSON{steamId64,personaName,avatarUrl,iat}) "." base64url(HMAC_SHA256(body, secret))
//
// base64url is RFC 4648 url-safe, unpadded (Node's "base64url" / Go's RawURLEncoding).
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/cs2tracker/server/internal/steam"
)

// maxAgeSeconds mirrors the frontend cookie lifetime; older tokens are rejected.
const maxAgeSeconds = 60 * 60 * 24 * 30 // 30 days

type payload struct {
	SteamID64 string `json:"steamId64"`
	IAT       int64  `json:"iat"` // issued-at, unix seconds
}

// Verify checks a session token and returns the SteamID64 it carries. ok is
// false when the token is missing, malformed, has a bad signature, is expired,
// or carries an invalid SteamID64.
func Verify(token, secret string) (uint64, bool) {
	return verifyAt(token, secret, time.Now())
}

func verifyAt(token, secret string, now time.Time) (uint64, bool) {
	if token == "" || secret == "" {
		return 0, false
	}
	// Signature covers everything before the final dot.
	dot := strings.LastIndex(token, ".")
	if dot <= 0 || dot >= len(token)-1 {
		return 0, false
	}
	body, sig := token[:dot], token[dot+1:]

	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return 0, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	if !hmac.Equal(sigBytes, mac.Sum(nil)) {
		return 0, false
	}

	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return 0, false
	}
	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return 0, false
	}
	if p.IAT > 0 && now.Unix()-p.IAT > maxAgeSeconds {
		return 0, false
	}
	return steam.ParseSteamID64(p.SteamID64)
}

// Encode mints a token in the same format the frontend issues. The backend does
// not set the cookie (the frontend owns login); this exists for round-trip tests
// and any future server-side minting.
func Encode(steamID64, secret string) string {
	raw, _ := json.Marshal(payload{SteamID64: steamID64, IAT: time.Now().Unix()})
	body := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
