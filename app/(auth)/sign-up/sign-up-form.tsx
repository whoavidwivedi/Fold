"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

/**
 * Create an account and a first workspace in one step.
 *
 * The org name and slug are collected here rather than prompted for afterwards, because
 * `organizationId` has to be the ACTIVE workspace for the JWT to carry a
 * `workspace_id` — and a JWT without one is rejected by the Go API with a 401.
 * Sending someone to an app that cannot talk to its own API is a worse first run.
 */
export function SignUpForm() {
  const router = useRouter()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [company, setCompany] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
    })

    if (signUpError) {
      setError(signUpError.message ?? "Could not create the account")
      setPending(false)
      return
    }

    // Slugify once, here. Better Auth takes a plain slug and uniqueness failures come
    // back as an error we can show. Falls back to the email local part so the field is
    // never empty — an undefined slug is a 422 rather than a helpful message.
    const slug =
      company
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || email.split("@")[0].toLowerCase()

    const { data: org, error: orgError } = await authClient.organization.create({
      name: company.trim() || `${name}'s workspace`,
      slug,
    })

    if (orgError || !org) {
      setError(orgError?.message ?? "Account created, but the workspace failed")
      setPending(false)
      return
    }

    // organization.create does NOT make the new workspace active. Without this the JWT
    // carries an empty workspace_id, and the Go API answers 401 for every call — the
    // user lands in the app and sees an empty table with no explanation.
    const { error: activateError } = await authClient.organization.setActive({
      organizationId: org.id,
    })

    if (activateError) {
      setError(activateError.message ?? "Could not enter the new workspace")
      setPending(false)
      return
    }

    router.push("/people")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>Free while we build. No card required.</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Your name</FieldLabel>
              <Input
                id="name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dana Rep"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="company">Company</FieldLabel>
              <Input
                id="company"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Roofing"
              />
            </Field>

            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <FieldError>{error}</FieldError>
            </Field>

            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Creating…" : "Create workspace"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}