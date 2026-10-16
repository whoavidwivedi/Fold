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
- **`queryClient.clear()` does not refetch mounted queries.** It empties the cache, but a
  mounted `QueryObserver` only re-subscribes on its *next render*. Use
  `invalidateQueries()`, which refetches active observers immediately. Symptom: the screen
  shows the previous tenant's rows while the API correctly returns nothing for the new one.
- **`clearToken()` must invalidate in-flight refreshes.** A refresh already running
  resolves after the clear and writes the *old* token straight back into the cache. `token.ts`
  keeps a generation counter for this. Symptom: switching workspaces twice quickly keeps
  the first workspace, silently, with valid-looking data.
- **If it is clickable, the whole thing is clickable and the cursor says so.** A record
  row uses the stretched-link pattern: the anchor is the name, a `::after` covers the row.
  Three things break it silently — Tailwind v4's `after:absolute` emits nothing without
  `after:content-['']`; `overflow-hidden` on the cell clips the pseudo-element to that one
  cell; and a `relative` added to a virtualized row overrides its `absolute` and breaks the
  virtualizer. Never put a bare `onClick` on a `<tr>` — the name must stay a real `<Link>`
  so it is middle-clickable and shows its URL.
- **A record is a route, not a sheet.** `/people/[id]` so it can be linked and the
  browser back button closes it. Reading one stacked three overlays before — list, sheet,
  edit dialog — and covered the list while you worked.
- **Look at the screen.** Every crop and overlap fixed in this repo was found by
  screenshotting it — `VISUAL_REVIEW=1 bunx playwright test tests/visual-review.spec.ts`
  writes desktop/tablet/mobile shots of every screen. An assertion has to know what
  correct looks like before anyone notices when it stops looking that way.
- **A PATCH must never overwrite a column it was not sent.** `first_name = $1` means
  `{"lifecycleStage":"customer"}` writes an empty name, and the drawer sends exactly that
  when you attach a company. Real leads rendered as "Unnamed" with their email attached.
- **Sheet padding belongs on the sheet.** `SheetHeader`/`SheetFooter` carry `p-4`; content
  between them does not. Put `px-*` on the content and zero the header/footer's, or add
  `pr-*` to clear the absolutely-positioned close button.
- **Never add a control to a table row that the row itself already opens.** A delete
  button on every row is noise, sits one misclick from data loss, and pushes the column
  it shares with a header out of alignment with it.
- **Both record lists render through `components/data/record-table.tsx`.** Each building
  its own header is how the two drifted apart. Header rows need `w-full` or the header grid
  sizes to content while the body fills the width.
- **`go test ./...` runs packages in parallel processes; one of them migrating is not
  enough.** `platform.Migrate` takes a Postgres advisory lock because goose v3.29 does
  not. Without it two processes both read version 0 and one dies with a duplicate-type
  error — which is a production bug too, since every replica migrates on boot.
- **A create body and an update body are not the same function, even when they look
  identical.** Dropping blank fields is right on create and wrong on update, where a
  blank means "clear this" and an omitted key means "leave it alone". One shared helper
  silently makes a form unable to empty a single field.
- **A per-row `aria-label` that repeats the row's own content changes that row's
  accessible name.** `aria-label="Delete Acme"` made the contacts cell read
  "0 Delete Acme" and broke every selector scoped to it. Label the action, not the record.
- **A `DialogTrigger` cannot live inside the dialog it opens.** It must be a sibling of
  the content, so a component that is both trigger and dialog renders a button that does
  nothing. Pass `onClick` and let the caller own the open state.
- **Base UI's `DropdownMenuLabel` throws without an enclosing `DropdownMenuGroup`.**
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
- **`RecordTable` owns the `lg` breakpoint; `RecordCards` is the phone layout.** Not a
  convention — the table is `hidden lg:block` in the component itself, so a caller
  physically cannot render one without the narrow half. It used to be each caller's job,
  and a company's contact table rendered without the guard and showed 2 of its 3 columns
  on a phone: the email column ran off the right edge and the Stage column was not in the
  viewport at all. Silent — no error, no failed assertion. `lg` and not `md` because the
  sidebar is 240px, so at 768px a tablet leaves a 528px pane against a 760px table. It
  scrolled, which is not a crop but reads like one. At 1024px every table fits.
- **The app shell is `h-svh` and the content pane is `flex-1 min-h-0`.** It was
  `min-h-svh` with an `h-svh` page stacked under it, so on a phone the document was
  always ~140px taller than the viewport and the sidebar scrolled off the top on its own.
  `min-h-0` on the pane is not optional either: without it the flex child refuses to shrink
  and the overflow escapes back to the document.
- **`DialogContent` needs `max-h` + `overflow-y-auto`.** The edit form is ~735px tall and a
  390×780 phone with the keyboard up leaves ~300px. Without a ceiling the popup grew past
  the viewport, centred on it, so **Save sat off-screen with no scroll to reach it** — the
  form could not be submitted at all.
- **`w-56` on `DropdownMenuContent` overrides its built-in `w-(--anchor-width)`.** The
  class looks harmless and reads as "make it a sensible width". It is what makes a menu
  anchored to a full-width trigger a narrow box floating underneath it.
- **A crop is invisible to the test suite; a clip is not.** `tests/mobile.spec.ts` walks
  the DOM for elements whose content is wider than their box, whose `overflow-x` is hidden
  or clip rather than auto or scroll, and which are not ellipsising — and asserts the
  document does not scroll sideways. Run it after touching any layout. Base UI's Select
  keeps an `aria-hidden` input clipped with `clip-path` for form submission; that one is
  excluded and would otherwise be a false positive on every screen.
