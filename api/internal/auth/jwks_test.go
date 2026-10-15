package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// A real keypair and a real JWKS endpoint, because the whole point of this package is
// that verification happens offline against a rotating key set. Mocking that away would
// test the mock.

func TestVerifier_Verify(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	const issuer = "http://localhost:3000"
	srv := httptest.NewServer(jwksHandler(pub, "key-1"))
	defer srv.Close()

	v := NewVerifier(srv.URL, issuer)

	t.Run("accepts a valid token and reads the tenant from it", func(t *testing.T) {
		token := mint(t, priv, issuer, map[string]any{
			"workspace_id": "0f6a2b6c-1f0a-4a1e-9c2e-2b7a1d3e4f50",
			"sid":          "sess_123",
			"email":        "rep@acme.test",
		}, 5*time.Minute)

		p, err := v.Verify(context.Background(), token)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if p.UserID != "user_abc" {
			t.Errorf("UserID = %q, want user_abc", p.UserID)
		}
		if p.WorkspaceID != "0f6a2b6c-1f0a-4a1e-9c2e-2b7a1d3e4f50" {
			t.Errorf("WorkspaceID = %q", p.WorkspaceID)
		}
		if p.SessionID != "sess_123" {
			t.Errorf("SessionID = %q, want sess_123", p.SessionID)
		}
	})

	t.Run("rejects an expired token", func(t *testing.T) {
		token := mint(t, priv, issuer, map[string]any{
			"workspace_id": "ws", "sid": "s",
		}, -time.Minute)

		if _, err := v.Verify(context.Background(), token); err == nil {
			t.Fatal("expired token must not verify")
		}
	})

	t.Run("rejects a token signed by a different key", func(t *testing.T) {
		_, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
		token := mint(t, otherPriv, issuer, map[string]any{"workspace_id": "ws", "sid": "s"}, 5*time.Minute)

		if _, err := v.Verify(context.Background(), token); err == nil {
			t.Fatal("token signed by an unknown key must not verify")
		}
	})

	t.Run("rejects the wrong issuer", func(t *testing.T) {
		token := mint(t, priv, "https://evil.test", map[string]any{"workspace_id": "ws", "sid": "s"}, 5*time.Minute)

		if _, err := v.Verify(context.Background(), token); err == nil {
			t.Fatal("token from a different issuer must not verify")
		}
	})

	t.Run("rejects an alg-none token", func(t *testing.T) {
		// The classic JWT attack: strip the signature and declare alg: none.
		none := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
			"iss": issuer, "sub": "user_abc", "workspace_id": "ws",
			"exp": time.Now().Add(time.Hour).Unix(),
		})
		unsigned, err := none.SignedString(jwt.UnsafeAllowNoneSignatureType)
		if err != nil {
			t.Fatal(err)
		}

		if _, err := v.Verify(context.Background(), unsigned); err == nil {
			t.Fatal("alg=none must be rejected — ValidMethods is the only thing stopping this")
		}
	})

	t.Run("rejects a token with no active workspace", func(t *testing.T) {
		token := mint(t, priv, issuer, map[string]any{"workspace_id": "", "sid": "s"}, 5*time.Minute)

		if _, err := v.Verify(context.Background(), token); err == nil {
			t.Fatal("a token without an active workspace must not verify")
		}
	})
}

func jwksHandler(pub ed25519.PublicKey, kid string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kty": "OKP",
				"crv": "Ed25519",
				"kid": kid,
				"use": "sig",
				"alg": "EdDSA",
				"x":   base64.RawURLEncoding.EncodeToString(pub),
			}},
		})
	})
}

// mint produces a token shaped exactly like Better Auth's jwt plugin output: EdDSA,
// a `kid` header naming the signing key, and the custom workspace_id claim.
func mint(t *testing.T, priv ed25519.PrivateKey, issuer string, extra map[string]any, ttl time.Duration) string {
	t.Helper()

	claims := jwt.MapClaims{
		"iss": issuer,
		"sub": "user_abc",
		"iat": time.Now().Unix(),
	}
	for k, v := range extra {
		claims[k] = v
	}
	if _, hasExp := claims["exp"]; !hasExp {
		claims["exp"] = time.Now().Add(ttl).Unix()
	}

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = "key-1"

	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}
