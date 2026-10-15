# 0002 — Shared schema + Row Level Security for tenancy

2026-10-15 · Accepted

## Context

Every CRM table must be invisible to every other tenant. The failure mode is catastrophic
and silent: one forgotten `WHERE` clause leaks one customer's lead list to another.

## Decision

**One Postgres schema. `workspace_id uuid not null` on every table. Row Level Security
enabled, enforced by the database, not by application discipline.**

```sql
ALTER TABLE person ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON person
  USING (workspace_id = current_workspace())
  WITH CHECK (workspace_id = current_workspace());
```

`current_workspace()` reads a Postgres GUC (`app.workspace_id`), never `current_user`.
The Go side has exactly one entry point:

```go
platform.Tenant(ctx, workspaceID, func(tx pgx.Tx) error { ... })
```

which opens a transaction, issues `SET LOCAL app.workspace_id`, runs the work, commits.

`workspace_id` is the Better Auth `organization.id`. There is no separate tenant table and
no mapping — one identity, one concept.

## Alternatives rejected

**Schema-per-tenant.** Twenty CRM does this. Correct for Twenty, whose product *is*
runtime per-tenant DDL. We store custom fields in JSONB and never run tenant DDL, so the
cost buys nothing. EDBT '26 (peer-reviewed) found schema-per-tenant complicates
provisioning, patching and migration at scale; catalog overhead grows with tenant count.

**Application-level `WHERE workspace_id = $1`.** The whole point is that this is the thing
that gets forgotten. RLS **fails closed** — a missing policy is an error, not a leak.

## Consequences

Three production gotchas are designed in, not discovered:

1. **Recursive policies.** A policy on `member` that queries `member` → infinite recursion.
   All such lookups are wrapped in `SECURITY DEFINER` functions with a pinned `search_path`.
2. **Pooled-connection bleed.** A previous request's workspace id leaking into the next is
   the classic RLS incident. Prevented by wrapping the **entire** request in one
   transaction with `SET LOCAL`, never storing the id in Go-side thread-local state.
3. **Authorization moves into the database.** `UPDATE … RETURNING *` returning zero rows
   *is* the 404. We stop hand-rolling "check permission → 403, else 404" pairs.

Requires a non-superuser application role: superusers and table owners bypass RLS unless the
table is additionally `FORCE ROW LEVEL SECURITY`.

**RLS does not solve** per-tenant disk/CPU/cache quotas or complex ABAC. Those become
separate concerns later and are deliberately out of scope now.