import { authClient } from "@/lib/auth-client"

// One module-level token, refreshed on demand. Every API call shares it.
//
// Kept here rather than in each component because: the token is a 5-minute JWT, an AI
// agent needs one contract for "how do I call this API", and a per-component token cache
// is a guaranteed stampede.

let cached: { token: string; expiresAt: number } | null = null
let inFlight: Promise<string | null> | null = null

/**
 * Bumped by clearToken() so a refresh that is already in flight can tell it is stale.
 *
 * Without this, switching workspaces twice in quick succession silently keeps the first
 * workspace: clearToken() drops the cache, but the pending refresh resolves a moment later
 * and writes the OLD token straight back into it. Every subsequent request is then
 * authorised against the tenant the user just left, and because RLS does its job the
 * response is a perfectly valid page of the wrong company's leads. No error, no wrong
 * tenant — just plausible data.
 */
let generation = 0

const EXPIRY_SKEW_MS = 30_000

// Matches the `expirationTime` in lib/auth.ts. If one changes, change both — there is no
// way to read `exp` back out of the token through the client.
const TOKEN_TTL_MS = 5 * 60_000

export async function getToken(): Promise<string | null> {
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return cached.token
  }

  // Collapse concurrent refreshes into one request. Without this, a page that fires four
  // parallel queries on mount would mint four tokens.
  if (!inFlight) {
    const startedAt = generation
    inFlight = authClient
      .token()
      .then((res) => {
        // A clearToken() landed while this was in flight. Its answer describes the
        // workspace the user has already left, so it must not be cached — but returning
        // it is still correct for whoever asked, and the next call will mint a fresh one.
        if (startedAt !== generation) {
          return res?.data?.token ?? null
        }

        // Better Auth answers with a { data, error } envelope, so the happy path needs a
        // real narrowing check rather than an optional chain.
        const token = res?.data?.token
        if (!token) {
          cached = null
          return null
        }

        cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
        return token
      })
      .catch(() => {
        // A rejected refresh MUST clear inFlight. Without this, `inFlight` keeps
        // pointing at a settled rejected promise, `??=` never re-assigns it, and every
        // later call returns that same rejection — the token cache is poisoned for the
        // rest of the page's life by one transient network blip.
        cached = null
        return null
      })
      .finally(() => {
        inFlight = null
      })
  }

  return inFlight
}

/**
 * Drop the cached token and invalidate any refresh already running.
 *
 * Called on sign-out and on a workspace switch — the two moments where the cached JWT's
 * workspace_id claim is wrong and every call made with it would be authorised against
 * the wrong tenant.
 */
export function clearToken() {
  generation += 1
  cached = null
  inFlight = null
}