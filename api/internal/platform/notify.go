package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Event is the pointer a browser receives. Never the row itself: pg_notify payloads
// are capped at 8000 bytes and transactions fail to commit if the queue fills.
// The client uses this to invalidate its query cache and refetch.
//
// ponytail: transient notifications, no replay. Upgrade path is an outbox table plus
// NOTIFY(last_id) for replay and unbounded payloads — do that before adding Redis.
type Event struct {
	WorkspaceID string `json:"workspace_id"`
	Entity      string `json:"entity"`
	ID          string `json:"id"`
	Version     int64  `json:"version,omitempty"`
}

// eventChannel is the single Postgres channel every process LISTENs on.
//
// Postgres LISTEN has no wildcard form — `LISTEN tenant_*` subscribes to a channel
// literally named "tenant_*". The only real options are one LISTEN per workspace
// (needs a listener per tenant, does not scale) or one shared channel carrying the
// workspace id in the payload. One channel it is.
const eventChannel = "fold_events"

// Notify emits an event for a workspace. Call it inside the same transaction as the
// write so the event can never describe a state that was rolled back.
func Notify(ctx context.Context, tx *sql.Tx, workspaceID uuid.UUID, e Event) error {
	e.WorkspaceID = workspaceID.String()

	payload, err := json.Marshal(e)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	_, err = tx.ExecContext(ctx, `SELECT pg_notify($1, $2)`, eventChannel, string(payload))
	return err
}

// Hub fans Postgres notifications out to connected browsers.
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[chan Event]struct{}
}

// NewHub returns an empty hub.
func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[chan Event]struct{})}
}

// Run LISTENs on a dedicated connection and dispatches until ctx is cancelled.
//
// A dedicated pgx.Conn, NOT one from the pool. pgxpool cannot hold a LISTEN reliably —
// the listener attaches to a connection that gets handed back to the pool, and the
// stream dies minutes later with nothing in the logs.
//
// It also reconnects. A LISTEN connection is terminated by anything from a Postgres
// restart to a network blip, and a listener that exits silently turns the product's
// headline feature into a no-op while every other request keeps returning 200. Nothing
// above this function would notice that realtime had stopped.
func (h *Hub) Run(ctx context.Context, databaseURL string) error {
	const backoff = 2 * time.Second

	for {
		if err := h.listen(ctx, databaseURL); err != nil && ctx.Err() == nil {
			slog.WarnContext(ctx, "realtime listener dropped, reconnecting", "err", err, "in", backoff)
		}

		if ctx.Err() != nil {
			return nil
		}

		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
	}
}

// listen runs one LISTEN session. It returns when the connection dies or ctx is done.
func (h *Hub) listen(ctx context.Context, databaseURL string) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect for LISTEN: %w", err)
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, `LISTEN `+eventChannel); err != nil {
		return fmt.Errorf("listen %s: %w", eventChannel, err)
	}
	slog.InfoContext(ctx, "realtime listener connected", "channel", eventChannel)

	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("wait for notification: %w", err)
		}

		var e Event
		if err := json.Unmarshal([]byte(n.Payload), &e); err != nil {
			slog.WarnContext(ctx, "undecodable notification", "err", err)
			continue
		}
		h.dispatch(e)
	}
}

func (h *Hub) dispatch(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for ch := range h.subs[e.WorkspaceID] {
		select {
		case ch <- e:
		default:
			// Slow consumer. Dropping is correct: every event is only a cache-invalidation
			// hint, and the client refetches on reconnect.
		}
	}
}

// Subscribe registers a listener for one workspace.
func (h *Hub) Subscribe(workspaceID uuid.UUID) <-chan Event {
	ch := make(chan Event, 16)
	key := workspaceID.String()

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[key] == nil {
		h.subs[key] = make(map[chan Event]struct{})
	}
	h.subs[key][ch] = struct{}{}

	return ch
}

// Unsubscribe removes a listener. Always call it, or the map grows without bound.
func (h *Hub) Unsubscribe(workspaceID uuid.UUID, ch <-chan Event) {
	key := workspaceID.String()

	h.mu.Lock()
	defer h.mu.Unlock()

	subs := h.subs[key]
	if subs == nil {
		return
	}
	for c := range subs {
		if (<-chan Event)(c) == ch {
			delete(subs, c)
			close(c)
			break
		}
	}
	if len(subs) == 0 {
		delete(h.subs, key)
	}
}
