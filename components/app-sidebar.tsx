"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { useRealtime } from "@/lib/api/realtime"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  RiBuildingLine,
  RiFlagLine,
  RiFolderChartLine,
  RiPriceTagLine,
  RiUserLine,
} from "@remixicon/react"
import { cn } from "cn"

/** `isActive: "url"` means the URL matching is done by the Sidebar, not by hand. */
const NAV = [
  { title: "Leads", url: "/people", icon: RiUserLine },
  { title: "Companies", url: "/companies", icon: RiBuildingLine },
  { title: "Pipeline", url: "/deals", icon: RiPriceTagLine },
  { title: "Tasks", url: "/tasks", icon: RiFlagLine },
  { title: "Reports", url: "/reports", icon: RiFolderChartLine },
]

/**
 * The sidebar, from the shadcn dashboard-01 block.
 *
 * `isActive="url"` is the part that matters. The hand-rolled version computed
 * `pathname.startsWith(href)` itself and painted the active fill, and it drifted from
 * every other sidebar state in the app doing the same job. The component owns it now.
 *
 * The account menu is in the **header**, not the footer: it used to be duplicated as a
 * desktop block and a mobile block, and the mobile copy was hidden on phones, so there
 * was no way to sign out on one.
 */
export function AppSidebar({
  variant = "sidebar",
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  return (
    <Sidebar collapsible="icon" variant={variant} {...props}>
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold tracking-tight">Fold</span>
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {/* The gap lives here, not on SidebarMenu. `SidebarMenu` renders items flush — the
              block's own `nav-main` puts a `gap-2` on the group content for exactly this
              reason, and without it two adjacent hover fills touch and read as one
              smeared block rather than as one item being hovered. */}
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {NAV.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    isActive={pathname.startsWith(item.url)}
                  >
                    <item.icon aria-hidden />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter />
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * The header's right-hand controls: realtime state and the account menu.
 *
 * Split out so the layout can render them in the always-visible top bar. The sidebar is
 * a closed sheet below `md`, so anything inside it is unreachable on a phone — and a
 * sign-out inside a closed sheet is the exact bug this component's docstring says it
 * exists to prevent, reintroduced by swapping to the block's sidebar.
 */
export function AppHeaderControls() {
  const { status, reason } = useRealtime()
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null)

  useEffect(() => {
    let active = true
    void authClient.getSession().then(({ data }) => {
      if (!active || !data?.user) return
      setIdentity({ name: data.user.name ?? "Unnamed", email: data.user.email ?? "" })
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex items-center gap-2">
      <RealtimeIndicator status={status} reason={reason} />
      <AccountMenu name={identity?.name} email={identity?.email} />
    </div>
  )
}

/**
 * Identity and sign-out.
 *
 * One component rather than a desktop-only block and a mobile-only block: two copies of a
 * sign-out is how one of them ends up broken and nobody notices, because the other works.
 */
export function AccountMenu({ name, email }: { name?: string; email?: string }) {
  const router = useRouter()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={name ? `Account: ${name}` : "Account"}
          >
            <Avatar className="size-6">
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent side="right" align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-xs font-normal">
            {email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              void authClient.signOut().then(() => {
                // router.refresh() so the server layout re-reads the session and
                // redirects. A hard navigation would also work but throws away the
                // client cache on the way out for no reason.
                router.push("/sign-in")
                router.refresh()
              })
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Realtime status.
 *
 * A subtle dot, not a banner. The stream reconnects on its own, so an alarming treatment
 * would spend most of its life showing a non-problem. The title carries the reason —
 * "Offline" on its own is a dead end.
 */
function RealtimeIndicator({
  status,
  reason,
}: {
  status: "connecting" | "live" | "offline"
  reason: string | null
}) {
  if (status === "live") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Live
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5"
      title={reason ? `realtime: ${reason}` : "realtime: connecting"}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "connecting" ? "bg-amber-500" : "bg-muted-foreground",
        )}
      />
      {status === "connecting" ? "Connecting" : "Offline"}
    </Badge>
  )
}

function initials(name?: string) {
  if (!name) return "?"
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
