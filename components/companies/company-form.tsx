"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { listCompanies } from "@/lib/api/generated/endpoints/companies/companies"

import type { Draft } from "@/components/forms/record-form"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * A company's fields. Shared by create and edit, exactly as with PersonFormFields — the
 * two dialogs drifted the moment the form had more than a name in it, and a company that
 * can be created but not corrected is worse than one that cannot be created.
 *
 * The draft type itself is the shared one from components/forms/record-form, so a field
 * added here cannot end up missing from one dialog's submit body.
 */
export function CompanyFormFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft
  onChange: (next: Draft) => void
  idPrefix: string
}) {
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value })

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          autoFocus
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-domain`}>Domain</FieldLabel>
          <Input
            id={`${idPrefix}-domain`}
            value={draft.domain}
            onChange={(e) => set("domain", e.target.value)}
            placeholder="northside.test"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-industry`}>Industry</FieldLabel>
          <Input
            id={`${idPrefix}-industry`}
            value={draft.industry}
            onChange={(e) => set("industry", e.target.value)}
            placeholder="Roofing"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-size`}>Size</FieldLabel>
          <Input
            id={`${idPrefix}-size`}
            value={draft.size}
            onChange={(e) => set("size", e.target.value)}
            placeholder="11-50"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-location`}>Location</FieldLabel>
          <Input
            id={`${idPrefix}-location`}
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder="Denver, CO"
          />
        </Field>
      </div>
    </FieldGroup>
  )
}

/**
 * Loads the companies already in this workspace, for callers that need one as a choice.
 *
 * Exported because the lead form's company picker needs the same list, and two queries
 * for one dropdown is the kind of thing that turns into two slightly different lists.
 */
export function useCompanies(limit = 100) {
  return useQuery({
    queryKey: ["companies", { search: "" }],
    queryFn: async () => {
      const res = await listCompanies({ limit })
      if (res.status !== 200) throw new Error("could not load companies")
      return res.data
    },
    staleTime: 5 * 60_000,
  })
}

/** Shared options for a company Select, so a value never renders as a raw uuid. */
export function useCompanyOptions(includeNone = true) {
  const { data } = useCompanies()
  return useMemo(
    () => [
      ...(includeNone ? [{ value: "", label: "No company" }] : []),
      ...(data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [data, includeNone],
  )
}