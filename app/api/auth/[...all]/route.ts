import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"

// Public: this is the auth server's own surface, including /jwks which the Go API
// fetches to verify tokens offline.
export const { GET, POST } = toNextJsHandler(auth)