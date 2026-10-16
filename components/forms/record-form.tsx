"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

/**
 * Shared form plumbing for every create and edit dialog in the product.
 *
 * This exists because there were four copies of the same scaffolding — new lead, edit
 * lead, new company, edit company — and the bug that started this was a fifth copy of the
 * same idea: one `companyBody` helper used for both create and update, which is right for
 * create and wrong for update. Two copies of a rule is how that happened once already;
 * four is how it happens again on a table nobody remembers.
 *
 * The field sets stay separate. A person's fields and a company's genuinely differ, and
 * pretending otherwise buys an abstraction nobody can read.
 */

/** A form's values. Every field in every form in this product is a string. */
export type Draft = Record<string, string>

/**
 * The fields a form cannot be submitted without. Passed to every builder below, so the
 * guard on the submit button and the body that gets sent cannot disagree about which
 * fields are required.
 */
export type RequiredFields = readonly string[]

/** A body known to contain every field in `required`. */
export type Body<R extends RequiredFields> = Record<string, string> & Record<R[number], string>

/**
 * Body for a CREATE: blank fields are dropped so the column is never written.
 *
 * Sending "" on create would store an empty string, which the read path renders as a
 * blank link rather than the "—" a missing value gets.
 *
 * Typed against the required list so the caller does not cast: the submit button is
 * disabled until those fields are filled, so by the time this runs they are present.
 */
export function newBody<R extends RequiredFields>(draft: Draft, required: R): Body<R> {
  assertPresent(draft, required)
  const body: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft)) {
    const trimmed = value.trim()
    if (trimmed) body[key] = trimmed
  }
  return body as Body<R>
}

/**
 * Body for an UPDATE: every field is sent, blanks included.
 *
 * A blank becomes "" and the SQL's NULLIF turns that into a real NULL, which is the only
 * way a PATCH can remove a value — omitting the key means "leave it alone". This is the
 * rule that was broken once and is now stated once, here.
 */
export function updateBody<R extends RequiredFields>(draft: Draft, required: R): Body<R> {
  assertPresent(draft, required)
  const body: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft)) {
    body[key] = value.trim()
  }
  return body as Body<R>
}

/**
 * Guard the builders, so the typing and the runtime agree.
 *
 * A missing required field means a form was wired without isSubmittable, which would
 * otherwise send a body the API rejects with a message nobody can act on. Failing here
 * names the field instead.
 */
function assertPresent(draft: Draft, required: RequiredFields) {
  for (const key of required) {
    if (!(draft[key] ?? "").trim()) {
      throw new Error(`form body is missing required field "${key}"`)
    }
  }
}

/** True when every required field has something in it — the submit button's disabled state. */
export function isSubmittable(draft: Draft, required: RequiredFields): boolean {
  return required.every((key) => (draft[key] ?? "").trim().length > 0)
}

/**
 * The create/edit dialog shell: title, description, fields, a submit that cannot fire on
 * an empty required field, a spinner, an error line, and a cancel.
 *
 * `renderExtra` slots a destructive action in the footer — used only by the company edit
 * dialog, which can delete. It is a slot rather than a prop soup because one caller out
 * of four does not justify four more booleans.
 */
export function RecordDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submitLabel,
  pending,
  error,
  canSubmit,
  onSubmit,
  footerAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** The fields themselves. The caller closes over its own draft state. */
  fields: React.ReactNode
  submitLabel: string
  pending: boolean
  error: boolean
  canSubmit: boolean
  onSubmit: () => void
  /**
   * A destructive action rendered at the left of the footer — a Delete button that opens
   * its own confirm. Not a trigger: the trigger for this dialog is the caller's job and
   * must be a sibling, not nested in here.
   */
  footerAction?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit && !pending) onSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="my-4">{fields}</div>

          <DialogFooter>
            {error && (
              <p role="alert" className="text-destructive mr-auto text-sm">
                Could not save. Try again.
              </p>
            )}
            {footerAction}
            <DialogClose
              render={
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={!canSubmit || pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The "New …" button that opens a RecordDialog.
 *
 * A plain Button, not a DialogTrigger. The trigger has to be a *sibling* of the dialog
 * content — nesting one inside the other renders a button that cannot open the dialog,
 * which is exactly what happened when this was written as a DialogTrigger first. The
 * caller owns the open state and renders this beside the dialog.
 */
export function NewRecordTrigger({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    // h-11 below md. This is the one control every mobile session starts with, and the
    // default h-8 is a 32px target.
    <Button type="button" onClick={onClick} className="max-md:h-11 max-md:px-4">
      {icon}
      {label}
    </Button>
  )
}

/**
 * Draft state for a dialog that opens, edits and closes.
 *
 * Returns the draft plus a reset, so an edit dialog re-seeds from the record each time it
 * opens rather than showing whatever was last typed into it.
 */
export function useDraft(initial: Draft) {
  const [draft, setDraft] = useState<Draft>(initial)
  return {
    draft,
    setDraft,
    reset: () => setDraft(initial),
  }
}