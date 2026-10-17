"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiArrowLeftSLine, RiCheckLine } from "@remixicon/react"

import { createCompany } from "@/lib/api/generated/endpoints/companies/companies"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { isSubmittable, newBody, type Draft } from "@/components/forms/record-form"
import { CompanyFormFields } from "@/components/companies/company-form"

const REQUIRED = ["name"] as const

const EMPTY: Draft = {
  name: "",
  domain: "",
  industry: "",
  employees: "",
}

/**
 * Adding a company, at its own URL: `/companies/new`.
 *
 * The same argument as `/people/new`, and for the same reason: a dialog covers the list it
 * was launched from. Three companies in a row meant dismiss, re-orient, type, submit,
 * dismiss — and a failed save left you with a scrim over the companies you wanted to
 * check a typo against.
 *
 * A route is linkable, Back closes it, a reload does not lose it, and the list is never
 * covered because it is not on screen. See AGENTS.md — a record is a route, not a sheet,
 * and creating one is the same argument.
 */
export function CompanyCreate() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Draft>(EMPTY)

  const create = useMutation({
    mutationFn: (draft: Draft) => createCompany(newBody(draft, REQUIRED)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] })
      // Back to the list, not to the new record. A company record is mostly contacts, and
      // a company you just created has none — so the thing you want next is the list.
      router.push("/companies")
    },
  })

  const canSubmit = isSubmittable(draft, REQUIRED) && !create.isPending

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      <Button
        variant="ghost"
        type="button"
        onClick={() => router.back()}
        className="-ml-3 mb-4"
      >
        <RiArrowLeftSLine data-icon="inline-start" aria-hidden />
        Companies
      </Button>

      <div className="bg-card rounded-lg border p-6">
        <header className="mb-6">
          <h1 className="text-2xl">New company</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Only a name is required. Everything else can wait.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) create.mutate(draft)
          }}
        >
          <CompanyFormFields draft={draft} onChange={setDraft} idPrefix="new-company" />

          {create.isError && (
            <p role="alert" className="text-destructive mt-4 text-sm">
              Could not save. Your details are still here — try again.
            </p>
          )}

          {/* Sticky, so Create is reachable from the bottom of a long form on a phone
              without scrolling back up to find it. The save is the whole point of the
              page; it should never be the thing you have to go looking for. */}
          <div className="bg-card sticky bottom-0 -mx-6 mt-6 border-t px-6 py-4">
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => router.back()}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {create.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RiCheckLine data-icon="inline-start" aria-hidden />
                )}
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
