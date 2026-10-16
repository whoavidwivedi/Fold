import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { auth } from "@/lib/auth"
import { AccountMenu, AppSidebar } from "@/components/app-sidebar"
import { AppHeaderControls } from "@/components/app-sidebar"
import { Providers } from "@/components/providers"
import { WorkspaceGuard } from "@/components/workspace-guard"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

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
    // The dashboard-01 shell: an inset sidebar, a sticky header with the trigger, and the
    // page in the inset. The inset is h-svh and `min-h-0` (see components/ui/sidebar.tsx)
    // because the wrapper was min-h-svh and the document grew past the viewport, which is
    // what scrolled the header off the top of a phone.
    <Providers>
      <WorkspaceGuard>
        <SidebarProvider
          style={
            {
              "--sidebar-width": "16rem",
              "--header-height": "calc(var(--spacing) * 12)",
            } as React.CSSProperties
          }
        >
          <AppSidebar variant="inset" />
          <SidebarInset>
            <header className="border-border bg-background/95 sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <span className="text-sm font-medium">Fold</span>
              {/* The account menu is here, not in the sidebar. The sidebar is a closed
                  sheet below md, so anything inside it is unreachable on a phone — which
                  is how signing out disappeared once already. */}
              <div className="ml-auto">
                <AppHeaderControls />
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </WorkspaceGuard>
    </Providers>
  )
}