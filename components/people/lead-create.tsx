"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiArrowLeftSLine, RiCheckLine } from "@remixicon/react"

import type { CreateBody } from "@/lib/api/generated/model"
import { createPerson } from "@/lib/api/generated/endpoints/people/people"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { newBody, type Draft } from "@/components/forms/record-form"
import { PersonFormFields } from "@/components/people/person-form"

const EMPTY: Draft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  jobTitle: "",
  lifecycleStage: "new",
  companyId: "",
  score: "",
  scoreFit: "",
  scoreIntent: "",
}

/**
 * Adding a lead, at its own URL: `/people/new`.
 *
 * It was a dialog, and that was wrong for a reason that is not about dialogs. A dialog
 * dims and covers the list it was launched from, so a rep adding three leads in a row
 * dismissed, re-oriented, typed, submitted, dismissed — and if the save failed, the
 * records they wanted to check a typo against were behind a scrim.
 *
 * A route fixes all of it at once. The form is linkable, Back closes it, a reload does
 * not lose what was typed, and the list is never covered because it is not on screen.
 *
 * Mirrors `CompanyCreate` exactly — same shape, same footer, same reasoning. Two lists
 * that behave differently is how a caller ends up wondering which one to copy.
 */
export function LeadCreate() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<Draft>(EMPTY)

  const create = useMutation({
    mutationFn: (draft: Draft) =>
      createPerson({
        ...newBody(draft, []),
        // Always sent, even when empty. CreatePerson requires both name properties to be
        // *present* — a lead with one name is normal, and omitting the other is a 422
        // before the handler runs. newBody drops blanks, so they go after the spread.
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        lifecycleStage: draft.lifecycleStage || "new",
        // Sent only when set. An empty string is a malformed uuid and the API rejects it
        // with a 422 — the same trap the PATCH sentinel exists to avoid.
        ...(draft.companyId ? { companyId: draft.companyId } : {}),
      } as CreateBody),
    onSuccess: async (result) => {
      // orval types the response as a success union with the error model, because the
      // spec documents both. The mutator throws on a non-2xx, so only the success branch
      // can arrive here.
      const created =
        typeof result === "object" && result !== null && "data" in result
          ? (result as { data: { id: string } }).data
          : (result as { id: string })

      await queryClient.invalidateQueries({ queryKey: ["people"] })
      // Straight to the record. The list is one Back away, and the thing you just made
      // is the thing you probably want to see.
      router.push(`/people/${created.id}`)
    },
  })

  // One name is enough — a person has a first or a last, not reliably both. That is why
  // this is not isSubmittable, which insists on every required field.
  const canSubmit =
    (draft.firstName.trim() || draft.lastName.trim()) !== "" && !create.isPending

  return (
    <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
      <Button
        variant="ghost"
        type="button"
        onClick={() => router.back()}
        className="-ml-3 mb-4"
      >
        <RiArrowLeftSLine data-icon="inline-start" aria-hidden />
        Leads
      </Button>

      <div className="rounded-lg border bg-card p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">New lead</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            A name is enough to start. You can fill in the rest from their record.
          </p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) create.mutate(draft)
          }}
        >
          <PersonFormFields draft={draft} onChange={setDraft} idPrefix="new-lead" />

          {create.isError && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              Could not save. Your details are still here — try again.
            </p>
          )}

          {/* Sticky, so Create is reachable from the bottom of a long form on a phone
              without scrolling back up to find it. The save is the whole point of the
              page; it should never be the thing you have to go looking for. */}
          <div className="sticky bottom-0 -mx-6 mt-6 border-t bg-card px-6 py-4">
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
                {create.isPending ? "Creating…" : "Create lead"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
