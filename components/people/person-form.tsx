"use client"

import { useMemo } from "react"

import { listCompanies } from "@/lib/api/generated/endpoints/companies/companies"
import { useQuery } from "@tanstack/react-query"

import type { Draft } from "@/components/forms/record-form"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { STAGES } from "@/components/people/fields"

/**
 * The editable shape of a lead.
 *
 * One component for both the create and the edit form. They are the same seven fields,
 * and a CRM that shows a field on one screen and not the other is worse than either.
 */
export type PersonDraft = {
  firstName: string
  lastName: string
  email: string
  phone: string
  jobTitle: string
  companyId: string
  score: string
  scoreFit: string
  scoreIntent: string
}


/**
 * Sentinel for "this lead belongs to no company".
 *
 * A uuid column has no empty value, so the API cannot express "clear it" the way it can
 * for a string. Omitting companyId means "leave it alone"; this value means "unassign".
 * See UpdatePerson in api/queries/person.sql.
 */
export const NO_COMPANY = "00000000-0000-0000-0000-000000000000"

export function PersonFormFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft
  onChange: (next: Draft) => void
  /** Unique per dialog. Two dialogs on a page would otherwise share ids and labels. */
  idPrefix: string
}) {
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value })

  return (
    <FieldGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-first`}>First name</FieldLabel>
          <Input
            id={`${idPrefix}-first`}
            value={draft.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            autoFocus
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-last`}>Last name</FieldLabel>
          <Input
            id={`${idPrefix}-last`}
            value={draft.lastName}
            onChange={(e) => set("lastName", e.target.value)}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-email`}>Email</FieldLabel>
        <Input
          id={`${idPrefix}-email`}
          type="email"
          value={draft.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="name@company.com"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-phone`}>Phone</FieldLabel>
          <Input
            id={`${idPrefix}-phone`}
            value={draft.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-title`}>Job title</FieldLabel>
          <Input
            id={`${idPrefix}-title`}
            value={draft.jobTitle}
            onChange={(e) => set("jobTitle", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-stage`}>Stage</FieldLabel>
          {/* items, not just children: Base UI renders SelectValue from this collection. */}
          <Select
            items={STAGES}
            value={draft.lifecycleStage}
            onValueChange={(v) => v && set("lifecycleStage", v as string)}
          >
            <SelectTrigger id={`${idPrefix}-stage`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${idPrefix}-company`}>Company</FieldLabel>
          <CompanyPicker
            idPrefix={idPrefix}
            value={draft.companyId}
            onChange={(v) => set("companyId", v)}
          />
        </Field>
      </div>

      {/* Score was three columns every handler read and nothing wrote, so the list
          rendered a column of nothing across every row. 0-100, and blank means "leave it
          alone" — an input of 0 would be indistinguishable from a deliberate zero, and a
          PATCH cannot clear a field by sending nothing. */}
      <Field>
        <FieldLabel>Score</FieldLabel>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["score", "Total"],
              ["scoreFit", "Fit"],
              ["scoreIntent", "Intent"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel
                htmlFor={`${idPrefix}-${key}`}
                className="text-muted-foreground text-xs font-normal"
              >
                {label}
              </FieldLabel>
              <Input
                id={`${idPrefix}-${key}`}
                type="number"
                min={0}
                max={100}
                placeholder="—"
                value={draft[key] ?? ""}
                onChange={(e) => set(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      </Field>
    </FieldGroup>
  )
}

function CompanyPicker({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: string
  onChange: (v: string) => void
}) {
  const companies = useQuery({
    queryKey: ["companies", { search: "" }],
    queryFn: async () => {
      const res = await listCompanies({ limit: 100 })
      if (res.status !== 200) throw new Error("could not load companies")
      return res.data
    },
    staleTime: 5 * 60_000,
  })

  const options = useMemo(
    () => [
      { value: NO_COMPANY, label: "No company" },
      ...(companies.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [companies.data],
  )

  return (
    <>
      <Select items={options} value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger id={`${idPrefix}-company`} className="w-full">
          <SelectValue placeholder="No company" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {companies.isPending && (
        <FieldDescription>Loading companies…</FieldDescription>
      )}
    </>
  )
}