package auth

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

// Stream tokens solve a specific problem: the browser's EventSource cannot set an
// Authorization header, and we are not putting a long-lived JWT in a query string
// where it lands in every access log.
//
// The browser exchanges its JWT for one of these — 60 seconds, scoped to a single
// workspace, HMAC-signed so it is verifiable with no database lookup.
//
// ponytail: NOT single-use, because that needs a table and a delete. The token is only
// mintable by an already-authenticated principal and dies in 60 seconds, so the
// single-use guarantee buys little. Add a table-backed nonce if the exposure ever matters.
type StreamToken struct {
	WorkspaceID string
	UserID      string
	ExpiresAt   time.Time
}

const streamTokenTTL = 60 * time.Second

func NewStreamToken(secret []byte, workspaceID, userID string) (string, time.Time, error) {
	expires := time.Now().Add(streamTokenTTL)

	payload := strings.Join([]string{
		workspaceID,
		userID,
		fmt.Sprintf("%d", expires.Unix()),
	}, ".")

	encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return encoded + "." + sign(secret, encoded), expires, nil
}

// ParseStreamToken verifies the signature and expiry.
func ParseStreamToken(secret []byte, token string) (*StreamToken, error) {
	encoded, sig, ok := strings.Cut(token, ".")
	if !ok {
		return nil, fmt.Errorf("malformed stream token")
	}
	if !constantTimeEqual(sign(secret, encoded), sig) {
		return nil, fmt.Errorf("bad stream token signature")
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("malformed stream token payload")
	}

	parts := strings.Split(string(raw), ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed stream token payload")
	}

	var expires int64
	if _, err := fmt.Sscanf(parts[2], "%d", &expires); err != nil {
		return nil, fmt.Errorf("malformed stream token expiry")
	}
	if time.Now().Unix() > expires {
		return nil, fmt.Errorf("stream token expired")
	}

	return &StreamToken{WorkspaceID: parts[0], UserID: parts[1], ExpiresAt: time.Unix(expires, 0)}, nil
}
