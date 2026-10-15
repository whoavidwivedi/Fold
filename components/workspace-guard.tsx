"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { clearToken } from "@/lib/api/token"
import { Spinner } from "@/components/ui/spinner"

/**
 * Guarantees the session has an ACTIVE workspace before anything renders.
 *
 * A Better Auth session carries `activeOrganizationId`, and that value becomes the
 * `workspace_id` claim the Go API reads for tenant scoping. Sign-up sets it. Signing in
 * does not — a fresh session can come back with it null, and then every API call is a
 * 401 and realtime is permanently offline, with an empty table and no explanation.
 *
 * It also goes null whenever the cookie is cleared, the user switches device, or they
 * switch away from an org. All of those are ordinary events, not edge cases, so the fix
 * lives at the boundary rather than in the sign-in form.
 *
 * Runs client-side on purpose: `organization.setActive` has to write the session cookie,
 * which is the browser's business. Doing it server-side would mean plumbing Set-Cookie
 * out of a layout.
 */
export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "ready" | "error">("checking")
  const [message, setMessage] = useState<string | null>(null)

  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false

    async function ensure() {
      const { data: session } = await authClient.getSession()
      if (cancelled || !session) return

      // Already scoped to a workspace. Nothing to do.
      if (session.session.activeOrganizationId) {
        setState("ready")
        return
      }

      const { data: orgs } = await authClient.organization.list()
      if (cancelled) return

      // A member of an existing workspace with no active one: pick the first. Making this
      // a choice rather than a default is a product decision we have not made yet, so the
      // first membership is the least surprising placeholder.
      const target = orgs?.[0]

      if (!target) {
        setMessage(
          "This account has no workspace yet. Create one to continue.",
        )
        setState("error")
        return
      }

      const { error } = await authClient.organization.setActive({
        organizationId: target.id,
      })

      if (cancelled) return

      if (error) {
        setMessage(error.message ?? "Could not enter the workspace")
        setState("error")
        return
      }

      // The cached JWT was minted from the previous, unscoped session. Without this the
      // first API call still carries an empty workspace_id.
      clearToken()

      // Anything fetched before the workspace was active was fetched wrong.
      queryClient.invalidateQueries()

      setState("ready")
      router.refresh()
    }

    void ensure()

    return () => {
      cancelled = true
    }
  }, [queryClient, router])

  if (state === "checking") {
    return (
      <div className="grid h-svh place-items-center">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner />
          Opening your workspace…
        </div>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div className="grid h-svh place-items-center px-4">
        <div className="max-w-sm space-y-2 text-center">
          <p className="font-medium">No workspace</p>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}