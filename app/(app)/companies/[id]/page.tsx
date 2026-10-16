import { CompanyDetail } from "@/components/companies/company-detail"

/**
 * One company, at its own URL.
 *
 * The same decision as /people/[id]: a company row opened a form instead of a place, so
 * it could not be linked to and the back button did nothing. params is async in Next 16.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <main className="h-full overflow-hidden">
      <CompanyDetail companyId={id} />
    </main>
  )
}
