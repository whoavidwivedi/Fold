import { CompanyCreate } from "@/components/companies/company-create"

/**
 * Adding a company, at its own URL.
 *
 * A route rather than a dialog because a dialog covers the list it came from. See
 * AGENTS.md — a record is a route, not a sheet, and creating one is the same argument.
 */
export default function NewCompanyPage() {
  return (
    <main className="h-full overflow-y-auto">
      <CompanyCreate />
    </main>
  )
}
