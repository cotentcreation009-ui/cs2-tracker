package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

const (
	testSecret = "cs2-tracker-dev-session-secret-change-me"
	testID     = "76561198000000001"
)

func TestVerifyRoundTrip(t *testing.T) {
	id, ok := Verify(Encode(testID, testSecret), testSecret)
	if !ok {
		t.Fatal("valid token rejected")
	}
	if id != 76561198000000001 {
		t.Errorf("id = %d, want 76561198000000001", id)
	}
}

func TestVerifyRejects(t *testing.T) {
	good := Encode(testID, testSecret)
	cases := map[string]string{
		"empty":         "",
		"no dot":        "abcdef",
		"trailing dot":  "abcdef.",
		"leading dot":   ".abcdef",
		"bad signature": good[:len(good)-2] + "AA",
		"garbage body":  "!!!." + good[len(good)-43:],
	}
	for name, tok := range cases {
		t.Run(name, func(t *testing.T) {
			if _, ok := Verify(tok, testSecret); ok {
				t.Errorf("token %q should be rejected", tok)
			}
		})
	}
}

// TestVerifyFrontendGoldenToken pins cross-language compatibility: this token
// was minted by the frontend's lib/session.ts algorithm (Node base64url + HMAC)
// for SteamID64 76561198000000001 with the dev secret and iat=1700000000. If Go
// and Node ever disagree on the encoding, this fails. verifyAt pins "now" near
// the issue time so the (real) expiry check doesn't reject the fixed timestamp.
func TestVerifyFrontendGoldenToken(t *testing.T) {
	const golden = "eyJzdGVhbUlkNjQiOiI3NjU2MTE5ODAwMDAwMDAwMSIsInBlcnNvbmFOYW1lIjoiIiwiYXZhdGFyVXJsIjoiIiwiaWF0IjoxNzAwMDAwMDAwfQ.6rFbI0eO1bXNqpgjxJNO_Sq365Ug5olVFktOzGJ797o"
	id, ok := verifyAt(golden, testSecret, time.Unix(1700000000+3600, 0))
	if !ok {
		t.Fatal("frontend-minted token rejected by Go verifier")
	}
	if id != 76561198000000001 {
		t.Errorf("id = %d, want 76561198000000001", id)
	}
}

func TestVerifyWrongSecret(t *testing.T) {
	if _, ok := Verify(Encode(testID, testSecret), "different-secret"); ok {
		t.Error("token verified under the wrong secret")
	}
}

func TestVerifyEmptySecret(t *testing.T) {
	if _, ok := Verify(Encode(testID, testSecret), ""); ok {
		t.Error("empty secret must never verify")
	}
}

func TestVerifyExpired(t *testing.T) {
	tok := Encode(testID, testSecret)
	future := time.Now().Add((maxAgeSeconds + 60) * time.Second)
	if _, ok := verifyAt(tok, testSecret, future); ok {
		t.Error("expired token should be rejected")
	}
	// Still valid just inside the window.
	if _, ok := verifyAt(tok, testSecret, time.Now().Add(time.Hour)); !ok {
		t.Error("token within window should verify")
	}
}

func TestVerifyBadSteamID(t *testing.T) {
	// Hand-craft a correctly-signed token whose steamId64 is out of range, to
	// confirm the SteamID validation runs after signature verification.
	raw, _ := json.Marshal(payload{SteamID64: "12345", IAT: time.Now().Unix()})
	body := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(body))
	tok := body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if _, ok := Verify(tok, testSecret); ok {
		t.Error("token with invalid SteamID64 should be rejected")
	}
}
