# 0001 — Next.js owns identity + UI, Go owns data

2026-10-15 · Accepted

## Context

Two processes, one product. The question is where the boundary sits, because it determines
who owns sessions, who owns CRM data, and how many data paths exist in the UI.

## Decision

**Next.js owns identity and presentation. Go owns every piece of CRM data. One direction
of travel for data: browser → Go.**

- Better Auth runs inside Next.js. It needs `nextCookies()`, RSC session reads and Server
  Actions to work properly, all of which are Next-specific.
- Better Auth's `jwt` plugin issues short-lived EdDSA tokens. The Go API verifies them
  offline against `/api/auth/jwks`. **No database lookup on the hot auth path.**
- Every CRM read and write goes browser → Go over `Authorization: Bearer`. Same origin via
  reverse proxy, so no CORS in practice.
- Realtime SSE is served by Go, never proxied through Next.

## Alternatives rejected

**Next as a BFF calling Go.** Two data paths (RSC fetch + client fetch) means two error
paths, two cache invalidation paths, and RSC would need a JWT it does not have — every
server render would cost an extra round trip to Better Auth. Doubles the surface area for
zero benefit on a query-heavy interactive app.

**Static export + Go serves the SPA.** Genuinely attractive: one binary, one port, no
Next server at all. Rejected because it forfeits `nextCookies()`, RSC session reads and
Server Actions, which makes Better Auth considerably harder to integrate — and we chose a
Next 16 shadcn template deliberately.

**Go as a monorepo microservice per domain.** One service, one deployable. Domain boundaries
are enforced by package structure and linting, not by the network.

## Consequences

- No server-side rendering of CRM data. RSC renders static chrome and layout only. This is
  the right trade for a realtime CRUD app, and it means every screen has one loading path.
- The browser holds a JWT in memory, refreshed from Better Auth. Accept the revocation
  latency: JWTs are set to 5 minutes, so removing a member takes effect within 5 minutes.
- Auth is stateful in Next and stateless in Go. The JWKS endpoint is the coupling point.