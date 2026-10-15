import { createAuthClient } from "better-auth/react"
import { jwtClient, organizationClient } from "better-auth/client/plugins"

/**
 * Browser-side auth client.
 *
 * `jwtClient` adds `authClient.token()`, which mints the short-lived EdDSA JWT the Go
 * API verifies. Without it the client only has session cookies, and the Go API cannot
 * read those — it never sees them. See docs/adr/0001.
 *
 * `organizationClient` adds `authClient.organization.*`, needed to create a workspace
 * during sign-up. Without it the workspace_id claim never gets set and the API 401s.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL,
  plugins: [jwtClient(), organizationClient()],
})

export const { signIn, signOut, useSession } = authClient