# 0004 — Realtime via Postgres LISTEN/NOTIFY + SSE

2026-10-15 · Accepted

## Context

Sales teams work the same records simultaneously. Someone reassigns a lead, another rep
comments, a workflow fires — everyone watching needs to see it immediately. The product is
sold on being "blazing fast realtime", so this is load-bearing, not a nice-to-have.

## Decision

**The write path already touches Postgres. Emit a pointer on `pg_notify` inside the same
transaction, fan out to browsers over SSE.**

```sql
SELECT pg_notify('tenant_' || $1::text, $2);  -- same tx as the write
```

- One Postgres channel per workspace. Tenant scoping *is* the routing key.
- One dedicated `pgx.Connect` connection per process holds `LISTEN tenant_*`. **Not from the
  pool** — `pgxpool` cannot hold a `LISTEN` reliably.
- Huma's `sse` package fans out to connected browsers and documents the event types into
  the OpenAPI spec automatically.
- Browser receives a pointer and invalidates its query cache:

```json
{ "entity": "person", "id": "…", "version": 42 }
```

Mutations use optimistic updates, so the acting user never waits on the round trip. The SSE
event exists to update *other* viewers.

## Alternatives rejected

**WebSockets.** Bidirectional, but we are not bidirectional: mutations are ordinary
authenticated `POST`s with optimistic UI. SSE gets automatic reconnection from the native
`EventSource`, works through every proxy, and is documented by Huma. Revisit only when we
need true collaborative editing of the same field (presence, cursors).

**Redis pub/sub.** A second stateful dependency and a second failure domain, to solve a
problem Postgres already solves here. Tenant is the routing key and Postgres already knows
it.

**Polling.** Not realtime, and it burns the free-tier request budget.

## Consequences

- **`pg_notify` payloads must be under 8000 bytes.** Hence pointers, never row bodies.
- Notifications are transient — nobody listening means the message is gone. Acceptable,
  because SSE reconnects and refetches.
- `http.Server.WriteTimeout` must be `0` or long-lived streams die. Use `ReadHeaderTimeout`
  plus a per-request `SetWriteDeadline` as the real timeout.
- `EventSource` cannot send an `Authorization` header, so the browser exchanges its JWT for a
  **60-second, single-use, workspace-scoped** stream token. Query strings are redacted from
  logs.
- **Never host SSE on Vercel Hobby** — 300s hard function cap, and non-commercial ToS.

```go
// ponytail: pg_notify drops payloads >8KB and events are transient. Upgrade path is an
// outbox table plus NOTIFY(last_id) for replay and unbounded payloads — do that before
// reaching for Redis.
```