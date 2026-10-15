"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine, RiDeleteBin6Line } from "@remixicon/react"

import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from "@/lib/api/generated/endpoints/companies/companies"
import type { Company } from "@/lib/api/generated/model"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  EMPTY_COMPANY,
  CompanyFormFields,
  type CompanyDraft,
} from "@/components/companies/company-form"
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
    mutationFn: (draft: CompanyDraft) =>
      createCompany(newCompanyBody(draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      // The lead list shows the contacts count from a company row, so it moves too.
      await queryClient.invalidateQueries({ queryKey: ["people"] })
    },
  })

  const [editing, setEditing] = useState<Company | null>(null)

  // Cancel, save and delete all close the dialog the same way. Leaving it open after a
  // delete is the bug the lead drawer had: a modal sitting on top of the list you are
  // trying to check.
  function onEditClosed() {
    setEditing(null)
  }

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
          onCreate={(draft) => create.mutate(draft)}
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
                    onClick={() => setEditing(company)}
                    className="grid cursor-pointer transition-colors hover:bg-muted/50"
                    style={{ gridTemplateColumns: COLUMN_WIDTHS }}
                  >
                    <TableCell className="flex items-center overflow-hidden">
                      {/* A <tr> is not a control. role="button" here would erase the row
                          from screen-reader table navigation, so the name is the button
                          and the row handler is the pointer shortcut beside it. */}
                      <button
                        type="button"
                        onClick={() => setEditing(company)}
                        className="-my-1 block max-w-full truncate px-1 text-left font-medium hover:underline underline-offset-4 focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {company.name}
                      </button>
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
                    <TableCell className="flex items-center justify-end gap-1">
                      {/* Absent on single-record responses; 0 is a real answer here. */}
                      <span className="tabular-nums text-sm">
                        {company.peopleCount ?? 0}
                      </span>
                      <button
                        type="button"
                        aria-label="Delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing(company)
                        }}
                        className="text-muted-foreground hover:text-destructive rounded-sm p-1 transition-colors"
                      >
                        <RiDeleteBin6Line className="size-4" aria-hidden />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {editing && (
        <EditCompanyDialog
          key={editing.id}
          company={editing}
          pending={remove.isPending}
          onSave={(draft) =>
            updateCompany(editing.id, companyUpdateBody(draft)).then(async () => {
              await queryClient.invalidateQueries({ queryKey: ["companies"] })
              await queryClient.invalidateQueries({ queryKey: ["people"] })
            })
          }
          onDelete={() => {
            remove.mutate(editing.id, { onSuccess: onEditClosed })
          }}
          onClose={onEditClosed}
        />
      )}
    </div>
  )
}

/**
 * Body for a create: blanks are dropped, so the column is never written at all.
 *
 * Deliberately NOT shared with the update path, despite looking identical. Sharing them
 * is exactly the drift these tests exist to catch, and it was caught: a body that drops
 * blanks is right on create and wrong on update, where a blank means "clear this" and
 * omitting it means "leave it alone". One combined helper silently made the company form
 * unable to empty a single field.
 */
function newCompanyBody(draft: CompanyDraft) {
  return {
    name: draft.name.trim(),
    ...(draft.domain.trim() ? { domain: draft.domain.trim() } : {}),
    ...(draft.industry.trim() ? { industry: draft.industry.trim() } : {}),
    ...(draft.size.trim() ? { size: draft.size.trim() } : {}),
    ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
  }
}

/**
 * Body for an update: every field is sent, blanks included.
 *
 * A blank becomes "" and the SQL's NULLIF turns that into a real NULL, which is the only
 * way a PATCH can remove a value. Omitting the key would leave the existing one alone.
 */
function companyUpdateBody(draft: CompanyDraft) {
  return {
    name: draft.name.trim(),
    domain: draft.domain.trim(),
    industry: draft.industry.trim(),
    size: draft.size.trim(),
    location: draft.location.trim(),
  }
}

function NewCompanyDialog({
  pending,
  error,
  onCreate,
}: {
  pending: boolean
  error: boolean
  onCreate: (draft: CompanyDraft) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_COMPANY)

  const canSubmit = draft.name.trim().length > 0 && !pending

  function close() {
    setOpen(false)
    setDraft(EMPTY_COMPANY)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      {/* Base UI takes a custom trigger through render={...}. asChild is Radix. */}
      <DialogTrigger
        render={
          <Button>
            <RiAddLine aria-hidden data-icon="inline-start" />
            New company
          </Button>
        }
      />

      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            onCreate(draft)
            close()
          }}
        >
          <DialogHeader>
            <DialogTitle>New company</DialogTitle>
            <DialogDescription>
              Only a name is required. Everything else can wait.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4">
            <CompanyFormFields draft={draft} onChange={setDraft} idPrefix="new-company" />
          </div>

          <DialogFooter>
            {error && (
              <p role="alert" className="text-destructive mr-auto text-sm">
                Could not save. Try again.
              </p>
            )}
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  Cancel
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

/**
 * Edit or delete one company.
 *
 * Both existed as API calls with no button, the same gap the lead form had. The clearing
 * rules are the ones the Go test in internal/dbstore pins: a blank field is sent as ""
 * and the SQL's NULLIF turns that into a real NULL, so emptying a domain removes it
 * rather than storing an empty string that renders as a blank link.
 */
function EditCompanyDialog({
  company,
  pending,
  onSave,
  onDelete,
  onClose,
}: {
  company: Company
  pending: boolean
  onSave: (draft: CompanyDraft) => Promise<unknown>
  onDelete: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CompanyDraft>({
    name: company.name,
    domain: company.domain ?? "",
    industry: company.industry ?? "",
    size: company.size ?? "",
    location: company.location ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState(false)

  const canSubmit = draft.name.trim().length > 0 && !saving
  const contacts = company.peopleCount

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {confirmingDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete {company.name}?</DialogTitle>
              <DialogDescription>
                {contacts
                  ? `${contacts} ${contacts === 1 ? "lead is" : "leads are"} linked to this company and will be kept — they simply stop belonging to it. Nothing is destroyed.`
                  : "This hides the company from the workspace. Nothing is destroyed."}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button variant="destructive" disabled={pending} onClick={onDelete}>
                {pending && <Spinner data-icon="inline-start" />}
                {pending ? "Deleting…" : "Delete company"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!canSubmit) return
              setSaving(true)
              setError(false)
              try {
                await onSave(draft)
                onClose()
              } catch {
                setError(true)
              } finally {
                setSaving(false)
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit {company.name}</DialogTitle>
              <DialogDescription>
                Clearing a field removes it rather than leaving it blank.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4">
              <CompanyFormFields
                draft={draft}
                onChange={setDraft}
                idPrefix={`edit-${company.id}`}
              />
            </div>

            <DialogFooter>
              {error && (
                <p role="alert" className="text-destructive mr-auto text-sm">
                  Could not save. Try again.
                </p>
              )}
              <Button
                variant="ghost"
                type="button"
                className="text-destructive mr-auto"
                onClick={() => setConfirmingDelete(true)}
              >
                <RiDeleteBin6Line aria-hidden data-icon="inline-start" />
                Delete
              </Button>
              <DialogClose
                render={
                  <Button variant="outline" type="button">
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={!canSubmit}>
                {saving && <Spinner data-icon="inline-start" />}
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
