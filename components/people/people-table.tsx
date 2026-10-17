"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"

import { listPersons } from "@/lib/api/generated/endpoints/people/people"
import type { CreateBody, Person } from "@/lib/api/generated/model"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { RiAddLine } from "@remixicon/react"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "cn"
import { RecordListHeader, RecordToolbar } from "@/components/data/record-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PersonFormFields } from "@/components/people/person-form"
import {
  type Draft,
} from "@/components/forms/record-form"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableHead } from "@/components/ui/table"
import {
  RecordCards,
  RecordTable,
  TableRow,
  cardLinkClass,
  cellClass,
  gridRow,
  nameButtonClass,
  rowClass,
} from "@/components/data/record-table"
import { STAGES, StageBadge } from "@/components/people/fields"

const PAGE_SIZE = 50

// One grid template for the header and every row, so the two cannot drift apart.
//
// The `min()` wrapper is what stops narrow viewports from clipping the last columns:
// without a floor the fixed columns collapse, text is cut mid-character, and the frame
// silently hides data. With it, the table overflows horizontally and scrolls instead.
/**
 * Every max is a fraction, never `auto`.
 *
 * `minmax(110px, auto)` sizes the track to its content, and each row is its own grid —
 * so the header row and the body row resolve that track independently. They happened to
 * agree while every badge fitted inside its `min`, which is why this only surfaced when
 * the stage badge grew: the body track grew to the badge and the header track did not,
 * and every column after it moved 6px left. Fractions resolve from the container width,
 * which is the same for both rows, so the two can only agree.
 */
const COLUMN_WIDTHS =
  "minmax(220px, 2fr) minmax(200px, 1.5fr) minmax(140px, 1fr) minmax(110px, 1fr) minmax(70px, .6fr)"
const TABLE_MIN_WIDTH = 760

export function PeopleTable() {
  const [search, setSearch] = useState("")
  const [stage, setStage] = useState("")
  const [cursor, setCursor] = useState<string | undefined>()
  const [pageIndex, setPageIndex] = useState(0)


  // Keyed on the prefix, not the id: the table creates leads and the drawer edits them,
  // and both invalidate this list.
  const queryClient = useQueryClient()

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
          <Link href={`/people/${row.original.id}`} className={nameButtonClass()}>
            {[row.original.firstName, row.original.lastName]
              .filter(Boolean)
              .join(" ") || "Unnamed"}
          </Link>
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
      <RecordListHeader
        title="Leads"
        meta={
          query.isPending
            ? "Loading…"
            : `${query.data?.total ?? 0} in this workspace`
        }
      >
        <RecordToolbar>
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

        <div className="ml-auto flex items-center gap-2">
          {/* A Link, not a button that opens a dialog: /people/new is a route. Middle-click
              and "copy link" work, Back closes it, and the list is never behind a scrim. */}
          <Button
            render={<Link href="/people/new" />}
            className="max-md:h-11 max-md:px-4"
          >
            <RiAddLine aria-hidden data-icon="inline-start" />
            New lead
          </Button>
        </div>
      </RecordToolbar>
      </RecordListHeader>

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
        {/* RecordTable is md-and-up by construction; RecordCards is the phone layout. */}
        <RecordTable
          columns={COLUMN_WIDTHS}
          minWidth={TABLE_MIN_WIDTH}
          scrollRef={scrollRef}
          header={table
            .getHeaderGroups()
            .flatMap((group) => group.headers)
            .map((header) => (
              <TableHead key={header.id} className={cellClass()}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          // Virtualized: only visible rows are mounted. A workspace with 50k leads must
          // not create 50k DOM nodes, which is why the companies table cannot use this
          // path until it needs to.
          bodyClassName="relative"
          bodyStyle={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <TableRow
                key={row.id}
                // Already `absolute`, so it is its own positioning context.
                className={rowClass(true)}
                style={{
                  ...gridRow(COLUMN_WIDTHS),
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cellClass()}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </RecordTable>

        <RecordCards items={people}>
          {(person) => (
            <Link href={`/people/${person.id}`} className={cardLinkClass()}>
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
            </Link>
          )}
        </RecordCards>
        </>
      )}

      {/* A footer with two disabled buttons and "showing 4 of 4" is pure noise, and on a
          phone it is noise spent out of the viewport you have to scroll. Only when there
          is genuinely a second page. */}
      {(pageIndex > 0 || query.data?.nextCursor) && (
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Page {pageIndex + 1}
            {query.data?.total != null &&
              ` · showing ${people.length} of ${query.data.total}`}
          </p>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={pageIndex === 0 || query.isFetching}
              className="max-md:h-11 max-md:px-4"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goNext}
              disabled={!query.data?.nextCursor || query.isFetching}
              className="max-md:h-11 max-md:px-4"
            >
              Next
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}

// The filter adds an "All stages" chip to the shared list rather than duplicating it.
const STAGE_FILTER = [{ value: "", label: "All stages" }, ...STAGES]

function StageFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-1">
      {STAGE_FILTER.map((option) => {
        const active = value === option.value
        return (
          <Button
            key={option.value || "all"}
            size="sm"
            // Inactive chips are outlined, not ghost. As ghosts they have no border, no
            // fill and no icon, so on a phone they read as static labels — a row of words
            // with one of them shaded, and nothing saying you can tap the rest.
            variant={active ? "secondary" : "outline"}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            // 44px is the thumb minimum. These are the most-tapped control on the screen
            // and h-7 is a 28px target. Desktop keeps its denser size.
            className={cn("max-md:h-11 max-md:px-4", active && "font-medium")}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
