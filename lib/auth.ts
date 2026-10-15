import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { organization, jwt } from "better-auth/plugins"
import { nextCookies } from "better-auth/next-js"

import { authSchema } from "@/lib/db/auth-schema"

/**
 * Better Auth — identity for the whole platform.
 *
 * Runs inside Next.js because it needs `nextCookies()`, RSC session reads and Server
 * Actions. The Go API never talks to this server; it verifies the tokens this config
 * mints against the JWKS endpoint. See docs/adr/0001.
 *
 * The `organization` plugin is our entire tenancy model: an organization IS a workspace,
 * and `organization.id` is the `workspace_id` on every table in the Go API.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
})

// A provider only appears if both halves of its credentials are set. Passing
// `clientId: ""` registers a provider that fails at sign-in time, which is a confusing
// way to discover a missing env var.
const socialProviders = {
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
    ? {
        microsoft: {
          clientId: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        },
      }
    : {}),
}

export const auth = betterAuth({
  // Drizzle, not Better Auth's built-in Kysely adapter. That adapter mis-binds query
  // parameters against `pg` in 1.7.9 — every query dies with
  //   invalid input syntax for type bigint: "{"limit":1}"
  // i.e. the whole options object is spliced into the SQL as a parameter. Reproduced
  // with a bare Pool, with {provider, url}, with search_path, and on kysely 0.28 and
  // 0.29. The Drizzle adapter is a separate code path and works.
  //
  // authSchema must be kept in step with api/migrations/00002_auth.sql.
  database: drizzleAdapter(drizzle(pool), {
    provider: "pg",
    schema: authSchema,
  }),

  // uuid ids, so the CRM tables can hold real foreign keys to public.organization(id).
  // Postgres has no FK from uuid to text, and the column types in migrations/00002
  // depend on this setting. Changing it means a migration on both sides.
  advanced: {
    database: { generateId: "uuid" },
  },

  emailAndPassword: { enabled: true },
  socialProviders,

  // Rate limiting stays on in production — it is real protection against credential
  // stuffing. It is the one setting the browser smoke suite cannot tolerate: every test
  // signs up a fresh account, and the sign-ups share an IP, so the limiter answers
  // "Too many requests" mid-suite and three tests die on a timeout that looks nothing
  // like a rate limit. That is exactly the class of failure docs/adr/0008 exists to
  // catch, and it stayed hidden because this suite had never actually run in CI.
  //
  // Test and CI runners are trusted, single-user, and ephemeral, so the protection buys
  // nothing there. Set BETTER_AUTH_RATE_LIMIT=off to disable it anywhere else.
  rateLimit: {
    enabled: process.env.BETTER_AUTH_RATE_LIMIT !== "off",
  },

  session: {
    // Keeps navigation from hitting the database on every request.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  plugins: [
    organization({
      // An agency-style customer can hold many client workspaces. This is the only
      // hierarchy we model today — see docs/adr/0005 for why nothing deeper exists.
      allowUserToCreateOrganization: true,
      organizationLimit: 50,
      membershipLimit: 500,
    }),

    jwt({
      jwks: {
        // EdDSA (Ed25519). Go verifies offline against the JWKS — no database lookup on
        // the hot auth path.
        keyPairConfig: { alg: "EdDSA" },
      },
      jwt: {
        // 5 minutes, not the 15-minute default: a JWT cannot be revoked, so this bounds
        // how long a member removed from a workspace keeps access. Lower is the only
        // lever we have until revocation lands.
        expirationTime: "5m",
        definePayload: ({ session }) => ({
          // The claim the Go API reads for tenant scoping. If it is missing the API
          // returns 401 rather than guessing — see internal/auth/jwks.go.
          workspace_id: session.activeOrganizationId ?? "",
        }),
      },
    }),

    // MUST be last. Cookies set from a Server Action are dropped if anything follows it.
    nextCookies(),
  ],
})

export type Session = typeof auth.$Infer.Session