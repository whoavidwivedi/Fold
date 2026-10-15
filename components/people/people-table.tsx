"use client"

import { useMemo, useRef, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"

import { listPersons } from "@/lib/api/generated/endpoints/people/people"
import type { Person } from "@/lib/api/generated/model"
import { useQuery } from "@tanstack/react-query"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StageBadge } from "@/components/people/fields"
import { RecordDrawer } from "@/components/people/record-drawer"

const PAGE_SIZE = 50

// One grid template for the header and every row, so the two cannot drift apart.
//
// The `min()` wrapper is what stops narrow viewports from clipping the last columns:
// without a floor the fixed columns collapse, text is cut mid-character, and the frame
// silently hides data. With it, the table overflows horizontally and scrolls instead.
const COLUMN_WIDTHS =
  "minmax(220px, 2fr) minmax(200px, 1.5fr) minmax(110px, auto) minmax(110px, auto) minmax(70px, auto)"
const TABLE_MIN_WIDTH = 760

export function PeopleTable() {
  const [search, setSearch] = useState("")
  const [stage, setStage] = useState("")
  const [cursor, setCursor] = useState<string | undefined>()
  const [pageIndex, setPageIndex] = useState(0)

  // Which record the drawer is showing. Null means closed. Not in the URL yet — a
  // linked record view is worth doing properly, with its own route, rather than
  // bolting a search param onto a modal.
  const [openId, setOpenId] = useState<string | null>(null)

  // The cursor stack makes Back work. Keyset pagination has no page number, so
  // remembering the cursor that produced each page is the only way to go backwards.
  const cursorStack = useRef<(string | undefined)[]>([])

  const debouncedSearch = useDebouncedValue(search, 250)

  const query = useQuery({
    queryKey: ["people", { search: debouncedSearch, stage, cursor }],
    queryFn: async () => {
      const response = await listPersons({
        search: debouncedSearch || undefined,
        lifecycleStage: stage || undefined,
        cursor,
        limit: PAGE_SIZE,
      })

      // orval types the response as a success union with the error model, because the
      // spec documents both. The mutator already throws on a non-2xx, so anything that
      // reaches here is the success branch — narrowing keeps the page free of guards.
      if (response.status !== 200) {
        throw new Error("unexpected response")
      }
      return response.data
    },
  })

  const people = useMemo(() => query.data?.items ?? [], [query.data])

  const columns = useMemo<ColumnDef<Person>[]>(
    () => [
      {
        accessorKey: "lastName",
        header: "Lead",
        // The row itself is clickable for the mouse, but a <tr> is not a control: no
        // focus, no Enter, and it disappears from a screen reader's table navigation if
        // you give it role="button". So the accessible control is a real button here,
        // and the row handler below is the pointer shortcut that mirrors it.
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setOpenId(row.original.id)}
            className="-my-1 block max-w-full truncate px-1 text-left font-medium hover:underline underline-offset-4 focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {[row.original.firstName, row.original.lastName]
              .filter(Boolean)
              .join(" ") || "Unnamed"}
          </button>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ getValue }) => {
          const email = getValue() as string | undefined
          return (
            <span className="text-muted-foreground block truncate text-sm">
              {email ?? "—"}
            </span>
          )
        },
      },
      {
        accessorKey: "lifecycleStage",
        header: "Stage",
        cell: ({ getValue }) => <StageBadge stage={getValue() as string} />,
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground block truncate text-sm">
            {(getValue() as string | undefined) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "score",
        header: "Score",
        cell: ({ getValue }) => {
          const score = getValue() as number
          return (
            <span className={cn("tabular-nums", score === 0 && "text-muted-foreground")}>
              {score === 0 ? "—" : score}
            </span>
          )
        },
      },
    ],
    // setOpenId is a setState function, so it is stable across renders and the empty
    // dependency list is correct rather than merely convenient.
    [],
  )

  const table = useReactTable({
    data: people,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const rows = table.getRowModel().rows

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
  })

  function resetPaging() {
    cursorStack.current = []
    setPageIndex(0)
    setCursor(undefined)
  }

  function goNext() {
    const next = query.data?.nextCursor
    if (!next) return
    cursorStack.current[pageIndex] = cursor
    setCursor(next)
    setPageIndex((i) => i + 1)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function goBack() {
    if (pageIndex === 0) return
    setCursor(cursorStack.current[pageIndex - 1])
    setPageIndex((i) => i - 1)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
        <p className="text-muted-foreground text-sm">
          {query.isPending
            ? "Loading…"
            : `${query.data?.total ?? 0} in this workspace`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            // Any filter change invalidates the cursor stack — the old cursors point at
            // positions in a set that no longer exists.
            resetPaging()
          }}
          placeholder="Search name, email or domain"
          className="max-w-xs"
        />

        <StageFilter value={stage} onChange={(next) => { setStage(next); resetPaging() }} />
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            // Skeleton, not a custom animate-pulse div. See AGENTS.md.
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border">
          <div className="space-y-1 text-center">
            <p className="font-medium">No leads yet</p>
            <p className="text-muted-foreground text-sm">
              {search || stage
                ? "Nothing matches those filters."
                : "Your first lead will show up here."}
            </p>
          </div>
        </div>
      ) : (
        // The frame hugs its rows. flex-1 stretched it to the viewport bottom, which
        // left a tall empty box under a short list and read as a broken frame.
        <>
        {/* Table from md up. Below that a 5-column grid shows two columns and clips the
            rest, so a phone gets stacked cards — the pattern every CRM converges on. */}
        <div className="hidden min-h-0 overflow-hidden rounded-lg border md:block">
          <div
            ref={scrollRef}
            // Both axes scroll. The horizontal one is what keeps the last columns
            // reachable on a phone instead of clipped by the frame.
            className="h-full overflow-auto"
          >
            <Table
              style={{ display: "grid", minWidth: TABLE_MIN_WIDTH }}
              className="w-full"
            >
              <TableHeader className="bg-background sticky top-0 z-10 grid">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id} className="grid" style={{ gridTemplateColumns: COLUMN_WIDTHS }}>
                    {group.headers.map((header) => (
                      <TableHead key={header.id} className="flex items-center">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>

              {/* Virtualized: only visible rows are mounted. A workspace with 50k leads
                  must not create 50k DOM nodes. */}
              <TableBody
                className="grid"
                style={{ height: virtualizer.getTotalSize(), position: "relative" }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index]
                  return (
                    <TableRow
                      key={row.id}
                      onClick={() => setOpenId(row.original.id)}
                      className="absolute grid w-full cursor-pointer transition-colors hover:bg-muted/50"
                      style={{
                        gridTemplateColumns: COLUMN_WIDTHS,
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="flex items-center overflow-hidden">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <ul className="divide-border divide-y overflow-hidden rounded-lg border md:hidden">
          {people.map((person) => (
            <li key={person.id} className="flex flex-col gap-1 p-3">
              {/* Spans, not divs: a button's content model is phrasing content only.
                  The utility classes lay them out identically. */}
              <button
                type="button"
                onClick={() => setOpenId(person.id)}
                className="flex w-full flex-col gap-1 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {[person.firstName, person.lastName].filter(Boolean).join(" ") ||
                      "Unnamed"}
                  </span>
                  <StageBadge stage={person.lifecycleStage} />
                </span>
                {person.email && (
                  <span className="text-muted-foreground truncate text-sm">
                    {person.email}
                  </span>
                )}
                <span className="text-muted-foreground truncate text-xs">
                  {person.source ?? "No source"}
                  {person.score > 0 && ` · score ${person.score}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      <div className="flex shrink-0 items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Page {pageIndex + 1}
          {query.data?.total != null && ` · showing ${people.length} of ${query.data.total}`}
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goBack}
            disabled={pageIndex === 0 || query.isFetching}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!query.data?.nextCursor || query.isFetching}
          >
            Next
          </Button>
        </div>
      </div>

      <RecordDrawer personId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

const STAGES = [
  { value: "", label: "All stages" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "customer", label: "Customer" },
  { value: "disqualified", label: "Disqualified" },
]

function StageFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-1">
      {STAGES.map((option) => {
        const active = value === option.value
        return (
          <Button
            key={option.value || "all"}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn("transition-colors", active && "font-medium")}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}