"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { RiAddLine } from "@remixicon/react"

import { listCompanies } from "@/lib/api/generated/endpoints/companies/companies"
import { useQuery } from "@tanstack/react-query"


import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "cn"
import { RecordListHeader, RecordToolbar } from "@/components/data/record-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  RecordCards,
  RecordTable,
  TableCell,
  TableRow,
  cardLinkClass,
  cellClass,
  clickableRowClass,
  gridRow,
  nameButtonClass,
  rowClass,
} from "@/components/data/record-table"

const PAGE_SIZE = 50

// One grid template, handed to RecordTable which applies it to the header and every row.
// Mirrors components/people/people-table.tsx — the two lists must not drift apart.
// Proportioned to the content, not to the viewport. `1.4fr` on Name was 530px of mostly
// air on a 1440px screen, which pushed Domain and Industry 300px further right than they
// needed to be and made the table read as two columns and a gap.
// Fractions, not `auto` — see the note on the leads table: a content-sized track resolves
// per row, and the header row and the body row are separate grids.
const COLUMN_WIDTHS =
  "minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(160px, 1.2fr) minmax(80px, .6fr)"
const TABLE_MIN_WIDTH = 640

/** A company needs a name and nothing else. Named once so the guard and the body agree. */

/**
 * The companies list.
 *
 * Deliberately not virtualized, unlike the leads table. A workspace holds orders of
 * magnitude fewer companies than people, so a windowed list here would be machinery with
 * nothing to window. Add it when a workspace has enough companies for it to matter.
 */
export function CompaniesTable() {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 250)

  const query = useQuery({
    queryKey: ["companies", { search: debouncedSearch }],
    queryFn: async () => {
      const response = await listCompanies({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
      })
      if (response.status !== 200) {
        throw new Error("unexpected response")
      }
      return response.data
    },
  })

  const companies = useMemo(() => query.data?.items ?? [], [query.data])

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <RecordListHeader
        title="Companies"
        meta={
          query.isPending
            ? "Loading…"
            : `${query.data?.total ?? 0} in this workspace`
        }
      >
        <RecordToolbar>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or domain"
          className="max-w-xs"
        />

        <div className="ml-auto flex items-center gap-2">
          {/* A Link, not a button that opens a dialog. Middle-click and "copy link"
              then work, Back closes it, and the list is never behind a scrim. */}
          <Button render={<Link href="/companies/new" />} className="max-md:h-11 max-md:px-4">
            <RiAddLine aria-hidden data-icon="inline-start" />
            New company
          </Button>
        </div>
      </RecordToolbar>
      </RecordListHeader>

      {query.isPending ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border">
          <div className="space-y-1 text-center">
            <p className="font-medium">
              {search ? "Nothing matches that search" : "No companies yet"}
            </p>
            <p className="text-muted-foreground text-sm">
              {search
                ? "Try a shorter fragment, or part of the domain."
                : "Add a company to group the leads that work there."}
            </p>
          </div>
        </div>
      ) : (
        <>
        <RecordTable
          columns={COLUMN_WIDTHS}
          minWidth={TABLE_MIN_WIDTH}
          headings={[
            { label: "Name" },
            { label: "Domain" },
            { label: "Industry" },
            { label: "Contacts", align: "right" },
          ]}
        >
          {companies.map((company) => (
            <TableRow
              key={company.id}
              className={cn(rowClass(), clickableRowClass(false))}
              style={gridRow(COLUMN_WIDTHS)}
            >
              <TableCell className={cellClass()}>
                {/* A <tr> is not a control. role="button" here would erase the row from
                    screen-reader table navigation, so the name is the button and the row
                    handler is the pointer shortcut beside it. */}
                <Link href={`/companies/${company.id}`} className={nameButtonClass()}>
                  {company.name}
                </Link>
              </TableCell>
              <TableCell className={cellClass()}>
                <span className="text-muted-foreground block truncate text-sm">
                  {company.domain ?? "—"}
                </span>
              </TableCell>
              <TableCell className={cellClass()}>
                <span className="text-muted-foreground block truncate text-sm">
                  {company.industry ?? "—"}
                </span>
              </TableCell>
              {/* No per-row delete button. Clicking the row opens the dialog, which has
                  one; a destructive control on every row is visual noise, sits one
                  misclick from data loss, and pushes this number out of line with its
                  own header. */}
              <TableCell className={cellClass("right")}>
                {/* Absent on single-record responses; 0 is a real answer here. */}
                <span className="tabular-nums text-sm">{company.peopleCount ?? 0}</span>
              </TableCell>
            </TableRow>
          ))}
        </RecordTable>

        <RecordCards items={companies}>
          {(company) => (
            <Link href={`/companies/${company.id}`} className={cardLinkClass()}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{company.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {company.peopleCount ?? 0} contact
                  {company.peopleCount === 1 ? "" : "s"}
                </span>
              </span>
              {company.domain && (
                <span className="text-muted-foreground truncate text-sm">
                  {company.domain}
                </span>
              )}
              {(company.industry || company.location) && (
                <span className="text-muted-foreground truncate text-xs">
                  {[company.industry, company.location].filter(Boolean).join(" · ")}
                </span>
              )}
            </Link>
          )}
        </RecordCards>
        </>
      )}

    </div>
  )
}
