import { LeadCreate } from "@/components/people/lead-create"

/**
 * Adding a lead, at its own URL.
 *
 * A route rather than a dialog because a dialog covers the list it came from: three
 * leads in a row meant dismiss, re-orient, type, submit, dismiss, and a failed save left
 * you with a scrim over the records you wanted to check a typo against. Mirrors
 * `/companies/new`.
 */
export default function NewLeadPage() {
  return (
    <main className="h-full overflow-y-auto">
      <LeadCreate />
    </main>
  )
}
