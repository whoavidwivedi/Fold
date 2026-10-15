# Architecture Decision Records

One file per decision that is expensive to reverse. Newest last.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-split-next-and-go.md) | Next.js owns identity + UI, Go owns data | Accepted |
| [0002](0002-postgres-rls-tenancy.md) | Shared schema + Row Level Security for tenancy | Accepted |
| [0003](0003-openapi-contract-first.md) | Huma → OpenAPI → orval, contracts are generated | Accepted |
| [0004](0004-realtime-pg-notify-sse.md) | Realtime via Postgres LISTEN/NOTIFY + SSE | Accepted |
| [0005](0005-single-person-table.md) | One `person` table, no lead/contact split | Accepted |
| [0006](0006-jsonb-custom-fields.md) | Custom fields in JSONB, never per-tenant DDL | Accepted |
| [0007](0007-no-redis.md) | No Redis, no Elasticsearch, no Kafka | Accepted |
| [0008](0008-browser-smoke-tests.md) | Browser smoke tests are the verification gate | Accepted |

## Format

```markdown
# NNNN — Title

Date · Status

## Context
The forces at play.

## Decision
What we chose.

## Alternatives rejected
Each with the reason.

## Consequences
What this costs us.
```