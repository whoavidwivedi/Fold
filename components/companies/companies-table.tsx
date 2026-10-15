"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { createCompany, listCompanies } from "@/lib/api/generated/endpoints/companies/companies"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 50

// One grid template for the header and every row, so they cannot drift. Mirrors
// components/people/people-table.tsx — a second table that lays itself out differently is
// the thing that makes a product feel unfinished.
const COLUMN_WIDTHS =
  "minmax(200px, 2fr) minmax(160px, 1.2fr) minmax(140px, 1fr) minmax(90px, auto)"
const TABLE_MIN_WIDTH = 640

/**
 * The companies list.
 *
 * Deliberately not virtualized, unlike the leads table. A workspace holds orders of
 * magnitude fewer companies than people, so a windowed list here would be machinery with
 * nothing to window. Add it when a workspace has enough companies for it to matter — see
 * the comment on the leads table for why it is there at all.
 */
export function CompaniesTable() {
  const queryClient = useQueryClient()
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

  const create = useMutation({
    mutationFn: (body: { name: string; domain?: string; industry?: string }) =>
      createCompany(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
    },
  })

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
        <p className="text-muted-foreground text-sm">
          {query.isPending
            ? "Loading…"
            : `${query.data?.total ?? 0} in this workspace`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or domain"
          className="max-w-xs"
        />

        <NewCompanyDialog
          pending={create.isPending}
          error={create.isError}
          onCreate={(body) => create.mutate(body)}
        />
      </div>

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
        <div className="min-h-0 overflow-hidden rounded-lg border">
          <div className="h-full overflow-auto">
            <Table
              style={{ display: "grid", minWidth: TABLE_MIN_WIDTH }}
              className="w-full"
            >
              <TableHeader className="bg-background sticky top-0 z-10 grid">
                <TableRow
                  className="grid"
                  style={{ gridTemplateColumns: COLUMN_WIDTHS }}
                >
                  <TableHead>Name</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead className="text-right">Contacts</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody className="grid">
                {companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className="grid transition-colors hover:bg-muted/50"
                    style={{ gridTemplateColumns: COLUMN_WIDTHS }}
                  >
                    <TableCell className="flex items-center overflow-hidden">
                      <span className="block truncate font-medium">
                        {company.name}
                      </span>
                    </TableCell>
                    <TableCell className="flex items-center overflow-hidden">
                      <span className="text-muted-foreground block truncate text-sm">
                        {company.domain ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="flex items-center overflow-hidden">
                      <span className="text-muted-foreground block truncate text-sm">
                        {company.industry ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="flex items-center justify-end">
                      {/* Absent on single-record responses; 0 is a real answer here. */}
                      <span className="tabular-nums text-sm">
                        {company.peopleCount ?? 0}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

function NewCompanyDialog({
  pending,
  error,
  onCreate,
}: {
  pending: boolean
  error: boolean
  onCreate: (body: { name: string; domain?: string; industry?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [domain, setDomain] = useState("")
  const [industry, setIndustry] = useState("")

  const canSubmit = name.trim().length > 0 && !pending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    onCreate({
      name: name.trim(),
      // Empty strings become "absent" rather than an empty column. The API treats null
      // as "leave alone" on update and "" as a value on create, so sending "" here would
      // store a blank domain instead of none.
      ...(domain.trim() ? { domain: domain.trim() } : {}),
      ...(industry.trim() ? { industry: industry.trim() } : {}),
    })
    setName("")
    setDomain("")
    setIndustry("")
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setName("")
          setDomain("")
          setIndustry("")
        }
      }}
    >
      {/* Base UI: render={...} for a custom trigger. asChild is Radix and does nothing. */}
      <DialogTrigger
        render={
          <Button>
            <RiAddLine aria-hidden data-icon="inline-start" />
            New company
          </Button>
        }
      />

      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New company</DialogTitle>
            <DialogDescription>
              Only a name is required. Everything else can wait.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="my-4">
            <Field>
              <FieldLabel htmlFor="company-name">Name</FieldLabel>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Northside Roofing"
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-domain">Domain</FieldLabel>
              <Input
                id="company-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="northside.test"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="company-industry">Industry</FieldLabel>
              <Input
                id="company-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Roofing"
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            {error && (
              <p role="alert" className="text-destructive mr-auto text-sm">
                Could not save. Try again.
              </p>
            )}
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  <span className={cn(pending && "opacity-0")}>Cancel</span>
                </Button>
              }
            />
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}