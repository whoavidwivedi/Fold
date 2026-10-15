import { redirect } from "next/navigation"

/**
 * The root is a door, not a page.
 *
 * Rendering the template's starter screen at "/" would be honest about nothing. The
 * layout decides where a visitor actually belongs.
 */
export default function Home() {
  redirect("/people")
}