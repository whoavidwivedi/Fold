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
            {/* The bar is as tall as its own contents and carries three things: the nav
                trigger (mobile only, since the sidebar is visible above md), the account
                menu, and the realtime badge.

                It used to be a fixed 48px that printed "Fold" — a word the sidebar header
                already says — and nothing else. 48px of nothing on every page, and the
                page's own <h1> was pushed 48px down from the top of the content area.

                The account menu is here rather than in the sidebar footer because the
                sidebar is a closed sheet below md, which is how signing out disappeared
                once already. Duplicating it into both places put two "Live" badges in the
                DOM and broke every getByText("Live") in the suite, so: one instance. */}
            <header className="bg-background/95 sticky top-0 z-30 flex shrink-0 items-center gap-2 px-4 py-1.5">
              <SidebarTrigger className="-ml-1 md:hidden" />
              {/* The wordmark lives here on a phone, where the sidebar that normally
                  carries it is a closed sheet, and nowhere above md, where it is already
                  on screen. Printing it at both widths is what made this bar 48px of
                  nothing. */}
              <span className="text-sm font-medium md:hidden">Fold</span>
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