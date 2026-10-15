import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

/**
 * Not built yet.
 *
 * The sidebar links here so the shell reads as the product it will be. A 404 on click is
 * a worse signal than an honest placeholder, and this page costs six lines.
 */
export default function Page() {
  return (
    <main className="grid h-svh place-items-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>Reports</EmptyTitle>
          <EmptyDescription>Funnel, conversion and source ROI, computed from the append-only event log in Phase 4.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}
