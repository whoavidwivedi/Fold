import { RecordDetail } from "@/components/people/record-detail"

/**
 * One lead, at its own URL.
 *
 * A route rather than a dialog because a record is something you link to, come back to
 * with the browser's back button, and stay on while you read the timeline. params is async
 * in Next 16 — see AGENTS.md.
 */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <main className="h-svh overflow-hidden">
      <RecordDetail personId={id} />
    </main>
  )
}
