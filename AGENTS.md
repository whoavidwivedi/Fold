<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fold — Lead Management CRM

Next.js is the **identity + UI** process. Go is the **data** process. Postgres is the only
stateful dependency. See `docs/adr/` for why each decision was made.

## Commands

```bash
bun dev                    # Next (port 3000)
cd api && go run ./cmd/api   # Go API (port 8080), runs migrations on boot
docker compose up -d db   # local Postgres (port 5432)

bunx sqlc@latest generate -f api/sqlc.yaml   # SQL -> Go types. RUN BEFORE typechecking.
bunx orval --config orval.config.ts         # openapi.json -> typed TS client
bun typecheck && bun run lint
cd api && go test ./...
```

## Hard rules

### Contracts are generated. Never hand-write them.

- Go handlers are typed structs; Huma derives OpenAPI 3.1 from them. `openapi.json` is
  committed and is the source of truth for the frontend.
- SQL is the source of truth for types. `*.sqlc.go` is generated — never edit it.
- **Run `sqlc generate` and `orval` before trusting any type error.** Stale generated code
  is the single most common source of phantom errors in this repo.

### Tenancy

- Every table has `workspace_id uuid not null` and Row Level Security enabled.
- Every query goes through `platform.Tenant(ctx, workspaceID, fn)` — the one helper that
  opens a transaction and issues `SET LOCAL app.workspace_id`. Never query without it.
- `workspace_id` is the Better Auth `organization.id`. There is no second tenant concept.

### UI — shadcn is Base UI here, not Radix

- Use `render={...}` for custom triggers. **`asChild` is Radix and does not work here.**
- Base UI uses the `toast` component, **not `sonner`**.
- Forms are `FieldGroup` + `Field`. Never raw `div` + `grid gap-*`.
- `Button` has no `isPending` — compose `Spinner` + `data-icon` + `disabled`.
- Run `bunx shadcn@latest search` before writing custom markup. Compose existing components.
- `npx shadcn@latest info --json` reports which primitives the project uses — check it if
  a trigger or menu behaves unexpectedly.

### Motion — read the frequency table before animating anything

| Frequency | Decision |
| --- | --- |
| 100+ times/day (⌘K palette, keyboard shortcuts) | **No animation.** |
| Tens/day (rows, hovers) | Drastically reduce |
| Occasional (drawer, dialog, toast) | Standard animation |

- The ⌘K command palette has **zero** open/close animation. It is opened constantly.
- `transition: transform 200ms ease-out` — never `transition: all`.
- Ease on enter, custom curves only: `--ease-out-ui`, `--ease-in-out-ui`, `--ease-drawer`.
- Nothing appears from nothing: `scale(0.95)` + `opacity: 0`, never `scale(0)`.
- Popovers scale from their trigger via `transform-origin: var(--transform-origin)`.

### Performance — the rules that actually bite a CRM

- **One** global SSE `EventSource`, module-level, refcounted. Never one per component.
- Build the field-renderer registry as a `Map` at module scope. No `Record` lookups or
  object rebuilds inside a table cell loop.
- Hoist `RegExp` construction out of filter loops.
- `Promise.all` for independent fetches on a record page.
- No barrel files — import renderers directly.

### Keep it lazy

Deletion over addition. No abstraction with one implementation, no factory for one
product, no config for a value that never changes. If a shortcut has a real ceiling,
mark it `# ponytail: <ceiling> and the upgrade path`.

## Gotchas

The highest-value section. These have all cost real time.

- **Go is not on PATH by default.** `export PATH="/opt/homebrew/bin:$PATH"` (Homebrew Go).
- **`pgxpool` cannot hold a `LISTEN`.** The realtime subscriber uses a dedicated
  `pgx.Connect` connection. Putting `LISTEN` on a pooled connection fails intermittently
  and is very hard to debug.
- **`pg_notify` payloads must be under 8000 bytes.** Send a pointer
  (`{entity, id, version}`) and let the client refetch.
- **SSE requires `http.Server.WriteTimeout: 0`.** It conflicts with long-lived streams.
  Use `ReadHeaderTimeout` plus per-request `SetWriteDeadline`.
- **`nextCookies()` must be the last plugin** in the Better Auth plugin array or cookies
  are not written in Server Actions.
- **`proxy.ts` is not `middleware.ts`** (Next 16 renamed it) and the edge runtime is not
  supported in it. It runs on Node. Use it only for optimistic redirects —
  `getCookieCache` is explicitly **not** a security check. Real authz is in the Go DAL.
- **Never put SSE on Vercel Hobby** — 300s hard function cap.
- **`cookies()`, `headers()`, `params`, `searchParams` are all **async** in Next 16.
- **Never declare `Status int \`status:"..."\`` on a Huma output struct.** It overrides
  `DefaultStatus` on the Operation, and if you forget to assign it the handler panics with
  `invalid WriteHeader code 0` — which surfaces as a dropped connection (curl shows `000`),
  not as an error. Set `DefaultStatus` on the Operation, like `internal/person` does.
- **A Huma input field cannot be both `path` and `query`.** A stray `query:""` wins and the
  parameter vanishes from the OpenAPI document, so orval rejects the spec with "needs to be
  defined as a path parameter". Reordering the struct does not help — check for a leftover
  `query` tag first.
- **Only query inside `platform.Tenant`.** A `GetX` called on the pool has no
  `app.workspace_id`, RLS matches nothing, and the handler reports 404 for a row that
  demonstrably exists. The existence check belongs inside the same transaction as the write.
- **`next lint` was removed. `eslint` runs separately; `next build` no longer lints.
- `images.domains` is deprecated → `images.remotePatterns`. `qualities` now defaults to
  `[75]` only.
- Reusing an existing util is a hard requirement. **Reimplementing an existing helper is
  the most common defect in AI-authored changes here.** Grep before you write.
- **A PATCH cannot clear a field with `COALESCE(narg(col), col)`** — NULL means "leave
  alone", so NULLIF is needed to make `""` store a real NULL. A uuid column has no empty
  string at all, so clearing one needs a sentinel (person uses the zero uuid; see
  `NO_COMPANY`).
- **`format:"email"` rejects `""` with a 422 before the handler runs.** Huma validates
  whatever is present, and an empty string is present. Any field that must be clearable
  cannot carry a format tag — validate in the handler instead, skipping the empty string.
- **Base UI's `Select` renders `SelectValue` from the `items` collection, not from the
  mounted `<SelectItem>` children.** Omit `items` and the trigger shows the raw value — a
  uuid in our case. It passes every API check and is unusable. Same family of bug as a
  dangling foreign key: correct in the data, meaningless on screen.
- **Huma schema names are global.** Two packages cannot both define `CreateBody`; the
  `--print-openapi` step panics with `duplicate name`. Resource-prefix new body types.
- **Do not put `role="button"` on a `<tr>`.** It erases the row from table navigation for
  screen readers, and `getByRole("row")` in the smoke tests stops matching. Keep the row a
  row and put a real `<button>` in the first cell; a `onClick` on the `<tr>` is a fine
  pointer shortcut alongside it. Remember `<button>` takes phrasing content only — spans,
  never `<div>`s.
