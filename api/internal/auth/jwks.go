// Package auth verifies Better Auth-issued JWTs offline against its JWKS endpoint.
//
// No database lookup happens on the hot auth path. Tokens are self-contained; the
// JWKS is cached and refetched only when an unknown `kid` shows up.
//
// Trust boundary: this package is the only place a request's identity is established.
// Everything downstream reads the Principal that lands in the context.
package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Principal is the verified identity behind a request.
type Principal struct {
	UserID      string
	SessionID   string
	WorkspaceID string
	Email       string
}

type ctxKey struct{}

// With attaches a Principal to a context.
func With(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// From retrieves the Principal. Returns nil when the request is unauthenticated.
func From(ctx context.Context) *Principal {
	p, _ := ctx.Value(ctxKey{}).(*Principal)
	return p
}

// ErrUnauthenticated is returned for a missing, malformed or unverifiable token.
// Handlers map this to 401; never to 403, which would leak whether a token exists.
var ErrUnauthenticated = errors.New("unauthenticated")

type jwk struct {
	KeyType string `json:"kty"`
	Curve   string `json:"crv"`
	X       string `json:"x"`
	KID     string `json:"kid"`
	Use     string `json:"use"`
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

// Verifier caches the JWKS and validates tokens against it.
type Verifier struct {
	url    string
	issuer string
	client *http.Client

	mu      sync.RWMutex
	keys    map[string]ed25519.PublicKey
	fetched time.Time
}

const jwksMaxAge = 1 * time.Hour

// NewVerifier builds a verifier for a JWKS endpoint.
func NewVerifier(jwksURL, issuer string) *Verifier {
	return &Verifier{
		url:    jwksURL,
		issuer: issuer,
		client: &http.Client{Timeout: 5 * time.Second},
		keys:   map[string]ed25519.PublicKey{},
	}
}

// claims is the subset of the Better Auth JWT we rely on. Workspace membership comes
// from a custom claim added by the jwt plugin's definePayload.
type claims struct {
	jwt.RegisteredClaims
	Email       string `json:"email"`
	WorkspaceID string `json:"workspace_id"`
	SessionID   string `json:"sid"`
}

// Verify parses and validates a bearer token.
func (v *Verifier) Verify(ctx context.Context, tokenString string) (*Principal, error) {
	claims := &claims{}

	_, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return v.key(ctx, kid)
	},
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnauthenticated, err)
	}

	if claims.WorkspaceID == "" {
		// A token with no active workspace is valid but useless for tenant data.
		// 401 rather than 403: the client fixes it by calling setActive().
		return nil, fmt.Errorf("%w: token carries no active workspace", ErrUnauthenticated)
	}

	return &Principal{
		UserID:      claims.Subject,
		SessionID:   claims.SessionID,
		WorkspaceID: claims.WorkspaceID,
		Email:       claims.Email,
	}, nil
}

// key resolves a signing key, refreshing the cache once on an unknown kid so that
// JWKS rotation does not log everyone out.
func (v *Verifier) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	v.mu.RLock()
	k, ok := v.keys[kid]
	fresh := time.Since(v.fetched) < jwksMaxAge
	v.mu.RUnlock()

	if ok && fresh {
		return k, nil
	}

	// Either the cache is stale, or this is an unknown kid — which usually means the
	// key rotated. Both resolve with a single refresh.
	if err := v.refresh(ctx); err != nil {
		if ok {
			return k, nil // a refresh failure should not log everyone out
		}
		return nil, fmt.Errorf("%w: fetch jwks: %v", ErrUnauthenticated, err)
	}

	v.mu.RLock()
	defer v.mu.RUnlock()
	k, ok = v.keys[kid]
	if !ok {
		return nil, fmt.Errorf("%w: unknown kid %q", ErrUnauthenticated, kid)
	}
	return k, nil
}

func (v *Verifier) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.url, nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks: unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}

	var set jwkSet
	if err := json.Unmarshal(body, &set); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}

	keys := make(map[string]ed25519.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if k.KeyType != "OKP" || k.Curve != "Ed25519" || k.Use == "enc" {
			continue
		}
		raw, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			continue // not a signing key we can use; skip rather than fail the whole set
		}
		keys[k.KID] = ed25519.PublicKey(raw)
	}

	if len(keys) == 0 {
		return errors.New("jwks contained no usable Ed25519 signing keys")
	}

	v.mu.Lock()
	v.keys = keys
	v.fetched = time.Now()
	v.mu.Unlock()
	return nil
}
