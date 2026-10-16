import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

/**
 * Not built yet.
 *
 * The sidebar links here so the shell reads as the product it will be. A 404 on click is
 * a worse signal than an honest placeholder, and this page costs six lines.
 */
export default function Page() {
  return (
    <main className="grid h-full place-items-center p-6">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyTitle>Pipeline</EmptyTitle>
          <EmptyDescription>Deals move through stages with an owner and a close date. Kanban and forecasting land in Phase 2.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  )
}
