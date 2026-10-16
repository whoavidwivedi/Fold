import type { Metadata } from "next"

import { SignInForm } from "./sign-in-form"

export const metadata: Metadata = { title: "Sign in · Fold" }

/**
 * The login-01 / signup-01 page shell: a centred column, `max-w-sm`, so the card is the
 * only thing on the page. The form itself is a shadcn Card and is unchanged — it owns
 * the Better Auth call, which a presentational block has no business owning.
 */
export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <SignInForm />
      </div>
    </div>
  )
}
