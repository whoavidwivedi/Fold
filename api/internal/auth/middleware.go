package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// Middleware verifies the bearer token and attaches a Principal.
//
// Applied per-operation rather than globally so /health and the OpenAPI document stay
// reachable without a token — that document is the contract an agent reads, and
// requiring auth for it would defeat the purpose.
//
// A middleware cannot return a huma.StatusError, so failures are written directly as
// RFC 9457 problem documents, the same shape Huma emits for handler errors.
func Middleware(v *Verifier) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		header := ctx.Header("Authorization")

		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || strings.TrimSpace(token) == "" {
			unauthorized(ctx, "missing bearer token")
			return
		}

		principal, err := v.Verify(ctx.Context(), strings.TrimSpace(token))
		if err != nil {
			// The reason is deliberately not echoed. Distinguishing "expired" from "bad
			// signature" from "no workspace" tells an attacker which tokens exist.
			unauthorized(ctx, "invalid or expired token")
			return
		}

		next(huma.WithValue(ctx, ctxKey{}, principal))
	}
}

func unauthorized(ctx huma.Context, detail string) {
	ctx.SetHeader("WWW-Authenticate", `Bearer realm="fold"`)
	ctx.SetHeader("Content-Type", "application/problem+json")
	ctx.SetStatus(http.StatusUnauthorized)
	_ = json.NewEncoder(ctx.BodyWriter()).Encode(map[string]any{
		"type":   "about:blank",
		"title":  "Unauthorized",
		"status": http.StatusUnauthorized,
		"detail": detail,
	})
}

// PrincipalFrom pulls the verified identity off a request context.
//
// A nil result means the route was registered without Middleware — a wiring bug, not a
// user error. Callers treat it as 500 so it surfaces loudly instead of looking like an
// auth problem.
func PrincipalFrom(ctx context.Context) *Principal {
	return From(ctx)
}
