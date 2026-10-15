# 0003 — Huma → OpenAPI → orval, contracts are generated

2026-10-15 · Accepted

## Context

A frontend and a backend written in different languages, by the same (small) team, often by
an AI agent. Hand-maintained API bindings drift silently and produce type errors that look
like logic bugs.

## Decision

**Contract-first, fully generated. Three artifacts, one direction.**

```
Go typed structs ──Huma──> openapi.json ──orval──> lib/api/client.ts
SQL queries      ──sqlc──> *.sqlc.go (types)
```

- Huma derives an OpenAPI 3.1 document from Go request/response structs and serves it at
  `/openapi.json` with Scalar docs at `/docs`. Validation is derived from the same structs.
- `openapi.json` is **committed**. orval runs offline in CI against the committed file — it
  never boots the Go server.
- orval emits a typed fetch client plus React Query hooks and MSW mocks, keyed by tag.
- sqlc generates Go types from the real SQL. `*.sqlc.go` is never edited.

## Alternatives rejected

**tRPC.** Would mean hand-maintaining input schemas in TypeScript alongside the Go types —
two sources of truth, which is the exact problem we are solving.

**Connect RPC / protobuf.** Adds a code generation toolchain step to every CI run, plugin
version pinning, and a BSR or local protoc dependency. Browsers cannot set arbitrary
headers or use HTTP/2 trailers, so the wire story is worse for a browser client. SSE does
not exist in it either, so realtime would be a hand-rolled side-channel regardless.
Revisit if we ever ship a native mobile client.

**Hand-written `fetch` wrappers.** This is the status quo that drifts.

## Consequences

- A type error between frontend and backend is impossible without a build failure.
- `AGENTS.md` carries the rule: **run `sqlc generate` and `orval` before trusting any type
  error.** Stale generated code is the top source of phantom errors in this repo.
- The OpenAPI document doubles as the agent-facing contract. An AI reading `openapi.json`
  knows every operation, parameter, type and error code without reading Go source.