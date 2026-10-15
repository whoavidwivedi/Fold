import { PeopleTable } from "@/components/people/people-table"

export default function PeoplePage() {
  return (
    // h-svh + overflow-hidden so the table virtualizes against a real scroll container
    // instead of growing the page.
    <main className="h-svh overflow-hidden">
      <PeopleTable />
    </main>
  )
}