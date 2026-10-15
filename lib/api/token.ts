import { authClient } from "@/lib/auth-client"

// One module-level token, refreshed on demand. Every API call shares it.
//
// Kept here rather than in each component because: the token is a 5-minute JWT, an AI
// agent needs one contract for "how do I call this API", and a per-component token cache
// is a guaranteed stampede.

let cached: { token: string; expiresAt: number } | null = null
let inFlight: Promise<string | null> | null = null

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
    inFlight = authClient
      .token()
      .then((res) => {
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

export function clearToken() {
  cached = null
  inFlight = null
}