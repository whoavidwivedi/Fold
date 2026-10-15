package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
)

func sign(secret []byte, payload string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// constantTimeEqual avoids leaking signature bytes through timing. Short-circuiting on
// length first is fine — the length is not a secret.
func constantTimeEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}
