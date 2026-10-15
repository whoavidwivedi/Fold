"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine, RiExchangeLine } from "@remixicon/react"

import { authClient } from "@/lib/auth-client"
import { clearToken } from "@/lib/api/token"
import { useRealtime } from "@/lib/api/realtime"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"

/**
 * Switch the active workspace.
 *
 * Switching is not just calling setActive. Three caches are keyed to the workspace and
 * all three have to move together, or the app shows one workspace's data while reporting
 * another:
 *
 *   1. The 5-minute JWT carries workspace_id. clearToken() forces a fresh one — without
 *      it every API call for the next five minutes is authorised against the old tenant.
 *   2. Every TanStack query is cached against the old workspace and has to refetch.
 *      invalidateQueries(), and specifically not clear() — see the note at the call site.
 *   3. The SSE stream token is minted from that JWT, so the live stream is subscribed to
 *      the old workspace's events. realtime.reconnect() is the only way to move it.
 *
 * Miss any one and the failure is silent and wrong rather than loud: no error, just a
 * workspace that half works.
 */
export function WorkspaceSwitcher() {
  const queryClient = useQueryClient()
  const { reconnect } = useRealtime()
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: session, refetch } = useWorkspaceSession()
  const [openMenu, setOpenMenu] = useState(false)

  // `session` is stale the moment a switch succeeds — the query is not refetched.
  // undefined means "not overridden yet", so the session value still shows until a switch
  // happens. A plain null would render as "No workspace" for one frame on mount.
  const [override, setOverride] = useState<string | null | undefined>(undefined)
  const activeId = override === undefined ? (session?.activeId ?? null) : override

  async function switchTo(organizationId: string) {
    if (organizationId === activeId || switching) return
    setSwitching(organizationId)
    setError(null)

    const { error: failure } = await authClient.organization.setActive({ organizationId })

    if (failure) {
      setError(failure.message ?? "Could not switch workspace")
      setSwitching(null)
      return
    }

    clearToken()
    // invalidateQueries, NOT clear(). clear() drops the queries from the cache, but a
    // mounted QueryObserver only re-subscribes on its next render — and a switch
    // re-renders this component, not the table. The table would sit there showing the
    // previous workspace's leads until something unrelated happened to re-render it.
    // invalidateQueries refetches every active observer immediately, which is what a
    // tenant change actually needs; the filters are still valid, only the rows are not.
    await queryClient.invalidateQueries()
    reconnect()
    setOverride(organizationId)
    setSwitching(null)
  }

  return (
    <DropdownMenu
      open={openMenu}
      onOpenChange={(next) => {
        setOpenMenu(next)
        // The memberships can change while this component is mounted — a teammate
        // invites you, or a second workspace is created elsewhere — and a switcher that
        // shows a minute-old list cannot be trusted to tell you where you can go.
        // Refreshing only on open keeps that current without polling in the background.
        if (next) void refetch()
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
            aria-label="Switch workspace"
          >
            <RiExchangeLine className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {/* The name is not in the session — only the active id is — so a switcher
                  that cannot say which workspace you are in is worse than none. */}
              <WorkspaceName id={activeId} />
            </span>
            {switching && <Spinner className="shrink-0" />}
          </button>
        }
      />

      <DropdownMenuContent align="start" className="w-56">
        {/* Base UI: MenuGroupLabel throws without an enclosing Menu.Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <WorkspaceList activeId={activeId} switching={switching} onPick={switchTo} />
        </DropdownMenuGroup>

        {error && (
          <>
            <DropdownMenuSeparator />
            <p role="alert" className="text-destructive px-2 py-1.5 text-xs">
              {error}
            </p>
          </>
        )}

        <DropdownMenuSeparator />
        <p className="text-muted-foreground px-2 py-1.5 text-xs">
          Manage workspaces in settings.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceList({
  activeId,
  switching,
  onPick,
}: {
  activeId: string | null
  switching: string | null
  onPick: (id: string) => void
}) {
  const { data: session, isPending } = useWorkspaceSession()
  const orgs = session?.orgs

  if (isPending) {
    return (
      <p className="text-muted-foreground px-2 py-1.5 text-sm">Loading…</p>
    )
  }

  if (!orgs?.length) {
    return (
      <p className="text-muted-foreground px-2 py-1.5 text-sm">No workspaces yet.</p>
    )
  }

  return (
    <>
      {orgs.map((org) => (
        <DropdownMenuItem
          key={org.id}
          onClick={() => onPick(org.id)}
          disabled={switching !== null}
        >
          <span className="min-w-0 flex-1 truncate">{org.name}</span>
          {switching === org.id && (
            <Spinner className="shrink-0" data-icon="inline-end" />
          )}
          {org.id === activeId && switching !== org.id && (
            <RiCheckLine className="shrink-0" aria-hidden />
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/**
 * The workspace's display name.
 *
 * The session carries only an id, so this asks Better Auth for the list rather than
 * rendering the uuid — a sidebar that shows "a3f9…" instead of a company name is not a
 * switcher, it is a debug panel.
 */
function WorkspaceName({ id }: { id: string | null }) {
  const { data: session } = useWorkspaceSession()
  const org = session?.orgs.find((o) => o.id === id)
  return (
    <span className="block truncate text-sm font-medium">
      {org?.name ?? (id ? "Workspace" : "No workspace")}
    </span>
  )
}

/**
 * The membership list and which one is active, in one query.
 *
 * Both are needed to render the label and the menu, and TanStack keys them the same, so
 * this is one request rather than two. The active id comes from the session rather than
 * being passed in: the sidebar reads its session once on mount, so a prop is stale the
 * moment anything switches — which showed the switcher saying "No workspace" while the
 * user was demonstrably in one.
 */
function useWorkspaceSession() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const [orgs, session] = await Promise.all([
        authClient.organization.list(),
        authClient.getSession(),
      ])
      return {
        orgs: orgs.data ?? [],
        activeId: session.data?.session?.activeOrganizationId ?? null,
      }
    },
    // Deliberately short. The active workspace can change under this component, and a
    // minute-old answer would show a tick beside the wrong row.
    staleTime: 5_000,
  })
}