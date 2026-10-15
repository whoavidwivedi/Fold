# 0008 — Browser smoke tests are the gate, not curl

2026-10-15 · Accepted

## Context

Five bugs shipped in the first session that every command-line check passed and a real
browser caught immediately:

| Bug | curl said | Browser said |
| --- | --- | --- |
| No CORS middleware | 200 | blocked before leaving the tab |
| orval emits relative URLs | 200 | every call 404'd against Next |
| `organization.create` never activated the workspace | 200 | empty table, 401s |
| Token cache poisoned by one rejection | 200 | permanently Offline |
| `sign-in` never ensured an active workspace | 200 | empty table, Offline |

Five for five. Not a tooling gap — a verification strategy gap. `curl` does not enforce
CORS, resolves whatever host you hand it, and ignores cookies entirely. It cannot fail
on any of the four ways these broke.

## Decision

**`tests/*.spec.ts` run by Playwright, against the real stack, are the verification gate.**
Command-line checks remain useful for the Go layer, where they are genuinely faithful —
`go test` drives the same RLS policies the app does. They are not sufficient for anything
that crosses the browser boundary.

The suite drives the sign-up form rather than calling the auth API, because the calls the
browser makes are the thing under test.

## Alternatives rejected

**Fix each bug and move on.** That is what happened for four of them, and it cost a full
session of the user staring at an empty table.

**MSW / request mocking.** Mocking would have hidden all four bugs. The tests point at a
live Postgres, Go API and Next server on purpose.

**Vitest + jsdom.** A DOM emulator does not enforce CORS, does not implement
`EventSource`, and does not run the Next server. It would have reproduced none of them.

## Consequences

- `bunx playwright test` needs the stack running. Documented in the Makefile.
- Serial workers, one shared database — parallelism would race on workspaces.
- Traces and screenshots retained on failure, which is what makes a red run diagnosable
  without a reproduction.
- Still no test for every component. This is five assertions over the two flows that have
  actually broken; extend when a new flow earns it.
