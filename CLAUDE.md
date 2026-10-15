# Fold

CRM built as a **split process**: Next.js owns identity + UI, Go owns data, Postgres is the
only stateful dependency.

- **Read `AGENTS.md` first.** It holds the hard rules, commands and gotchas.
- **Architecture decisions live in `docs/adr/`.** If you are about to revisit one, read its
  ADR — most "obvious improvements" are already-rejected alternatives with a reason.
- **Never hand-write generated code.** Run `sqlc generate` and `orval` instead.