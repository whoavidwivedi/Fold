"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from "@/lib/api/generated/endpoints/companies/companies"
import type { Company } from "@/lib/api/generated/model"

import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { CompanyFormFields } from "@/components/companies/company-form"
import {
  RecordTable,
  TableCell,
  TableRow,
  cellClass,
  gridRow,
  nameButtonClass,
  rowClass,
} from "@/components/data/record-table"
import {
  NewRecordTrigger,
  RecordDialog,
  isSubmittable,
  newBody,
  updateBody,
  type Draft,
} from "@/components/forms/record-form"

const PAGE_SIZE = 50

// One grid template, handed to RecordTable which applies it to the header and every row.
// Mirrors components/people/people-table.tsx — the two lists must not drift apart.
const COLUMN_WIDTHS =
  "minmax(200px, 2fr) minmax(160px, 1.2fr) minmax(140px, 1fr) minmax(80px, auto)"
const TABLE_MIN_WIDTH = 640

/** A company needs a name and nothing else. Named once so the guard and the body agree. */
const REQUIRED = ["name"] as const

const EMPTY: Draft = {
  name: "",
  domain: "",
  industry: "",
  size: "",
  location: "",
}

/**
 * The companies list.
 *
 * Deliberately not virtualized, unlike the leads table. A workspace holds orders of
 * magnitude fewer companies than people, so a windowed list here would be machinery with
 * nothing to window. Add it when a workspace has enough companies for it to matter.
 */
export function CompaniesTable() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 250)

  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<Company | null>(null)

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
    mutationFn: (draft: Draft) => createCompany(newBody(draft, REQUIRED)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      // Closed on success, not on click, so a failed save keeps what was typed.
      setCreateOpen(false)
      setCreateDraft(EMPTY)
    },
  })

  const update = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: Draft }) =>
      updateCompany(id, updateBody(draft, REQUIRED)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      // The lead list shows a contacts count per company row, so it moves too.
      await queryClient.invalidateQueries({ queryKey: ["people"] })
      setEditing(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      await queryClient.invalidateQueries({ queryKey: ["people"] })
      // Cancel, save and delete all close the dialog the same way. Leaving it open after
      // a delete is the bug the lead drawer had: a modal sitting on top of the list you
      // are trying to check.
      setEditing(null)
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

        <div className="ml-auto flex items-center gap-2">
          <NewRecordTrigger
            label="New company"
            icon={<RiAddLine aria-hidden data-icon="inline-start" />}
            onClick={() => setCreateOpen(true)}
          />
          <RecordDialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next)
              if (!next) setCreateDraft(EMPTY)
            }}
            title="New company"
            description="Only a name is required. Everything else can wait."
            fields={
              <CompanyFormFields
                draft={createDraft}
                onChange={setCreateDraft}
                idPrefix="new-company"
              />
            }
            submitLabel="Create"
            pending={create.isPending}
            error={create.isError}
            canSubmit={isSubmittable(createDraft, REQUIRED)}
            onSubmit={() => create.mutate(createDraft)}
          />
        </div>
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
        <>
        {/* The table is hidden below md, where four columns cannot fit a phone. */}
        <RecordTable
          className="hidden md:block"
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
              className={rowClass()}
              style={gridRow(COLUMN_WIDTHS)}
              onClick={() => setEditing(company)}
            >
              <TableCell className={cellClass()}>
                {/* A <tr> is not a control. role="button" here would erase the row from
                    screen-reader table navigation, so the name is the button and the row
                    handler is the pointer shortcut beside it. */}
                <button
                  type="button"
                  onClick={() => setEditing(company)}
                  className={nameButtonClass()}
                >
                  {company.name}
                </button>
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

        {/* Cards below md. Four columns cannot fit a phone without cutting the domain in
            half, and the leads list switches to cards at the same breakpoint for the
            same reason. */}
        <ul className="divide-border divide-y overflow-hidden rounded-lg border md:hidden">
          {companies.map((company) => (
            <li key={company.id}>
              {/* Spans, not divs: a button's content model is phrasing content only. */}
              <button
                type="button"
                onClick={() => setEditing(company)}
                className="hover:bg-muted/50 flex w-full flex-col gap-1 p-3 text-left transition-colors"
              >
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
              </button>
            </li>
          ))}
        </ul>
        </>
      )}

      {editing && (
        <EditCompanyDialog
          key={editing.id}
          company={editing}
          pending={update.isPending}
          deleting={remove.isPending}
          error={update.isError}
          onSave={(draft) => update.mutateAsync({ id: editing.id, draft })}
          onDelete={() => remove.mutate(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * Edit or delete one company.
 *
 * The clearing rules are the ones in components/forms/record-form: a blank field is sent
 * as "" and the SQL's NULLIF turns that into a real NULL, so emptying a domain removes it
 * rather than storing an empty string that renders as a blank link.
 */
function EditCompanyDialog({
  company,
  pending,
  deleting,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  company: Company
  pending: boolean
  deleting: boolean
  error: boolean
  onSave: (draft: Draft) => Promise<unknown>
  onDelete: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft>({
    name: company.name,
    domain: company.domain ?? "",
    industry: company.industry ?? "",
    size: company.size ?? "",
    location: company.location ?? "",
  })
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [failed, setFailed] = useState(false)

  const contacts = company.peopleCount ?? 0

  if (confirmingDelete) {
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {company.name}?</DialogTitle>
            <DialogDescription>
              {contacts
                ? `${contacts} ${contacts === 1 ? "lead is" : "leads are"} linked here and will be kept — they simply stop belonging to this company. Nothing is destroyed.`
                : "This hides the company from the workspace. Nothing is destroyed."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={onDelete}>
              {deleting && <Spinner data-icon="inline-start" />}
              {deleting ? "Deleting…" : "Delete company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <RecordDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Edit ${company.name}`}
      description="Clearing a field removes it rather than leaving it blank."
      fields={
        <CompanyFormFields
          draft={draft}
          onChange={setDraft}
          idPrefix={`edit-${company.id}`}
        />
      }
      submitLabel="Save changes"
      pending={pending}
      error={error || failed}
      canSubmit={isSubmittable(draft, REQUIRED)}
      onSubmit={async () => {
        setFailed(false)
        try {
          await onSave(draft)
        } catch {
          setFailed(true)
        }
      }}
      footerAction={
        <Button
          variant="destructive"
          type="button"
          className="mr-auto"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete
        </Button>
      }
    />
  )
}