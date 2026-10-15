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
import { Separator } from "@/components/ui/separator"
import { cn } from "cn"

const NAV = [
  { href: "/people", label: "Leads" },
  { href: "/companies", label: "Companies" },
  { href: "/deals", label: "Pipeline" },
  { href: "/tasks", label: "Tasks" },
  { href: "/reports", label: "Reports" },
] as const

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { status, reason } = useRealtime()
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null)

  // Read once on mount. A layout that re-fetches identity on every navigation is a
  // layout that re-renders the whole shell on every navigation.
  useEffect(() => {
    let active = true
    void authClient.getSession().then(({ data }) => {
      if (!active || !data?.user) return
      setIdentity({
        name: data.user.name ?? "Unnamed",
        email: data.user.email ?? "",
      })
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="bg-sidebar text-sidebar-foreground flex min-h-svh w-full flex-col md:flex-row">
      {/* Sidebar. On mobile this is a top bar rather than a drawer — the nav is four
          items, and a hamburger for four items is one tap too many. */}
      <aside className="flex w-full shrink-0 flex-col gap-4 border-b p-4 md:h-svh md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold tracking-tight">Fold</span>

          <RealtimeIndicator status={status} reason={reason} />
        </div>

        <WorkspaceSwitcher />

        <Separator className="hidden md:block" />

        <nav className="flex gap-1 md:flex-col">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md px-2.5 py-1.5 text-sm",
                  // Nothing in a list gets an entrance animation. See AGENTS.md: this is
                  // navigated dozens of times a session.
                  "transition-colors duration-150",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto hidden md:block">
          <Separator className="mb-3" />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="h-auto w-full justify-start px-2 py-1.5">
                  <Avatar className="size-6">
                    <AvatarFallback>
                      {initials(identity?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm">{identity?.name ?? "…"}</span>
                </Button>
              }
            />
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate text-xs font-normal">
                  {identity?.email}
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
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Realtime status.
 *
 * A subtle dot, not a banner. The stream reconnects on its own, so an alarming
 * treatment would spend most of its life showing a non-problem.
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

  // The title carries the failure reason. "Offline" on its own is a dead end; the
  // reason turns a guess into a diagnosis in one hover.
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