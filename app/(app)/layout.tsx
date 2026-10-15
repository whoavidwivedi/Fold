import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { AppSidebar } from "@/components/app-sidebar"
import { Providers } from "@/components/providers"
import { WorkspaceGuard } from "@/components/workspace-guard"

/**
 * The signed-in shell.
 *
 * The session is read here, server-side, so an unauthenticated request never renders the
 * app at all. proxy.ts only does an optimistic redirect; this is the real check. See
 * docs/adr/0002 for why authz actually lives in the Go API and Postgres, not here.
 *
 * WorkspaceGuard sits inside Providers because it needs the query client to invalidate
 * everything fetched before the workspace was active.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    redirect("/sign-in")
  }

  return (
    <Providers>
      <WorkspaceGuard>
        <AppSidebar>{children}</AppSidebar>
      </WorkspaceGuard>
    </Providers>
  )
}