//go:build devtool

// Command devjwt is a local-only helper that serves a JWKS and mints signed JWTs, so the
// Go API can be exercised end to end before Better Auth is wired up.
//
// Behind a `devtool` build tag, so it is never compiled into the shipped binary.
//
//	DEV_WORKSPACES='<uuid>:<userUuid>,<uuid>:<userUuid>' go run -tags devtool ./cmd/devjwt
//
// Comma-separated workspace:user pairs. All tokens share one keypair, so a single
// running instance can stand in for several tenants — which is what proves tenant
// isolation at the API layer rather than only in the test suite.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const issuer = "http://localhost:3000"

func main() {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	must(err)

	jwks, err := json.Marshal(map[string]any{
		"keys": []map[string]string{{
			"kty": "OKP", "crv": "Ed25519", "kid": "dev-key",
			"use": "sig", "alg": "EdDSA",
			"x": base64.RawURLEncoding.EncodeToString(pub),
		}},
	})
	must(err)

	pairs := os.Getenv("DEV_WORKSPACES")
	if pairs == "" {
		fmt.Fprintln(os.Stderr, `set DEV_WORKSPACES='<workspaceUuid>:<userUuid>,...'`)
		os.Exit(1)
	}

	fmt.Fprintln(os.Stderr, "JWKS:")
	fmt.Fprintln(os.Stderr, string(jwks))
	fmt.Fprintln(os.Stderr)

	for _, pair := range strings.Split(pairs, ",") {
		workspace, user, ok := strings.Cut(strings.TrimSpace(pair), ":")
		if !ok {
			continue
		}

		claims := jwt.MapClaims{
			"iss":          issuer,
			"sub":          user,
			"workspace_id": workspace,
			"sid":          "dev-session",
			"iat":          time.Now().Unix(),
			"exp":          time.Now().Add(30 * time.Minute).Unix(),
		}

		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "dev-key"

		signed, err := token.SignedString(priv)
		must(err)

		fmt.Fprintf(os.Stderr, "TOKEN workspace=%s\n%s\n\n", workspace, signed)
	}

	fmt.Fprintln(os.Stderr, "serving JWKS on :3000/api/auth/jwks")
	must(http.ListenAndServe(":3000", jwksHandler(jwks)))
}

func jwksHandler(body []byte) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/jwks", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
	return mux
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
