# Fold

**Lead management CRM.** Capture leads, qualify them, move them through a pipeline, and
know exactly who is doing what — in real time.

Built as a split process: **Next.js owns identity and UI, Go owns data, Postgres is the
only stateful dependency.** No Redis, no Elasticsearch, no message broker.

---

## Architecture

```
Browser ──┬──> Next 16  ── Better Auth: sessions, orgs, short-lived JWTs
          │      │
          └──> Go API ── Huma (OpenAPI 3.1) ──> sqlc ──> Postgres
                     ▲                            │
                     └──── SSE ── pg_notify ─────┘
```

| Concern | Choice | Why |
| --- | --- | --- |
| API | **Huma v2** + chi | OpenAPI 3.1 is *derived* from typed Go structs, not maintained alongside them |
| Data access | **sqlc** | SQL is the source of truth; Go types are generated. No ORM drift |
| Auth | **Better Auth** | MIT, `organization` plugin gives multi-tenancy for free |
| Auth transport | **JWT via JWKS** | Go verifies offline — no database lookup on the hot auth path |
| Tenancy | **Shared schema + RLS** | Enforced by Postgres, so a forgotten `WHERE` fails closed instead of leaking |
| Realtime | **`pg_notify` + SSE** | The write already touches Postgres. One way only — mutations are ordinary requests |
| Contracts | **orval** | `openapi.json` is committed; the typed client is generated from it |

The reasoning behind each is written up in [`docs/adr/`](docs/adr/). Read those before
proposing changes to any of them.

---

## Quick start

Requires **Go 1.27+**, **Bun**, and **Docker**.

```bash
make setup     # installs sqlc, starts Postgres, runs migrations
make api       # Go API on :8080 (migrates on boot)
bun dev        # Next on :3000
```

Then:

1. Open <http://localhost:3000> — you will be redirected to `/sign-up`.
2. Create an account and workspace.
3. You land on `/people` with an empty list. Create leads via the API:

```bash
TOKEN=$(curl -s -b cookies.txt http://localhost:3000/api/auth/token | jq -r .token)

curl -X POST http://localhost:8080/v1/persons \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Marcus","lastName":"Delgado","email":"marcus@example.test",
       "lifecycleStage":"qualified","source":"web-form",
       "data":{"roofType":"composition","emergency":true}}'
```

The row appears without a refresh. That is the event stream working.

The full API surface is browsable at <http://localhost:8080/docs>.

---

## Commands

```bash
make help          # list everything

make db            # start Postgres
make migrate       # apply migrations and exit
make api           # run the Go API
make test          # Go tests (needs Postgres — includes the RLS isolation suite)
make smoke         # browser tests (needs the whole stack running)

make codegen       # SQL  -> Go types          (sqlc)
make openapi       # routes -> openapi.json     (Huma)
make orval         # openapi.json -> TS client  (orval)

make lint          # go vet + gofmt + tsc + eslint
```

Regenerate contracts after **any** API change:

```bash
make codegen && make openapi && make orval
```

CI fails if any of the three is stale.

---

## Testing

```bash
make test     # Go: auth + Row Level Security isolation
make smoke    # Playwright: the real browser path
```

The browser tests are not optional decoration. Four bugs shipped in the first session
that **every `curl` check passed** and a browser caught immediately — missing CORS,
relative API URLs, a poisoned token cache, and a session with no active workspace. The
reasoning is in [ADR 0008](docs/adr/0008-browser-smoke-tests.md).

`TestTenantIsolation` is the most important test in the repository. One bug in it leaks
one customer's lead list to another, and nothing else would catch it.

---

## Conventions

**Read [`AGENTS.md`](AGENTS.md) before writing code.** It carries the hard rules, the
commands and — most usefully — the **Gotchas** section, which is a list of things that
have already cost time here.

The short version:

- Never hand-edit generated code. `*.sqlc.go`, `lib/api/generated/**` and
  `openapi.json` are all produced by a command.
- Every tenant query goes through `platform.Tenant`, which opens a transaction and sets
  `app.workspace_id`. No exceptions.
- shadcn here is **Base UI**, not Radix. `render`, never `asChild`.
- Check the motion budget before animating anything. The command palette has none,
  deliberately.
- Grep before you write. Reimplementing an existing helper is the most common defect in
  AI-authored changes to this repo.

---

## Status

Working today:

- Multi-tenant workspaces, invitations, roles, and switching between them — the JWT,
  every cached query and the live stream all move together
- Lead CRUD end to end — create, edit, and soft-delete from the browser
- Person records with runtime-defined custom fields (JSONB — adding a field is a row
  insert, never a migration)
- Companies with full create, edit and delete, linked to and detached from leads
  without orphaning either side
- Full-text search across name, email local part and email domain
- Keyset pagination, debounced search, stage filters
- Activity log and timeline: notes, calls, emails and stage changes
- Realtime updates over SSE with optimistic UI
- Soft delete throughout, audit event log

Not built yet: deals and kanban, tasks, the workflow engine, reporting, email/calendar
integrations, and the authoring UI for custom fields — the JSONB design works and is
tested, but there is no screen yet for creating a field. See
[`docs/adr/README.md`](docs/adr/README.md) for the plan and the deliberate omissions.

---

## Licence

Proprietary. All rights reserved.