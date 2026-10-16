"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  deleteCompany,
  getCompany,
  updateCompany,
} from "@/lib/api/generated/endpoints/companies/companies"
import { listPersons } from "@/lib/api/generated/endpoints/people/people"
import type { Company } from "@/lib/api/generated/model"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { CompanyFormFields } from "@/components/companies/company-form"
import {
  RecordTable,
  TableCell,
  TableRow,
  cellClass,
  clickableRowClass,
  gridRow,
  nameButtonClass,
  rowClass,
} from "@/components/data/record-table"
import {
  RecordDialog,
  isSubmittable,
  updateBody,
  type Draft,
} from "@/components/forms/record-form"
import { RiUserLine } from "@remixicon/react"

import { StageBadge } from "@/components/people/fields"

/** A company needs a name and nothing else. Named once so the guard and the body agree. */
const REQUIRED = ["name"] as const

const CONTACT_COLUMNS = "minmax(200px, 2fr) minmax(200px, 1.5fr) minmax(120px, auto)"
const CONTACTS_MIN_WIDTH = 520

/**
 * One company, at its own URL.
 *
 * The mirror of the lead record page, because a company was the one record still behind
 * a dialog — so its row opened a form rather than a place. Same reasons apply: linkable,
 * back-button aware, somewhere to stay while you read.
 */
export function CompanyDetail({ companyId }: { companyId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const company = useQuery({
    queryKey: ["company", companyId],
    queryFn: async () => {
      const res = await getCompany(companyId)
      if (res.status !== 200) throw new Error("could not load company")
      // peopleCount is a sibling of the company, not a field on it — dropping it here is
      // how the delete confirm ends up claiming a company has no contacts when it has.
      return { ...res.data.company, peopleCount: res.data.peopleCount ?? 0 }
    },
    retry: false,
  })

  // The contacts already live in the lead list's cache under this filter, so opening a
  // company after browsing leads shows rows rather than a spinner.
  const contacts = useQuery({
    queryKey: ["people", { companyId }],
    queryFn: async () => {
      const res = await listPersons({ companyId, limit: 100 })
      if (res.status !== 200) throw new Error("could not load contacts")
      return res.data
    },
    enabled: company.isSuccess,
  })

  const remove = useMutation({
    mutationFn: () => deleteCompany(companyId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      await queryClient.invalidateQueries({ queryKey: ["people"] })
      // Deleting detaches the contacts rather than destroying them, so there is no
      // record left to show.
      router.push("/companies")
    },
  })

  if (company.isError) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyTitle>This company is not here</EmptyTitle>
            <EmptyDescription>
              It may have been deleted, or it belongs to another workspace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const data = company.data

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:max-w-3xl md:p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {data ? data.name : <Skeleton className="h-6 w-48" />}
          </h1>
          {data && <CompanyFacts company={data} />}
        </div>

        {data && (
          <div className="flex shrink-0 gap-1">
            <EditCompanyDialog company={data} />
            <DeleteCompanyDialog
              company={data}
              contacts={data.peopleCount ?? 0}
              pending={remove.isPending}
              onDelete={() => remove.mutate()}
            />
          </div>
        )}
      </header>

      <section className="flex min-h-0 flex-col gap-2">
        <h2 className="text-muted-foreground text-sm font-medium">
          Contacts
          {contacts.data && <span className="tabular-nums"> · {contacts.data.total}</span>}
        </h2>

        {contacts.isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (contacts.data?.items?.length ?? 0) === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ContactIcon />
              </EmptyMedia>
              <EmptyTitle>Nobody here yet</EmptyTitle>
              <EmptyDescription>
                Open a lead and set their company to put them on this list.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <RecordTable
            columns={CONTACT_COLUMNS}
            minWidth={CONTACTS_MIN_WIDTH}
            headings={[
              { label: "Lead" },
              { label: "Email" },
              { label: "Stage" },
            ]}
            className="rounded-lg border"
          >
            {(contacts.data?.items ?? []).map((person) => (
              // gridRow gives it the header's template; without it the cells stack and
              // the row stops looking like the table it is in.
              <TableRow
                key={person.id}
                className={cn(rowClass(), clickableRowClass(false))}
                style={gridRow(CONTACT_COLUMNS)}
              >
                <TableCell className={cellClass()}>
                  <Link
                    href={`/people/${person.id}`}
                    className={nameButtonClass()}
                  >
                    {[person.firstName, person.lastName].filter(Boolean).join(" ") ||
                      "Unnamed"}
                  </Link>
                </TableCell>
                <TableCell className={cellClass()}>
                  <span className="text-muted-foreground block truncate text-sm">
                    {person.email ?? "—"}
                  </span>
                </TableCell>
                <TableCell className={cellClass()}>
                  <StageBadge stage={person.lifecycleStage} />
                </TableCell>
              </TableRow>
            ))}
          </RecordTable>
        )}
      </section>
    </div>
  )
}

function CompanyFacts({ company }: { company: Company }) {
  const facts = [
    company.domain,
    company.industry,
    company.size && `${company.size} people`,
    company.location,
  ].filter(Boolean) as string[]

  if (facts.length === 0) return null

  return (
    <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
      {facts.map((fact, i) => (
        <span key={fact} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {company.domain && fact === company.domain ? (
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline underline-offset-4"
            >
              {fact}
            </a>
          ) : (
            fact
          )}
        </span>
      ))}
    </p>
  )
}

function ContactIcon() {
  return <RiUserLine aria-hidden />
}

export function EditCompanyDialog({
  company,
}: {
  company: Company
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(toDraft(company))
  const [failed, setFailed] = useState(false)

  // Re-seed from the record on every open, so a realtime update while the dialog was
  // closed is picked up rather than overwritten by whatever was last typed.
  const [seededFor, setSeededFor] = useState(company.updatedAt)
  if (company.updatedAt !== seededFor) {
    setSeededFor(company.updatedAt)
    setDraft(toDraft(company))
  }

  const save = useMutation({
    mutationFn: () =>
      updateCompany(company.id, updateBody(draft, REQUIRED)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      await queryClient.invalidateQueries({ queryKey: ["company", company.id] })
      await queryClient.invalidateQueries({ queryKey: ["people"] })
      setOpen(false)
    },
  })

  return (
    <>
      {/* A plain button, not a DialogTrigger: RecordDialog is itself a Dialog, and
          nesting one inside another leaves a trigger that opens nothing. */}
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <RecordDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setDraft(toDraft(company))
        }}
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
        pending={save.isPending}
        error={save.isError || failed}
        canSubmit={isSubmittable(draft, REQUIRED)}
        onSubmit={async () => {
          setFailed(false)
          try {
            await save.mutateAsync()
          } catch {
            setFailed(true)
          }
        }}
      />
    </>
  )
}

function DeleteCompanyDialog({
  company,
  contacts,
  pending,
  onDelete,
}: {
  company: Company
  contacts: number
  pending: boolean
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
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
          {open && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                onDelete()
                setOpen(false)
              }}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Deleting…" : "Delete company"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}

function toDraft(company: Company): Draft {
  return {
    name: company.name,
    domain: company.domain ?? "",
    industry: company.industry ?? "",
    size: company.size ?? "",
    location: company.location ?? "",
  }
}