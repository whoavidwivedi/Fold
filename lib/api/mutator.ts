import { getToken } from "@/lib/api/token"

// The Go API's origin. Kept in one place so a future same-origin reverse proxy is a
// one-line change here rather than a sweep through every generated call.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080"

/**
 * The single place the browser talks to the Go API.
 *
 * orval generates typed operations that all route through `customInstance`, so auth is
 * attached in exactly one place and no generated file needs editing when auth changes.
 *
 * Two things worth knowing:
 *  - The token is a short-lived Better Auth JWT, never the session cookie. The Go API
 *    verifies it offline against the JWKS. See docs/adr/0001.
 *  - `getToken` collapses concurrent refreshes into a single request, so a page that
 *    fires four queries on mount mints one token rather than four.
 */
export const customInstance = async <T>(
  url: string,
  options: {
    // orval passes `method` as optional even though every operation sets it, so this
    // accepts it either way rather than forcing a cast at the call site.
    method?: string
    body?: string
    query?: Record<string, unknown>
    headers?: Record<string, string>
    signal?: AbortSignal
    params?: Record<string, unknown>
  } = {},
): Promise<T> => {
  const { method = "GET", body, query, headers: customHeaders, params, ...init } = options
  const search = params ?? query

  // orval emits RELATIVE paths ("/v1/persons"). fetch resolves those against the
  // document origin, which is Next on :3000 — so every API call was hitting Next and
  // 404ing while the Go API sat idle on :8080. Absolute URLs pass through untouched.
  const target = /^https?:\/\//.test(url) ? url : `${API_URL}${url}`

  const urlWithQuery = search
    ? `${target}?${new URLSearchParams(
        Object.entries(search)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()}`
    : target

  const token = await getToken()

  const headers = new Headers(customHeaders)
  headers.set("Accept", "application/json")
  if (token) headers.set("Authorization", `Bearer ${token}`)
  if (body) headers.set("Content-Type", "application/json")

  const response = await fetch(urlWithQuery, {
    ...init,
    method,
    headers,
    body,
  })

  // orval's react-query output expects this envelope, not the bare payload: it types
  // hooks as Awaited<ReturnType<typeof operation>>, so returning a naked object makes
  // every generated hook's `.data` a compile error.
  const payload = await response.json().catch(() => null)
  const envelope = {
    data: payload,
    status: response.status,
    headers: response.headers,
  }

  if (!response.ok) {
    // Huma emits RFC 9457 problem documents. Re-throwing with the whole payload keeps
    // the server's explanation attached to the query that caused it.
    throw Object.assign(new Error(payload?.detail ?? response.statusText), {
      status: response.status,
      payload,
    })
  }

  return envelope as T
}