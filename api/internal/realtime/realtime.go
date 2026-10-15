// Package realtime serves the browser event stream.
//
// Transport is SSE, not WebSocket: we push one way only. Mutations are ordinary
// authenticated requests with optimistic UI, so there is nothing to send back over the
// socket. SSE also gets automatic reconnection from the native EventSource and is
// documented into the OpenAPI spec by Huma. See docs/adr/0004.
package realtime

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
	"github.com/google/uuid"

	"fold/api/internal/auth"
	"fold/api/internal/platform"
)

// Event is the wire format. A pointer, never a row — pg_notify caps payloads at 8000
// bytes, so the client invalidates and refetches instead of receiving the record.
type Event struct {
	Entity  string `json:"entity" doc:"Table that changed, e.g. person"`
	ID      string `json:"id" doc:"Primary key of the changed record"`
	Version int64  `json:"version,omitempty" doc:"Optimistic concurrency token"`
}

type streamInput struct {
	Token string `query:"token" doc:"Short-lived stream token from POST /v1/realtime/token"`
}

type TokenBody struct {
	Path      string    `json:"path" doc:"SSE endpoint to connect to"`
	Token     string    `json:"token" doc:"Query parameter to append"`
	ExpiresAt time.Time `json:"expiresAt" doc:"Mint another after this instant"`
}

// Huma output convention: a struct with a field literally named Body.
type TokenOutput struct {
	Body TokenBody
}

// heartbeatInterval keeps proxies from reaping an idle connection. One comment frame
// every 25 seconds, no query work.
const heartbeatInterval = 25 * time.Second

type authenticate func(huma.Context, func(huma.Context))

func Register(api huma.API, hub *platform.Hub, secret []byte, mw authenticate) {
	huma.Register(api, huma.Operation{
		OperationID: "create-stream-token",
		Method:      http.MethodPost,
		Path:        "/v1/realtime/token",
		Summary:     "Mint a short-lived SSE stream token",
		Description: "EventSource cannot send an Authorization header, so the browser exchanges its JWT for a " +
			"60-second workspace-scoped token and passes it as a query parameter. Never put a long-lived JWT in a URL, " +
			"where it would land in every access log.",
		Tags:          []string{"realtime"},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{mw},
	}, func(ctx context.Context, _ *struct{}) (*TokenOutput, error) {
		p := auth.PrincipalFrom(ctx)
		if p == nil {
			return nil, huma.Error401Unauthorized("unauthenticated")
		}

		token, expires, err := auth.NewStreamToken(secret, p.WorkspaceID, p.UserID)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not mint stream token", err)
		}

		// A relative path rather than an absolute URL: the browser already knows its own
		// origin, and this keeps the handler free of request-URL plumbing.
		return &TokenOutput{Body: TokenBody{Path: "/v1/stream", Token: token, ExpiresAt: expires}}, nil
	})

	sse.Register(api, huma.Operation{
		OperationID: "stream-events",
		Method:      http.MethodGet,
		Path:        "/v1/stream",
		Summary:     "Subscribe to workspace realtime events",
		Description: "Long-lived SSE stream of cache-invalidation hints. Clients invalidate the affected query and refetch. " +
			"Events are transient by design — after a reconnect, refetch rather than trusting state.",
		Tags: []string{"realtime"},
	}, map[string]any{
		"change": Event{},
	}, serve(hub, secret))
}

func serve(hub *platform.Hub, secret []byte) func(context.Context, *streamInput, sse.Sender) {
	return func(ctx context.Context, input *streamInput, send sse.Sender) {
		tok, err := auth.ParseStreamToken(secret, input.Token)
		if err != nil {
			// The response has already begun, so a comment frame is the only way to
			// signal failure. The client treats a stream that never delivers a `change`
			// event as a failed handshake and mints a new token.
			_ = send(sse.Message{Comment: "unauthorized"})
			return
		}

		workspaceID, err := uuid.Parse(tok.WorkspaceID)
		if err != nil {
			_ = send(sse.Message{Comment: "bad-request"})
			return
		}

		events := hub.Subscribe(workspaceID)
		defer hub.Unsubscribe(workspaceID, events)

		// Ask the browser to wait 2s before reconnecting. The default first-reconnect
		// storm right after a server restart is exactly when we do not want every open
		// tab to hit at once.
		if err := send(sse.Message{Retry: 2000}); err != nil {
			return
		}

		heartbeat := time.NewTicker(heartbeatInterval)
		defer heartbeat.Stop()

		for {
			select {
			case <-ctx.Done():
				return

			case <-heartbeat.C:
				if err := send(sse.Message{Comment: "keepalive"}); err != nil {
					return
				}

			case e, ok := <-events:
				if !ok {
					return
				}
				if err := send(sse.Message{Data: Event{Entity: e.Entity, ID: e.ID, Version: e.Version}}); err != nil {
					return // client disconnected
				}
			}
		}
	}
}
