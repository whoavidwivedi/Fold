"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

/**
 * Email and password sign-in.
 *
 * After signing in the browser holds a session cookie but no API token yet — the token
 * is minted lazily by getToken() on the first API call and refreshed as it expires. So
 * the redirect is unconditional; the first request in the app is what would fail if
 * something were genuinely wrong.
 */
export function SignInForm() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const { error } = await authClient.signIn.email({ email, password })

    if (error) {
      setError(error.message ?? "Could not sign in")
      setPending(false)
      return
    }

    router.push("/people")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to Fold</CardTitle>
        <CardDescription>Your leads are one click away.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          {/* FieldGroup, not div + grid. See AGENTS.md. */}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>

            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <FieldError>{error}</FieldError>
            </Field>

            {/* Button has no isPending. Compose Spinner + data-icon + disabled. */}
            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Signing in…" : "Sign in"}
            </Button>

            <FieldDescription className="text-center">
              No account?{" "}
              <a href="/sign-up" className="underline underline-offset-4">
                Create a workspace
              </a>
            </FieldDescription>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}