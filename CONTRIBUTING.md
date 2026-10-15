# Contributing to Fold

## Before you write code

1. **Read [`AGENTS.md`](AGENTS.md).** Commands, hard rules, and a **Gotchas** section
   listing things that have already cost time in this repository.
2. **Read the relevant ADR** in [`docs/adr/`](docs/adr/). Most "obvious improvements" to
   the architecture are already-rejected alternatives with a recorded reason.
3. **Grep before you write.** Reimplementing an existing helper is the most common defect
   in AI-authored changes here.

## Regenerate, never hand-edit

These are all produced by a command, and CI fails if they are stale:

| Path | Command |
| --- | --- |
| `api/internal/dbstore/**` | `make codegen` |
| `openapi.json` | `make openapi` |
| `lib/api/generated/**` | `make orval` |

If a type error mentions generated code, regenerate before you debug. Stale generated
output is the top source of phantom errors in this repo.

## Running the checks

```bash
make lint    # go vet + gofmt + tsc + eslint
make test    # Go tests, including Row Level Security isolation
make smoke   # Playwright, against a live stack
```

`make smoke` needs `make db`, `make api` and `bun dev` all running. The Go suite needs
Postgres; everything else is self-contained.

**The browser tests are not optional.** Four bugs shipped in the first session that every
`curl` check passed and a browser caught on the first run. If you touch anything that
crosses the browser boundary, run them.

## Conventions

- **shadcn here is Base UI, not Radix.** Use `render`, never `asChild`. Check with
  `bunx shadcn@latest info`.
- **Forms use `FieldGroup` + `Field`.** Not `div` + `grid`.
- **`Button` has no `isPending`.** Compose `Spinner` + `data-icon` + `disabled`.
- **Motion has a budget.** Anything used 100+ times a day — the command palette, keyboard
  shortcuts — gets no animation at all.
- **Tenancy is not negotiable.** Every tenant query goes through `platform.Tenant`.
- **Keep it lazy.** No abstraction with one implementation, no factory for one product, no
  config for a value that never changes. If a shortcut has a real ceiling, mark it
  `# ponytail: <ceiling> and the upgrade path`.

## Database changes

- Migrations are forward-only and run on boot, advisory-locked by goose.
- Adding a column is `ADD COLUMN nullable` first, then dual-write, then backfill, then
  `SET NOT NULL`. See the expand/contract notes in `api/migrations/`.
- Custom fields never get a column. They live in JSONB and are described by
  `field_definition`. That is what makes the product customizable without migrations.
- Any table with `workspace_id` automatically gets an RLS policy via an event trigger —
  and a check at the end of the migration that fails loudly if one was missed.

## Commits and pull requests

- One logical change per PR. Generated files travel with the change that produced them.
- Describe **why**, not what the diff already shows.
- PR descriptions should state how the change was verified — especially if it touches
  auth, tenancy or realtime.

## Reporting a security issue

Do not open a public issue for anything involving authentication, tenant isolation or
session handling. These are the parts of the system where a bug ends the company.