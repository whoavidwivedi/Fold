import { NextResponse, type NextRequest } from "next/server"
import { getCookieCache } from "better-auth/cookies"

// Next 16 renamed middleware.ts to proxy.ts. The edge runtime is NOT supported here —
// this runs on Node and cannot be configured to run anywhere else.
//
// This does an OPTIMISTIC redirect only. getCookieCache reads a signed cookie without
// hitting the database and is explicitly NOT a security check — it does not verify the
// session, only that a cookie-shaped value is present. Real authorization lives in the
// Go API's data access layer and in Postgres row level security. See docs/adr/0002.
//
// Purpose: avoid rendering a shell for a signed-out user, not to protect anything.

const PUBLIC_PATHS = ["/", "/sign-in", "/sign-up", "/api/auth", "/docs"]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  const session = getCookieCache(request)
  if (!session) {
    const signIn = new URL("/sign-in", request.url)
    signIn.searchParams.set("from", pathname)
    return NextResponse.redirect(signIn)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
}