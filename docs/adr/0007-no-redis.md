# 0007 — No Redis, no Elasticsearch, no Kafka

2026-10-15 · Accepted

## Context

The conventional Go SaaS stack is gin + ent + asynq + Redis + zap + connect-rpc + protobuf:
25+ direct dependencies and four services to operate. Postgres can already do most of it.
Every additional service is a second failure domain, a second set of credentials, and a
second thing to debug at 3am.

## Decision

**Postgres is the only stateful dependency. Direct dependency budget: 9.**

| Capability | Chosen instead of | Because |
| --- | --- | --- |
| Job queue | asynq + Redis | River, which is Postgres-backed, so `InsertTx` enqueues **inside the CRM write transaction**. A Redis enqueue sits outside the Postgres transaction and creates a dual-write problem for free. |
| Search | Elasticsearch | `tsvector` + `unaccent_immutable` + `ts_rank_cd` + a composite GIN on `(workspace_id, search_vector)`. Ranking and domain search (`SPLIT_PART(email,'@',2)`) work fine at our scale. |
| Cache | Redis | Postgres, plus per-request `React.cache()` where Next needs it. |
| RPC | Connect/protobuf | See ADR 0003. |
| Logging | zap | stdlib `log/slog`. pgx, Huma and River all emit slog. Zap's only edge is allocation rate in ultra-hot paths, which a database round trip makes irrelevant. |

## Alternatives rejected

**asynq.** Redis-backed, and its last release was February 2026 after a 13-month gap, with
295 open issues. It also makes us own a Redis.

**Masterminds/squirrel.** Last release March 2023, last commit February 2024, ~100 open
issues, no v3 in years. sqlc generates the queries instead.

**kelseyhightower/envconfig.** Last release 2019. No deprecation notice, so it fails
silently into new codebases. `os.Getenv` for a small struct, `caarlos0/env` past ~15 fields.

**Atlas.** Not permissively licensed — its docs require Ariga's prior written consent for
non-evaluation use.

**Elasticsearch.** The honest failure mode is *ranking*, not matching: GIN gives you matches,
not top-K, so sorting millions of rows by `ts_rank` degrades badly. Twenty handles this by
fanning out across object types in parallel and keyset-paginating on the rank itself.

## Consequences

Two ceilings we accept knowingly. Both are marked in code with `# ponytail:` comments.

- `# ponytail: Postgres full-text, ceiling ~10M rows / low-thousands QPS. GIN matches well
  but ranking does not top-K; add a narrow materialized search table when ranking p95
  exceeds 200ms, and Meilisearch only past ~10M docs or when we need cross-language
  analysis.`
- `# ponytail: River is v0.x and its free tier has no dead-letter queue. Pin the minor
  version; price River Pro before committing if DLQ or durable cron reaches the roadmap.`
- One `LISTEN` connection per process, which caps horizontal fanout at the replica count.
  Correct at our scale; a dedicated broker when it stops being true.
- Analytics stay in Postgres: an append-only `event` table shaped like Twenty's ClickHouse
  stream (`workspace_id` first in the sort key). Funnels and cohort reporting need an event
  log, not a current-state table. ClickHouse only when a measured dashboard outgrows it.